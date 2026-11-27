import { toast } from "sonner"
import { newWork, type CaseWork, type SavedPlan } from "@/lib/cases/state"
import { withPlanTax } from "@/lib/cases/tax"
import type { CaseFile } from "@/lib/cases/types"
import { discard } from "@/lib/chat/proposals"
import type { AddressBook } from "@/lib/convert/address"
import { convertRows } from "@/lib/convert/convert"
import { compareFormats, describeFormatDiff } from "@/lib/convert/format-diff"
import { heuristicPlan, planSheets, primarySheet, sheetByNames } from "@/lib/convert/heuristic-plan"
import { fillAiCache, type AiCache, type AiCaller } from "@/lib/convert/pipeline"
import { acceptAiPlan, type MappingPlan, type SheetGrid } from "@/lib/convert/plan"
import { planExcerpt, previousPlanContext } from "@/lib/convert/prompt"
import { errorMessage } from "@/lib/errors"
import { KOJI_KEIREKI, KOJI_PLAN_HINTS, type KojiFieldId } from "@/lib/spec/koji-keireki"
import { setRuntime, setWork, type CaseState, type Source } from "../create-case-store"
import type { CaseEnv, PreviousCase } from "../env"
import { chatArrived } from "./ui"

const SPEC = KOJI_KEIREKI
type Plan = MappingPlan<KojiFieldId>

/** 列の計画の前に、去年の Excel を読み終えるのを待つ長さ */
export const PREVIOUS_WAIT_MS = 3_000

/** 去年の比べるシートと見出しの行（去年の計画のもの。計画が無い・シートが無ければ見出しから推定する）。比べるシートが無ければ null */
export function previousSideOf(previous: PreviousCase, sheets: SheetGrid[]) {
  const prevGrid = sheetByNames(SPEC, KOJI_PLAN_HINTS, sheets, previous.sheet)
  if (!prevGrid) return null
  const headerRow = prevGrid.name === previous.sheet && previous.headerRow !== null ? previous.headerRow : heuristicPlan(SPEC, KOJI_PLAN_HINTS, prevGrid).headerRow
  return { sheets, sheet: prevGrid.name, headerRow }
}

/**
 * 計画をやり直すとき（元のファイルの変更）: 行の作業と AI の結果は捨て、ファイル全体の設定は残す。開いている変更案は閉じる。
 * 計画は考え終わるまで null（この形をすぐ保存するので、考えている途中で閉じても、開き直すと新しい元で考え直す）。
 * 取り消しの記録は前の元の行を指すので捨てる
 */
const replanWork = (w: CaseWork, sourceFileId: string): CaseWork => ({
  ...newWork(sourceFileId),
  tax: w.tax,
  taxBy: w.taxBy,
  basis: w.basis,
  rule7Tax: w.rule7Tax,
  // 載せる工事の選び方と、答えたかは元に依らないので引き継ぐ
  selection: w.selection,
  selectionAnswered: w.selectionAnswered,
  rounding: w.rounding,
  // 税込・税抜の答えは元に依らないので引き継ぐ。計画の聞き返しの答えは前の計画のもの
  reportAnswers: w.reportAnswers.tax ? { tax: w.reportAnswers.tax } : {},
  // メールの件名・前置きは行に依らないので引き継ぐ
  inquiryText: w.inquiryText,
  // 変更案は前の元の行を指すので閉じる（消さずに残す。消すと、サーバーの記録から開き直したときにまた足される）
  proposals: w.proposals.map(discard),
})

/** 案件の費用の合計に足す（計画・変換・取り込みの AI の分） */
export function addCost(env: CaseEnv, usd: number) {
  setRuntime(env.store, (r) => ({ costUsd: r.costUsd + usd }))
}

/** 案件の費用の合計を置き換える（サーバーが足した合計を返すもの: チャット・工事場所の調査） */
export function setCost(env: CaseEnv, usd: number) {
  setRuntime(env.store, () => ({ costUsd: usd }))
}

/**
 * 待っている間に AI に聞いた結果（filled。始めた時点の写し start から足した・変えたもの）を、今の作業の AI の結果に重ねる。
 * 待っている間にほかの処理が足した結果は残す（丸ごと置き換えると消え、同じ値をまた AI に聞いて費用が二重になる）
 */
export function mergeAiCache(current: AiCache, start: AiCache, filled: AiCache): AiCache {
  const merged = new Map(current)
  for (const [k, v] of filled) if (start.get(k) !== v) merged.set(k, v)
  return merged
}

/** 外の処理で AI を呼ぶ（費用は案件の合計に足す）。失敗の理由は failures に集める */
export function serverAi(env: CaseEnv, failures: Set<string>): AiCaller {
  return async (req) => {
    try {
      const res = await env.deps.runAiBatch(req)
      addCost(env, res.usd)
      if (!res.ok) failures.add(res.message)
      return res.ok ? { ok: true, json: res.json } : res
    } catch (e) {
      const message = errorMessage(e, "AI の呼び出しに失敗しました")
      failures.add(message)
      return { ok: false, message }
    }
  }
}

/** 変換の世代を上げ、待っている変換の結果を捨てる（元・計画が変わったとき）。新しい世代を返す */
export function supersedeConversion(env: CaseEnv) {
  let next = 0
  setRuntime(env.store, (r) => {
    next = r.gen.conversion + 1
    return { converting: false, gen: { ...r.gen, conversion: next } }
  })
  return next
}

/** 去年の Excel を1回だけ読む（読めなければ null。理由は runtime.previous に） */
export function loadPreviousSheets(env: CaseEnv): Promise<SheetGrid[] | null> {
  const file = env.config.previous?.source
  if (!file) return Promise.resolve(null)
  // 読めた結果だけを持つ（失敗は持たず、次に要るときに読み直す）
  env.previousLoad.current ??= (async () => {
    try {
      const { readWorkbook } = await import("@/lib/convert/workbook")
      const sheets = readWorkbook(file.name, await env.deps.fetchFile(file.id))
      setRuntime(env.store, () => ({ previous: sheets }))
      return sheets
    } catch (e) {
      env.previousLoad.current = null
      setRuntime(env.store, () => ({ previous: { error: errorMessage(e, "去年の Excel を読めませんでした") } }))
      return null
    }
  })()
  return env.previousLoad.current
}

/**
 * 列の計画の AI に渡す去年の文脈: 去年の列の対応と、去年の Excel との違い。計画の前なので、今年のどのシートと比べるかは
 * 職員が指定したシート → 去年と同じ名前のシート → 見出しから選んだシート（sheetByNames）、見出しの行は見出しからの推定。
 * 比べたシートは違いの文に出る。去年の計画が無い・去年の Excel を読めなければ無し
 */
async function previousPlanFor(env: CaseEnv, src: Source, requiredSheet: string | undefined) {
  const { previous } = env.config
  const prevPlan = previous?.plan
  if (!previous || !prevPlan) return undefined
  // 去年の Excel は開いたときから読んでいる。計画をそれ以上待たせない（読み終わらなければ去年の文脈なしで計画する）
  const sheets = await Promise.race([loadPreviousSheets(env), new Promise<null>((resolve) => setTimeout(() => resolve(null), PREVIOUS_WAIT_MS))])
  const side = sheets && previousSideOf(previous, sheets)
  const prevGrid = side && sheets.find((s) => s.name === prevPlan.sheets[0])
  const g = sheetByNames(SPEC, KOJI_PLAN_HINTS, src.sheets, requiredSheet, prevPlan.sheets[0])
  if (!side || !prevGrid || !g) return undefined
  const diff = describeFormatDiff(compareFormats(side, { sheets: src.sheets, sheet: g.name, headerRow: heuristicPlan(SPEC, KOJI_PLAN_HINTS, g).headerRow }))
  return previousPlanContext(SPEC, { fiscalYear: previous.fiscalYear, grid: prevGrid, plan: prevPlan, diff })
}

/**
 * 列の計画を立てる。どのシートを使うか・見出しの行・列の対応は計画の AI が決める（requiredSheet は職員が指定した計画の元のシート）。
 * AI を待つ間と AI が使えないときは、見出しから選んだシートの推定を使う。立て終わると自動で変換する（session.ts の自動の変換）。
 * 待っている間に元・計画が変わったら（世代が変わったら）結果を捨てる
 */
export async function startPlanning(env: CaseEnv, src: Source, requiredSheet?: string) {
  const { store, deps } = env
  const fallbackFor = (g: SheetGrid) => heuristicPlan(SPEC, KOJI_PLAN_HINTS, g)
  const g = sheetByNames(SPEC, KOJI_PLAN_HINTS, src.sheets, requiredSheet)
  if (!g) throw new Error("シートが空です")
  const fallback = fallbackFor(g)
  const id = store.getState().runtime.gen.case + 1
  supersedeConversion(env)
  // 返ってきた Excel の案内は前の元の行の問い合わせへのもの
  setRuntime(store, (r) => ({ gen: { ...r.gen, case: id }, convertError: null, planDraft: { plan: fallback, source: "rule" }, hints: { ...r.hints, answer: [] } }))
  setWork(store, (w) => replanWork(w, src.fileId))
  const current = () => store.getState().runtime.gen.case === id
  let next: SavedPlan
  try {
    const previousContext = await previousPlanFor(env, src, requiredSheet)
    if (!current()) return
    const targets = planSheets(SPEC, KOJI_PLAN_HINTS, src.sheets, requiredSheet)
    const excerpt = planExcerpt(src.sheets.length, targets.sheets, targets.required)
    const res = await deps.planWithAi({ ...excerpt, ...(previousContext ? { previous: previousContext } : {}) })
    addCost(env, res.usd)
    if (res.ok) {
      const accepted = acceptAiPlan(SPEC, src.sheets, excerpt, res.json, fallbackFor)
      next = accepted.ok ? { plan: accepted.plan, source: "ai" } : { plan: fallback, source: "rule", notice: `${accepted.message}。見出しから列を推定しました。` }
    } else {
      next = {
        plan: fallback,
        source: "rule",
        notice: res.reason === "noKey" ? "APIキー未設定（ANTHROPIC_API_KEY）のため AI は使えません。見出しから列を推定しました。" : `${res.message}。見出しから列を推定しました。`,
      }
    }
  } catch (e) {
    next = { plan: fallback, source: "rule", notice: `${errorMessage(e, "AI の計画に失敗しました")}。見出しから列を推定しました。` }
  }
  if (!current()) return
  // 計画が見出し・注記から税込・税抜を決めたら、案件の税の設定に入れる（職員が決めた値は上書きしない）
  setWork(store, (w) => withPlanTax({ ...w, plan: next }, next.plan))
  setRuntime(store, () => ({ planDraft: null }))
}

/**
 * 変換の元のファイルを読む。計画がまだ無ければ（replan: 初めて選んだ・計画の途中で閉じた）計画を立てる。
 * AI が使えない（APIキーが無い）ときは計画を立てない（このツールは AI で列の対応を決める。見出しの推定で黙って進めない）。
 * 読んでいる間に別の元を読み始めたら、この結果は捨てる
 */
export async function openSource(env: CaseEnv, file: CaseFile, replan: boolean) {
  const { store, deps } = env
  const id = store.getState().runtime.gen.source + 1
  setRuntime(store, (r) => ({ gen: { ...r.gen, source: id }, loading: file.name, sourceError: null }))
  const current = () => store.getState().runtime.gen.source === id
  try {
    const [{ readWorkbook }, { markability }] = await Promise.all([import("@/lib/convert/workbook"), import("@/lib/inquiry/markable")])
    const bytes = await deps.fetchFile(file.id)
    if (!current()) return
    const sheets = readWorkbook(file.name, bytes)
    if (!primarySheet(SPEC, KOJI_PLAN_HINTS, sheets)) throw new Error("シートが空です")
    const src: Source = { fileId: file.id, name: file.name, bytes, sheets, markable: markability(file.name, bytes) }
    setRuntime(store, () => ({ source: src, loading: null }))
    if (replan && env.config.chatEnabled) await startPlanning(env, src)
  } catch (e) {
    if (current()) {
      setRuntime(store, () => ({ sourceError: { file, message: errorMessage(e, "ファイルを読み込めませんでした") } }))
      chatArrived(env, "error")
    }
  } finally {
    if (current()) setRuntime(store, () => ({ loading: null }))
  }
}

/** 計画を変える（見出しが同じシートを足す・外す）。変換し直す */
export function changePlan(env: CaseEnv, p: Plan) {
  supersedeConversion(env)
  setWork(env.store, (w) => ({ ...w, plan: w.plan && { ...w.plan, plan: p }, converted: false }))
}

/** 住所を引く（持っていない値だけ）。引き終わったら（引けなくても）表を作り直す。住所データを読めなければ、その住所の分割は AI に回す（知らせる） */
export async function ensureAddresses(env: CaseEnv, values: readonly string[]): Promise<AddressBook> {
  try {
    return await env.addresses.ensure(values)
  } catch (e) {
    toast.error(`${errorMessage(e, "住所データを読めませんでした")}。住所の分割は AI に回します`)
    return env.addresses.covering(values)!
  } finally {
    setRuntime(env.store, () => ({ addressBook: env.addresses.covering([])! }))
  }
}

/**
 * 変換する（ルール → AI の値の判断）。計画を立て終えたとき・計画を変えたときに自動で呼ぶ（session.ts）。
 * 変換している間に計画が変わっていたら、この結果は使わない（AI の結果だけ残す。新しい計画で変換し直す）。変換の世代が変わったら何も入れない
 */
export async function convert(env: CaseEnv) {
  const { store } = env
  const s = store.getState()
  const t = env.table(s)
  if (!t.sources || !t.plan || !t.addressValues || !s.work.plan) return
  const { sources, plan, addressValues } = t
  const planAtStart = s.work.plan
  /** 表がまだ無かった（新しい元の変換。変換し直す間は前の表を出したまま） */
  const fresh = !t.hasTable
  const generation = supersedeConversion(env)
  setRuntime(store, () => ({ converting: true, convertError: null }))
  const current = () => store.getState().runtime.gen.conversion === generation
  const failures = new Set<string>()
  const cache: AiCache = new Map(s.work.aiCache)
  try {
    // 住所をまだ引き終わっていなければ待つ（黙って何もしないことはしない）
    const book = await ensureAddresses(env, addressValues)
    if (!current()) return
    await fillAiCache(convertRows(SPEC, sources.rows, plan, { rounding: s.work.rounding, addresses: book }), cache, serverAi(env, failures))
    if (!current()) return
    // 変換している間に計画が変わっていたら、この結果は使わない（AI の結果だけ残す。新しい計画で変換し直す）
    let used = false
    setWork(store, (w) => {
      const aiCache = mergeAiCache(w.aiCache, s.work.aiCache, cache)
      used = w.plan === planAtStart
      return used ? { ...w, aiCache, converted: true, aiNotice: failures.size ? [...failures].join(" / ") : null } : { ...w, aiCache }
    })
    // 新しい元の変換の報告（聞き返し・知らせ）はチャットに出る。この変換の結果を使ったときだけ、窓をたたんでいれば未読の印を付ける（手直し・端数などの変換し直しでは付けない）
    if (fresh && used) chatArrived(env, "new")
  } catch (e) {
    if (current()) {
      setRuntime(store, () => ({ convertError: { message: errorMessage(e, "変換に失敗しました"), plan: planAtStart } }))
      chatArrived(env, "error")
    }
  } finally {
    if (current()) setRuntime(store, () => ({ converting: false }))
  }
}

/** 計画が決まって変換していなければ変換する（「変換する」のボタンは無い）。失敗した計画では繰り返さない（報告の「もう一度変換する」で） */
export function needsConversion(env: CaseEnv, s: CaseState) {
  const { work: w, runtime: r } = s
  const t = env.table(s)
  return !!w.plan && !w.converted && !!t.sources && !!t.addressValues && !r.converting && r.convertError?.plan !== w.plan
}

/** 報告の「やり直す」: 元を読めなかった（source）なら読み直し、変換が失敗したなら変換し直す */
export function retry(env: CaseEnv, what: "source" | "convert") {
  const { runtime: r, work: w } = env.store.getState()
  if (what === "source" && r.sourceError) return void openSource(env, r.sourceError.file, !w.plan)
  setRuntime(env.store, () => ({ convertError: null }))
  void convert(env)
}
