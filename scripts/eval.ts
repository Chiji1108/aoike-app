/**
 * 実例での照合: 顧客の実データを、今の変換（チャットなし）→ チャットの指示 で CSV にし、職員が作った CSV と列ごとに比べる。
 *
 *   EVAL_CASES=<案件定義の JSON> EVAL_OUT=<結果を書くフォルダ> pnpm exec tsx scripts/eval.ts <case> <variant>
 *   variant: baseline（チャットなし）| edit（案件定義の指示を順に）| rules（edit で承認した顧客ルールを入れて「顧客ルールどおりに表を直して」の1回）
 *            | plan（列の対応を直す指示: 案件定義の planInstructions を順に。set_plan の変更案は画面と同じく今の計画に重ねて変換し直し、ほかの変更案はその上に重ねる）
 *            | answers（顧客の回答: answerInstructions をメールの本文として順に送る。聞いていたセルの答えを answerTruth と比べる）
 *            | inquiry（問い合わせの文面: 変換の結果に画面の「AI で文面を作る」と同じ指示を送り、質問の文とメールの下書きの案を全部承認したものとして、
 *              問い合わせのうち AI の文で聞く数・まとめた質問の数・決まった言葉や個人名・工事名・ほかの案件の顧客名が文に入っていないかを数える）
 *            | location（工事場所の調査: 変換の結果から調べる現場を集め、画面の一括調査と同じ手順で調べ、変更案を全部承認して都道府県・場所名を比べる。
 *              覚えた結果は EVAL_OUT の location-memory.sqlite に残るので、2回目は覚えた結果を使う）
 *   案件定義の files に、変換の元のほかに AI に渡すファイル（技術者の一覧・PDF など）を書ける（チャットの指示のときコンテナに置く。画面で案件に付けたファイルと同じ）
 *   回ごとに summary-<case>-<variant>.json（終わったか・一致率・行・指示の回数・時間・費用）を書き、費用は使うたびに costs.jsonl に足す（落ちても残る）。
 *   落ちたとき・費用の上限で指示を止めたときは 1 で終わる。並べた表は scripts/eval-report.ts、案件定義の variants をまとめて流すのは scripts/eval-run.ts
 *   案件定義の editFrom を書くと、その案件の edit を去年として使う（列の名前と順番を変えた Excel で、去年は元の Excel のとき）。previousXlsx は去年の Excel（無ければ editFrom の案件の Excel）
 *
 * 案件定義（実データのパス・顧客名・職員の誤り・指示）と結果は顧客の情報を含むので、リポジトリの外に置く。
 * AI の変更案はすべて承認したものとして表に重ねる。1回の照合の費用が BUDGET_USD を超えたら次の指示を送らずに止める。
 */
import Anthropic, { toFile } from "@anthropic-ai/sdk"
import type { ModelMessage } from "ai"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { newWork } from "../src/lib/cases/state"
import { withPlanTax } from "../src/lib/cases/tax"
import { deriveTable, type CaseTable } from "../src/lib/cases/view"
import { caseContext } from "../src/lib/chat/context"
import { applyChanges, type ChatChange } from "../src/lib/chat/proposals"
import { DEFAULT_GLOBAL_RULE_ITEMS, rulesText, ruleTextSchema } from "../src/lib/chat/rules"
import { checkReport, newTurnState, startTurn, systemPrompt, type InquiryDeps, type TurnState } from "../src/lib/chat/turn"
import { memoryFeedback } from "../src/lib/feedback/memory"
import type { RowResult } from "../src/lib/convert/convert"
import { heuristicPlan, planSheets, sheetByNames } from "../src/lib/convert/heuristic-plan"
import { runConversion } from "../src/lib/convert/pipeline"
import { fileAddressLookup } from "../src/lib/convert/address-file"
import { acceptAiPlan, matchesValues, type MappingPlan } from "../src/lib/convert/plan"
import { applyPlanPatch, describePlanPatch, sheetShapeOf, type PlanPatch } from "../src/lib/convert/plan-patch"
import { planExcerpt, previousPlanContext } from "../src/lib/convert/prompt"
import { collectSourceRows } from "../src/lib/convert/sources"
import { readWorkbook } from "../src/lib/convert/workbook"
import { tokensOfAiSdk, usdOf } from "../src/lib/cost"
import { KOJI_KEIREKI, KOJI_PLAN_HINTS, type KojiFieldId } from "../src/lib/spec/koji-keireki"
import { batchWithClaude, planWithClaude } from "../src/server/claude"
import { containerName, contentTypeOf } from "../src/lib/cases/types"
import { recordCost, type RunSummary } from "../src/lib/eval/report"
import { localViewer } from "./view-local"
import { viewIdle, type ViewState } from "../src/lib/chat/view-file"

const ROOT = new URL("..", import.meta.url).pathname
const apiKey = process.env.ANTHROPIC_API_KEY ?? readFileSync(join(ROOT, ".dev.vars"), "utf8").match(/ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)/)?.[1]
if (!apiKey) throw new Error("ANTHROPIC_API_KEY が無い（環境変数か .dev.vars）")
const [caseId = "", variant = "baseline"] = process.argv.slice(2)
const OUT = process.env.EVAL_OUT
const CASES_FILE = process.env.EVAL_CASES
if (!OUT || !CASES_FILE) throw new Error("EVAL_CASES（案件定義の JSON）と EVAL_OUT（結果のフォルダ）を指定（顧客データを含むのでリポジトリの外）")
if (!["baseline", "edit", "rules", "location", "plan", "answers", "inquiry"].includes(variant)) throw new Error("variant: baseline | edit | rules | location | plan | answers | inquiry")
mkdirSync(OUT, { recursive: true })
const BUDGET_USD = 5
/** 顧客ルールだけで直す1回の指示（rules） */
const RULES_TURN = "顧客ルールどおりに表を直して"
/** 全体ルールは初期値の項目（新しい事務所と同じ）。7割の計算は事務所の初期値（税抜） */
const GLOBAL_RULES = rulesText(DEFAULT_GLOBAL_RULE_ITEMS.map((text) => ({ text })))

type CaseDef = {
  /** ROOT からの相対パスか絶対パス */
  xlsx: string
  /** 職員が計画の元に指定するシート（画面の「計画の元にするシート」）。無ければ計画の AI が選ぶ */
  sheet?: string
  /** 職員が作った完成 CSV（CP932） */
  staffCsv: string
  customerName: string
  /** 顧客ルール（1行1項目） */
  customerRules: string
  /** 職員の誤りと分かっているセル（金額千円で行を特定）と、元データから決まらない列（一致率に入れない） */
  staffErrors: { amount: string; field: KojiFieldId; why: string }[]
  notDerivable: { field: KojiFieldId; why: string }[]
  instructions: string[]
  /** 列の対応を直す指示（variant plan。例:「完成年月は引渡日にして」） */
  planInstructions?: string[]
  /** 変換の元のほかに AI に渡すファイル（ROOT からの相対パスか絶対パス。技術者の一覧・PDF など） */
  files?: string[]
  /** scripts/eval-run.ts で順に流す variant（location を2つ書くと、1回目は調べ、2回目は覚えた結果を使う） */
  variants?: string[]
  /** 去年として使う案件（rules はその edit の顧客ルール、計画の AI にはその baseline の計画を添える）。無ければこの案件 */
  editFrom?: string
  /** 去年の年度（去年の計画を添えるときに要る） */
  previousFiscalYear?: number
  /** 去年の Excel（無ければ editFrom の案件の Excel） */
  previousXlsx?: string
  /** answers: 顧客のメールの本文（チャットに貼る指示として順に送る） */
  answerInstructions?: string[]
  /** answers: 正しい答え（工事名・項目・CSV の値）。聞いたセルのうちここに無いものは、顧客が答えていない（埋めたら誤り） */
  answerTruth?: { workName: string; field: KojiFieldId; value: string }[]
}

const CASES = JSON.parse(readFileSync(CASES_FILE, "utf8")) as Record<string, CaseDef>
const def = CASES[caseId]
if (!def) throw new Error(`case: ${Object.keys(CASES).join(" | ")}`)
const path = (p: string) => (p.startsWith("/") ? p : join(ROOT, p))

let conversionUsd = 0
/** 費用を使った時点で回のフォルダに足す（落ちた照合の分も scripts/eval-run.ts の上限と表の合計に入る） */
const spend = (kind: string, usd: number) => recordCost(OUT, { case: caseId, variant, kind, usd })
const anthropic = new Anthropic({ apiKey })
const sheets = readWorkbook(def.xlsx, new Uint8Array(readFileSync(path(def.xlsx))))
if (def.sheet && !sheets.some((s) => s.name === def.sheet)) throw new Error(`シート「${def.sheet}」が無い`)
/** 計画の元のシート（計画の AI が選んだもの） */
const gridOf = (plan: MappingPlan<KojiFieldId>) => sheets.find((s) => s.name === plan.sheets[0])!
const staff = new TextDecoder("shift_jis")
  .decode(readFileSync(path(def.staffCsv)))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => l.split(","))

type Baseline = { rows: RowResult<KojiFieldId>[]; plan: MappingPlan<KojiFieldId>; ms: number; usd: number }

/** 画面と同じ: AI の列の計画 → 変換（AI の値の判断つき）。設定は新しい案件の初期値 */
async function baseline(): Promise<Baseline> {
  const t0 = Date.now()
  const fallbackFor = (g: (typeof sheets)[number]) => heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, g)
  // 翌年分の案件（editFrom）は、画面と同じく去年の列の対応を計画の AI に添える
  const targets = planSheets(KOJI_KEIREKI, KOJI_PLAN_HINTS, sheets, def!.sheet)
  const excerpt = planExcerpt(sheets.length, targets.sheets, targets.required)
  const res = await planWithClaude(anthropic, { ...excerpt, ...(def!.editFrom ? { previous: previousPlanOf() } : {}) })
  conversionUsd += res.usd
  spend("plan", res.usd)
  if (!res.ok) throw new Error(res.message)
  const accepted = acceptAiPlan(KOJI_KEIREKI, sheets, excerpt, res.json, fallbackFor)
  // 画面と同じく、AI の計画を使えなければ見出しから選んだシートの推定にする
  if (!accepted.ok) console.log(`AI の計画を使わない: ${accepted.message}`)
  const plan = accepted.ok ? accepted.plan : fallbackFor(sheetByNames(KOJI_KEIREKI, KOJI_PLAN_HINTS, sheets, def!.sheet)!)
  console.log(`計画のシート: ${plan.sheets.join("、")}（${plan.notes[0] ?? ""}）`)
  console.log(`計画の税込・税抜: ${plan.amountTax ?? "unknown"}`)
  console.log(`計画の notes ${plan.notes.length} 件:\n${plan.notes.map((n) => `  - ${n}`).join("\n")}`)
  // 聞き返しは種類と対象の行の数（画面と同じく元の Excel のセルで数える）
  const sourceRows = collectSourceRows(sheets, plan).rows
  const asks = plan.asks ?? []
  console.log(`計画の asks ${asks.length} 件:\n${asks.map((a) => `  - [${a.kind}] ${a.text}（${sourceRows.filter((r) => matchesValues(a, r.cells)).length} 行）`).join("\n")}`)
  const rows = await runConversion({
    lookup: fileAddressLookup,
    spec: KOJI_KEIREKI,
    sources: collectSourceRows(sheets, plan).rows,
    plan,
    ctx: { rounding: "floor" },
    cache: new Map(),
    callAi: async (req) => {
      const r = await batchWithClaude(anthropic, req)
      conversionUsd += r.usd
      spend("conversion", r.usd)
      return r.ok ? { ok: true, json: r.json } : { ok: false, message: r.message }
    },
  })
  return { rows, plan, ms: Date.now() - t0, usd: conversionUsd }
}

/** 去年（editFrom の案件）の年度・Excel・計画（その baseline）。1回だけ読む */
let lastYearCache: { fiscalYear: number; last: Baseline; prevSheets: ReturnType<typeof readWorkbook> } | undefined
function lastYear() {
  if (lastYearCache) return lastYearCache
  const from = def!.editFrom ?? caseId
  const fiscalYear = def!.previousFiscalYear
  if (fiscalYear === undefined) throw new Error("去年の計画を添えるには案件定義の previousFiscalYear（去年の年度）が要る")
  const last = JSON.parse(readFileSync(join(OUT!, `${from}-baseline.json`), "utf8")) as Baseline
  const prevPath = def!.previousXlsx ?? CASES[from]!.xlsx
  lastYearCache = { fiscalYear, last, prevSheets: readWorkbook(prevPath, new Uint8Array(readFileSync(path(prevPath)))) }
  return lastYearCache
}

/** 計画の AI に添える去年の文脈（画面と同じく、去年の列の対応を去年の見出しの名前で） */
function previousPlanOf() {
  const { fiscalYear, last, prevSheets } = lastYear()
  return previousPlanContext(KOJI_KEIREKI, { fiscalYear, grid: prevSheets.find((s) => s.name === last.plan.sheets[0])!, plan: last.plan })
}

/** 画面と同じく、計画が税込・税抜を決めていれば案件の税の設定に入れる */
const tableOf = ({ rows, plan }: Pick<Baseline, "rows" | "plan">): CaseTable => {
  const w = withPlanTax(newWork(), plan)
  return { rows, added: w.added, edits: w.edits, replacements: w.replacements, manual: w.manual, tax: w.tax, basis: w.basis, rule7Tax: w.rule7Tax, selection: w.selection, rounding: w.rounding, dismissed: w.dismissed, inquiryText: w.inquiryText }
}

/** 文字の2つ組の重なり（Dice 係数） */
function similarity(a: string, b: string) {
  const grams = (s: string) => {
    const cs = [...s]
    return cs.length < 2 ? new Set([s]) : new Set(cs.slice(0, -1).map((c, i) => c + cs[i + 1]))
  }
  const A = grams(a)
  const B = grams(b)
  let n = 0
  for (const x of A) if (B.has(x)) n++
  return (2 * n) / (A.size + B.size)
}

/** 行の対応づけに使う文字の近さ（法人格と空白は除いて比べ、2文字に満たなければ 0） */
const sim = (a: string, b: string) => {
  const strip = (s: string) => s.normalize("NFKC").replace(/\s|株式会社|有限会社|㈱|㈲|\(株\)/g, "")
  const [x, y] = [strip(a), strip(b)]
  return [...x].length < 2 || [...y].length < 2 ? 0 : similarity(x, y)
}

/** 職員の CSV の行ごとに、金額と注文者・工事名の近い行を対応づけ、列ごとに一致を数える */
function compare(ours: string[][]) {
  const used = new Set<number>()
  const pairs = staff.map((s) => {
    let best = -1
    let score = 0
    ours.forEach((o, i) => {
      if (used.has(i)) return
      const text = sim(o[4]!, s[4]!) + sim(o[1]!, s[1]!)
      const sc = (o[8] === s[8] ? 2 : 0) + text
      if ((o[8] === s[8] ? text >= 0.6 : text >= 1.6) && sc > score) [best, score] = [i, sc]
    })
    if (best >= 0) used.add(best)
    return { s, o: best >= 0 ? ours[best] : undefined }
  })
  const matched = pairs.filter((p) => p.o)
  const excluded = new Set(def!.notDerivable.map((n) => n.field))
  const perField = KOJI_KEIREKI.fields.map((f, i) => {
    const relevant = matched.filter((p) => !def!.staffErrors.some((e) => e.field === f.id && e.amount === p.s[8]))
    const ok = relevant.filter((p) => p.o![i] === p.s[i]).length
    return { field: f.id, label: f.label, ok, n: relevant.length, excluded: excluded.has(f.id), misses: relevant.filter((p) => p.o![i] !== p.s[i]).map((p) => `${p.s[i]} ⇐ ${p.o![i]}`) }
  })
  const scored = perField.filter((f) => !f.excluded)
  const cellRate = scored.reduce((a, f) => a + f.ok, 0) / Math.max(1, scored.reduce((a, f) => a + f.n, 0))
  return { staffRows: staff.length, ourRows: ours.length, matchedRows: matched.length, extraRows: ours.length - used.size, cellRate, perField }
}

const csvRows = (t: CaseTable) => deriveTable(t).output.map((r) => KOJI_KEIREKI.fields.map((f) => r.cells[f.id].value))

function printScore(label: string, c: ReturnType<typeof compare>) {
  console.log(`${label}: staff ${c.staffRows} ours ${c.ourRows} matched ${c.matchedRows} extra ${c.extraRows} cellRate ${(c.cellRate * 100).toFixed(1)}%`)
  console.log("  " + c.perField.map((f) => `${f.label}${f.excluded ? "(除外)" : ""} ${f.ok}/${f.n}`).join(" | "))
}

/** 回ごとの要約（scripts/eval-report.ts が読む）。label は location の何回目か */
function writeSummary(label: string, s: Omit<RunSummary, "case" | "variant" | "score"> & { score: ReturnType<typeof compare> }) {
  written.add(label)
  const score = { ...s.score, perField: s.score.perField.map(({ misses: _, ...f }) => f) }
  writeFileSync(join(OUT!, `summary-${caseId}-${label}.json`), JSON.stringify({ ...s, case: caseId, variant: label, score } satisfies RunSummary, null, 1))
}

/** いま流している variant（落ちたときの要約の名前。location は locationEval が何回目かを付ける） */
let current = "baseline"
const written = new Set<string>()
/** 要約を書く前に落ちたら、落ちた要約を書く（値は数えない。表に未完了として理由と一緒に出す）。費用は costs.jsonl に残っている */
function failed(e: unknown): never {
  if (!written.has(current)) {
    const empty = { staffRows: staff.length, ourRows: 0, matchedRows: 0, extraRows: 0, cellRate: 0, perField: [] }
    writeSummary(current, { status: "failed", reason: String(e).slice(0, 200), score: empty, turns: 0, ms: 0, conversionUsd, usd: 0 })
  }
  console.error(e)
  process.exit(1)
}

const basePath = join(OUT, `${caseId}-baseline.json`)
let base: Baseline
try {
  if (variant === "baseline" || !existsSync(basePath)) {
    base = await baseline()
    writeFileSync(basePath, JSON.stringify(base))
    const c = compare(csvRows(tableOf(base)))
    writeFileSync(join(OUT, `${caseId}-baseline-score.json`), JSON.stringify(c, null, 1))
    printScore(`baseline (${Math.round(base.ms / 1000)}s, $${base.usd.toFixed(3)})`, c)
    writeSummary("baseline", { status: "done", score: c, turns: 0, ms: base.ms, conversionUsd: base.usd, usd: 0 })
  } else base = JSON.parse(readFileSync(basePath, "utf8"))
  current = variant

  if (variant === "location") await locationEval()
  else if (variant === "answers") await answersEval()
  else if (variant === "inquiry") await inquiryEval()
  else if (variant !== "baseline") {
    /** 顧客ルールの項目（画面の箇条書き）。案件定義の customerRules は1行1項目 */
    let customerItems = def.customerRules.split("\n").map((t) => t.trim()).filter(Boolean)
    const lastYearId = def.editFrom ?? caseId
    if (variant === "rules") {
      const edit = JSON.parse(readFileSync(join(OUT, `${lastYearId}-edit.json`), "utf8")) as { log: { rules: string[] }[] }
      // edit で承認した顧客ルールの項目（画面の承認と同じく1項目ずつ足す）
      customerItems = edit.log.flatMap((t) => t.rules).map((t) => ruleTextSchema.parse(t))
      if (!customerItems.length) throw new Error("edit の結果に顧客ルールの追記案が無い")
    }
    const turns = variant === "rules" ? [RULES_TURN] : variant === "plan" ? (def.planInstructions ?? []) : def.instructions
    if (!turns.length) throw new Error(`${variant} の指示が案件定義に無い`)
    const t00 = Date.now()
    const run = await chatPhase({ turns, table: tableOf(base), plan: base.plan, customerItems })
    const final = compare(csvRows(run.table))
    writeFileSync(join(OUT, `${caseId}-${variant}.json`), JSON.stringify({ status: run.status, reason: run.reason, total: run.total, ms: Date.now() - t00, turns: run.log.length, log: run.log, final: csvRows(run.table), score: final }, null, 1))
    writeSummary(variant, { status: run.status, ...(run.reason ? { reason: run.reason } : {}), score: final, turns: run.log.length, ms: Date.now() - t00, conversionUsd: base.usd, usd: run.total })
    console.log(`\nSUMMARY ${caseId} ${variant} (${run.status}): turns ${run.log.length} time ${Math.round((Date.now() - t00) / 1000)}s chat $${run.total.toFixed(3)} cellRate ${(final.cellRate * 100).toFixed(1)}%`)
    if (run.error) throw run.error
    if (run.status === "stopped") process.exitCode = 1
  }
} catch (e) {
  failed(e)
}

/** 1回の指示の記録（scripts/eval-report.ts は読まない。結果の JSON に残す） */
type TurnLogEntry = {
  turn: number
  text: string
  plan: PlanPatch[]
  rules: string[]
  question: string | null
  pending: ChatChange[]
  tools: TurnState["log"]
  [k: string]: unknown
}

/**
 * チャットの指示を順に送る（1つの会話）。画面と同じく、案件のファイルを file-<n>.<拡張子> の名前でコンテナに置き（変換の元が1つ目）、
 * AI の変更案はすべて承認したものとして表に重ねる（set_plan は今の計画に重ねて変換し直す）。上げたファイルは落ちても必ず消す。
 * 費用が BUDGET_USD を超えたら次の指示を送らずに止める（status: stopped）
 */
async function chatPhase(p: {
  turns: string[]
  table: CaseTable
  plan: MappingPlan<KojiFieldId>
  customerItems: string[]
  inquiry?: InquiryDeps
}) {
  /** 今の列の対応（set_plan を承認すると変わる。画面と同じく、変えたら変換し直す） */
  let plan = p.plan
  const conversionCache = new Map()
  const uploads: { id: string; name: string; original: string; mediaType: string; isSource: boolean; path: string }[] = []
  let table = p.table
  const messages: ModelMessage[] = []
  let containerId: string | undefined
  let total = 0
  const log: TurnLogEntry[] = []
  const generated = new Set<string>()
  const viewStates: ViewState[] = []
  /** 要望（本番の csv_feedback の代わり。この会話の間だけ持つ。同じ要望は件数を足す） */
  const { deps: feedback } = memoryFeedback([def!.customerName], [GLOBAL_RULES, ...p.customerItems])
  let status: RunSummary["status"] = "done"
  let reason: string | undefined
  let error: unknown = null
  try {
    for (const [i, path_] of [def!.xlsx, ...(def!.files ?? [])].entries()) {
      const original = path_.split("/").at(-1)!
      const name = containerName(i, original)
      const mediaType = contentTypeOf(original)
      const up = await anthropic.files.upload({ file: await toFile(readFileSync(path(path_)), name, { type: mediaType }) })
      uploads.push({ id: up.id, name, original, mediaType, isSource: i === 0, path: path(path_) })
    }
    for (const [i, text] of p.turns.entries()) {
      // 画面は指示のたびに今の列の対応で文脈を作る
      const system = systemPrompt({ global: GLOBAL_RULES, customerName: def!.customerName, customer: rulesText(p.customerItems.map((text) => ({ text }))), rule7Tax: "excluded" }, caseContext(sheets, gridOf(plan), plan), uploads)
      if (total > BUDGET_USD) {
        status = "stopped"
        reason = `費用が $${total.toFixed(2)} で上限 $${BUDGET_USD} を超え、${p.turns.length - i} 回の指示を送っていない`
        console.log(`STOP: ${reason}`)
        break
      }
      messages.push({
        role: "user",
        content: [
          ...(containerId
            ? []
            : uploads.map((u) => ({ type: "file" as const, mediaType: u.mediaType, data: { type: "reference" as const, reference: { anthropic: u.id } }, providerOptions: { anthropic: { containerUpload: true } } }))),
          { type: "text", text },
        ],
      })
      const t0 = Date.now()
      const state = newTurnState(
        table,
        async (req) => {
          const r = await batchWithClaude(anthropic, req)
          spend("anonymize", r.usd)
          return r
        },
        undefined,
        { plan, shape: sheetShapeOf(gridOf(plan)) },
        { lookup: fileAddressLookup },
        null,
        p.inquiry ?? null,
        feedback,
        localViewer(anthropic, uploads),
        messages,
      )
      // view_file が上げたファイルは、落ちても消す（state.view.uploads は道具が上げるたびに足される）
      if (state.view) viewStates.push(state.view)
      const result = startTurn({ apiKey: apiKey!, system, messages, state, containerId })
      let reply = ""
      const calls: string[] = []
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") reply += part.text
        else if (part.type === "finish-step") spend("chat", usdOf(tokensOfAiSdk(part.usage)))
        else if (part.type === "tool-call") calls.push(part.toolName === "code_execution" ? "code" : part.toolName)
        else if (part.type === "tool-result" && part.toolName === "code_execution") for (const [, id] of JSON.stringify(part.output).matchAll(/"file_?[iI]d"\s*:\s*"(file_[A-Za-z0-9_-]+)"/g)) generated.add(id!)
        else if (part.type === "error") throw new Error(`stream error: ${String((part.error as { responseBody?: string }).responseBody ?? part.error)}`.slice(0, 600))
      }
      const [responseMessages, usage, steps] = await Promise.all([result.responseMessages, result.totalUsage, result.steps])
      containerId = (steps.at(-1)?.providerMetadata?.anthropic as { container?: { id?: string } } | undefined)?.container?.id ?? containerId
      messages.push(...responseMessages)
      const usd = usdOf(tokensOfAiSdk(usage)) + state.anonymizeUsd
      total += usd
      // 列の対応の変更案は、画面の承認と同じく今の計画に重ねて変換し直す（確かめは同じ applyPlanPatch）。手直しはその上に重なる
      const planChanges = state.pending.flatMap((c) => (c.kind === "plan" ? [c.patch] : []))
      for (const patch of planChanges) {
        const applied = applyPlanPatch(KOJI_KEIREKI, plan, patch, sheetShapeOf(gridOf(plan)), sheets)
        if (applied.ok) plan = applied.plan
        else console.log("  set_plan を重ねられない:", applied.problems.join(" / "))
      }
      if (planChanges.length) {
        const rows = await runConversion({
          lookup: fileAddressLookup,
          spec: KOJI_KEIREKI,
          sources: collectSourceRows(sheets, plan).rows,
          plan,
          ctx: { rounding: "floor" },
          cache: conversionCache,
          callAi: async (req) => {
            const r = await batchWithClaude(anthropic, req)
            spend("conversion", r.usd)
            total += r.usd
            return r.ok ? { ok: true, json: r.json } : { ok: false, message: r.message }
          },
        })
        table = { ...table, rows }
        console.log(`  set_plan を承認して変換し直した: ${planChanges.flatMap((p) => describePlanPatch(p)).join(" / ")}`)
      }
      table = applyChanges(table, deriveTable(table).edited, state.pending)
      const rules = state.pending.flatMap((c) => (c.kind === "rule" && c.scope === "customer" ? [c.text] : []))
      const score = compare(csvRows(table))
      log.push({ turn: i + 1, plan: planChanges, text, ms: Date.now() - t0, steps: steps.length, calls, toolCalls: state.toolCalls, usage, usd, pending: state.pending, question: state.question, rules, feedback: state.feedbackRecorded, tools: state.log, reply, report: checkReport(deriveTable(table), state.letters), score })
      console.log(`\n# turn ${i + 1}「${text}」 ${Math.round((Date.now() - t0) / 1000)}s steps ${steps.length} tools ${state.toolCalls} [${calls.join(",")}] $${usd.toFixed(3)}`)
      if (state.question) console.log("  question:", state.question)
      console.log("  reply:", reply.replace(/\n+/g, " ").slice(0, 400))
      printScore("  score", score)
    }
  } catch (e) {
    // 落ちても、それまでの記録・費用を呼ぶ側が書けるように返す（呼ぶ側が書いてから error を投げる）
    status = "failed"
    reason = String(e).slice(0, 200)
    error = e
  } finally {
    // view_file が上げている途中のファイルも、上げ終わるのを待って消す
    for (const v of viewStates) await viewIdle(v)
    for (const id of [...uploads.map((u) => u.id), ...generated, ...viewStates.flatMap((v) => v.uploads)]) await anthropic.files.delete(id).catch((e) => console.log("delete failed", id, String(e).slice(0, 120)))
  }
  return { table, plan, log, messages, total, status, reason, error }
}

/**
 * 工事場所の調査の照合。画面と同じく CSV に載せる行から調べる現場を集め（lib/location/sites.ts）、Workflow と同じ手順（server/location-run.ts）を
 * その場で回す（失敗した検索は2回までやり直す）。変更案は全部承認したものとして表に重ね、承認した工事場所を覚える（画面の承認と同じ）
 */
async function locationEval() {
  const { migratedDb } = await import("../src/server/__tests__/sqlite")
  const loc = await import("../src/server/location-store")
  const { runLocationSearch } = await import("../src/server/location-run")
  const { searchLocation } = await import("../src/server/location")
  const { locationTargets, MAX_SITES_PER_RUN } = await import("../src/lib/location/sites")
  const { jaSchema, placeIndex } = await import("../src/lib/location/check")
  const schema = await import("../src/db/cases-schema")
  const { eq } = await import("drizzle-orm")
  const index = placeIndex(jaSchema.parse(JSON.parse(readFileSync(join(ROOT, "public/japanese-addresses/api/ja.json"), "utf8"))))
  const { db } = migratedDb(join(OUT!, "location-memory.sqlite"))
  // 何回目かは、この回のフォルダの <case>-location-<n>.json の数で決める（2回目からは覚えた結果を使う）
  const prefix = `${caseId}-location-`
  const n = readdirSync(OUT!).filter((f) => f.startsWith(prefix) && /^\d+\.json$/.test(f.slice(prefix.length))).length + 1
  current = `location-${n}`
  // 顧客は案件定義の名前ごとに1つ（覚えた結果をまたいで使う）。案件は回ごとに作る
  const customerId = `eval-${caseId}`
  await db.insert(schema.csvCustomers).values({ id: customerId, name: def!.customerName }).onConflictDoNothing()
  const kaseId = crypto.randomUUID()
  await db.insert(schema.csvCases).values({ id: kaseId, customerId, fiscalYear: 2026 })
  let table = tableOf(base)
  const all = locationTargets(deriveTable(table))
  // EVAL_LOCATION_LIMIT で調べる現場を先頭から絞る（費用の上限に合わせた抜き取り。2回目も同じ現場になる）
  // 画面のサーバーと同じく、分かっている個人名を含む現場は送らない（照合には保存した作業が無いので、変換の結果の印の人で確かめる）
  const { guardPersonal } = await import("../src/lib/location/sites")
  const { namesOfTable, nameScrubber } = await import("../src/lib/chat/names")
  const scrub = nameScrubber(namesOfTable({ rows: base.rows, edits: [] }))
  const sites = guardPersonal(all.slice(0, Math.min(MAX_SITES_PER_RUN, Number(process.env.EVAL_LOCATION_LIMIT ?? MAX_SITES_PER_RUN))), (t) => scrub(t) !== t)
  const memorizedBefore = (await loc.memorized(db, customerId, sites.map((s) => s.key))).size
  console.log(`調べる現場 ${all.length}（この回 ${sites.length}、覚えた結果 ${memorizedBefore}、調べない ${sites.filter((s) => s.skip).length}）`)
  const created = await loc.createRun(db, kaseId, sites)
  if (!created.ok) throw new Error(created.reason)
  const records: import("../src/lib/chat/proposals").ProposalRecord[] = []
  const t0 = Date.now()
  try {
  await runLocationSearch(
    {
      db,
      index,
      knowledge: (req) => batchWithClaude(anthropic, req),
      search: (s, spent) => searchLocation(anthropic, index, s, spent),
      putProposal: async (_, r) => void records.push(r),
      deleteProposal: async () => {},
    },
    {
      async do(_name, config, fn) {
        for (let attempt = 0; ; attempt++) {
          try {
            return await fn()
          } catch (e) {
            if (attempt >= (config.retries?.limit ?? 0)) throw e
            await new Promise((r) => setTimeout(r, 3000))
          }
        }
      },
    },
    { runId: created.run.id, caseId: kaseId },
  )
  } finally {
    // 調査の費用は回の行に足されている（落ちた検索の分も）
    spend("location", (await loc.getRun(db, created.run.id))?.usd ?? 0)
  }
  const ms = Date.now() - t0
  const run = await loc.getRun(db, created.run.id)
  const record = records.at(-1)
  const changes = record?.changes ?? []
  table = applyChanges(table, deriveTable(table).edited, changes)
  const remembered = await loc.remember(
    db,
    kaseId,
    changes.flatMap((c) => (c.kind === "location" ? [{ site: c.site, found: c }] : [])),
  )
  const bySource = new Map<string, number>()
  for (const c of changes) {
    const k = c.kind === "location" ? c.source : c.kind
    bySource.set(k, (bySource.get(k) ?? 0) + 1)
  }
  const score = compare(csvRows(table))
  const baseScore = compare(csvRows(tableOf(base)))
  const field = (c: ReturnType<typeof compare>, f: KojiFieldId) => c.perField.find((x) => x.field === f)!
  const rate = (x: { ok: number; n: number }) => `${x.ok}/${x.n}（${((x.ok / Math.max(1, x.n)) * 100).toFixed(1)}%）`
  console.log(`\n# 工事場所の調査 ${Math.round(ms / 1000)}s searches ${run!.searches} $${run!.usd.toFixed(3)} 結果 ${JSON.stringify(Object.fromEntries(bySource))} 覚えた ${remembered}`)
  console.log(`  都道府県 ${rate(field(baseScore, "prefecture"))} → ${rate(field(score, "prefecture"))}`)
  console.log(`  場所名   ${rate(field(baseScore, "place"))} → ${rate(field(score, "place"))}`)
  printScore("  score", score)
  // 都道府県・場所名の食い違い（職員の値 ⇐ こちら）
  console.log("  都道府県の違い:", field(score, "prefecture").misses.slice(0, 20).join(" / "))
  console.log("  場所名の違い:", field(score, "place").misses.slice(0, 30).join(" / "))
  await db.delete(schema.csvLocationSites).where(eq(schema.csvLocationSites.runId, created.run.id))
  await db.delete(schema.csvLocationRuns).where(eq(schema.csvLocationRuns.id, created.run.id))
  await db.delete(schema.csvCases).where(eq(schema.csvCases.id, kaseId))
  writeSummary(current, { status: "done", score, turns: 0, ms, conversionUsd: base.usd, usd: run!.usd, searches: run!.searches })
  writeFileSync(join(OUT!, `${caseId}-location-${n}.json`), JSON.stringify({ ms, searches: run!.searches, usd: run!.usd, conversionUsd: base.usd, sites: sites.length, memorizedBefore, bySource: Object.fromEntries(bySource), changes, score, baseScore }, null, 1))
}


/**
 * 顧客の回答の照合。全件を載せる表（問い合わせは CSV に載せる行が対象）で問い合わせを集め、答えを受け取り、変更案は全部承認したものとして重ねる。
 * 聞いたセルごとに: 正しい（answerTruth の値）・誤り（違う値）・抜け（答えがあるのに入らない）・余計（答えが無いのに埋めた）を数える。
 * 聞き返し（ask_staff）があれば変更案もそのまま重ねる（職員が「はい」と答えたものとして。決められない答えは変更案に入れないのが正しい）
 */
async function answersEval() {
  const { collectInquiries } = await import("../src/lib/inquiry/inquiry")
  const truth = def!.answerTruth
  if (!truth) throw new Error("answers には案件定義の answerTruth が要る")
  let table: CaseTable = { ...tableOf(base), selection: "all" }
  const start = deriveTable(table)
  const asked = collectInquiries(start.output, { tax: table.tax }).flatMap((q) => (q.kind === "cell" ? [q] : []))
  const nameOf = new Map(start.shown.map((r) => [r.key, r.cells.workName.value]))
  console.log(`問い合わせ ${asked.length} セル: ${asked.map((q) => `${nameOf.get(q.rowKey)}/${q.field}`).join(" | ")}`)
  const t00 = Date.now()
  let total = 0
  const uploads: { id: string; name: string; original: string; mediaType: string; isSource: boolean }[] = []
  const generated = new Set<string>()
  const turns = def!.answerInstructions ?? []
  const log: unknown[] = []
  const anonymize = async (req: Parameters<typeof batchWithClaude>[1]) => {
    const r = await batchWithClaude(anthropic, req)
    spend("anonymize", r.usd)
    total += r.usd
    return r
  }
  try {
    for (const [i, p] of [def!.xlsx, ...(def!.files ?? [])].entries()) {
      const original = p.split("/").at(-1)!
      const up = await anthropic.files.upload({ file: await toFile(readFileSync(path(p)), containerName(i, original), { type: contentTypeOf(original) }) })
      uploads.push({ id: up.id, name: containerName(i, original), original, mediaType: contentTypeOf(original), isSource: i === 0 })
    }
    if (!turns.length) throw new Error("answers には answerInstructions が要る")
    const messages: ModelMessage[] = []
    let containerId: string | undefined
    for (const [i, text] of turns.entries()) {
      if (total > BUDGET_USD) throw new Error(`費用が $${total.toFixed(2)} で上限を超えた`)
      const system = systemPrompt({ global: GLOBAL_RULES, customerName: def!.customerName, customer: "", rule7Tax: "excluded" }, caseContext(sheets, gridOf(base.plan), base.plan), uploads)
      messages.push({
        role: "user",
        content: [
          ...(containerId ? [] : uploads.map((u) => ({ type: "file" as const, mediaType: u.mediaType, data: { type: "reference" as const, reference: { anthropic: u.id } }, providerOptions: { anthropic: { containerUpload: true } } }))),
          { type: "text", text },
        ],
      })
      const t0 = Date.now()
      const state = newTurnState(table, anonymize, undefined, { plan: base.plan, shape: sheetShapeOf(gridOf(base.plan)) }, { lookup: fileAddressLookup })
      const result = startTurn({ apiKey, system, messages, state, containerId })
      let reply = ""
      const calls: string[] = []
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") reply += part.text
        else if (part.type === "finish-step") spend("chat", usdOf(tokensOfAiSdk(part.usage)))
        else if (part.type === "tool-call") calls.push(part.toolName === "code_execution" ? "code" : part.toolName)
        else if (part.type === "tool-result" && part.toolName === "code_execution") for (const [, id] of JSON.stringify(part.output).matchAll(/"file_?[iI]d"\s*:\s*"(file_[A-Za-z0-9_-]+)"/g)) generated.add(id!)
        else if (part.type === "error") throw new Error(`stream error: ${String((part.error as { responseBody?: string }).responseBody ?? part.error)}`.slice(0, 600))
      }
      const [responseMessages, usage, steps] = await Promise.all([result.responseMessages, result.totalUsage, result.steps])
      containerId = (steps.at(-1)?.providerMetadata?.anthropic as { container?: { id?: string } } | undefined)?.container?.id ?? containerId
      messages.push(...responseMessages)
      total += usdOf(tokensOfAiSdk(usage))
      table = applyChanges(table, deriveTable(table).edited, state.pending)
      log.push({ turn: i + 1, ms: Date.now() - t0, calls, tools: state.log, pending: state.pending.length, question: state.question, reply })
      console.log(`\n# turn ${i + 1} ${Math.round((Date.now() - t0) / 1000)}s tools ${state.toolCalls} [${calls.join(",")}] 変更 ${state.pending.length}`)
      if (state.question) console.log("  question:", state.question)
      console.log("  reply:", reply.replace(/\n+/g, " ").slice(0, 400))
    }
  } finally {
    for (const id of [...uploads.map((u) => u.id), ...generated]) await anthropic.files.delete(id).catch((e) => console.log("delete failed", id, String(e).slice(0, 120)))
  }
  // 聞いたセルごとに比べる（CSV の値）
  const after = new Map(deriveTable(table).shown.map((r) => [r.key, r]))
  const before = new Map(start.shown.map((r) => [r.key, r]))
  const outcome = { correct: 0, wrong: 0, missed: 0, extra: 0, untouched: 0 }
  const details: string[] = []
  for (const q of asked) {
    const workName = nameOf.get(q.rowKey)!
    const want = truth.find((t) => t.workName === workName && t.field === q.field)?.value
    const was = before.get(q.rowKey)!.cells[q.field].value
    const now = after.get(q.rowKey)!.cells[q.field]
    const changed = now.value !== was || now.by === "confirmed"
    const kind = want === undefined ? (changed ? "extra" : "untouched") : now.value === want ? "correct" : changed ? "wrong" : "missed"
    outcome[kind]++
    if (kind !== "correct" && kind !== "untouched") details.push(`${kind}: ${workName}/${q.field} 正 ${want ?? "（答え無し）"} ⇐ ${now.value}`)
  }
  const questions = (log as { question: string | null }[]).filter((l) => l.question).length
  console.log(`\n答え ${truth.length} 件: 正しい ${outcome.correct} / 誤り ${outcome.wrong} / 抜け ${outcome.missed} / 余計 ${outcome.extra}（答えの無い ${outcome.untouched} 件はそのまま）聞き返し ${questions} 回 $${total.toFixed(3)}`)
  for (const d of details) console.log("  " + d)
  const score = compare(csvRows(table))
  writeFileSync(join(OUT!, `${caseId}-answers.json`), JSON.stringify({ asked: asked.length, truth: truth.length, outcome, details, questions, total, ms: Date.now() - t00, log }, null, 1))
  writeSummary("answers", { status: "done", score, turns: log.length, ms: Date.now() - t00, conversionUsd: base.usd, usd: total })
}

/**
 * 問い合わせのメールの下書きの照合。変換の結果（新しい案件の設定のまま）に「AI でメールの下書きを作る」と同じ指示を1回送り、件名と前置きの案を承認したものとする。
 * 数えるもの: 問い合わせの数、メールの下書きが出たか、決まった言葉・事務所の中の言葉・個人名（表の人）・工事名や注文者の値・ほかの案件の顧客名が入った文。
 * 文そのものは EVAL_OUT の結果にだけ書く（顧客の情報を含みうる）
 */
async function inquiryEval() {
  const { collectInquiries } = await import("../src/lib/inquiry/inquiry")
  const { INQUIRY_TEXT_PROMPT, otherCustomerTest } = await import("../src/lib/inquiry/text")
  const { nameGuard } = await import("../src/lib/chat/names")
  const table = tableOf(base)
  const view = deriveTable(table)
  const inquiries = collectInquiries(view.output, { tax: table.tax })
  const others = [...new Set(Object.entries(CASES).flatMap(([id, c]) => (id === caseId || c.customerName === def!.customerName ? [] : [c.customerName])))]
  const t00 = Date.now()
  const run = await chatPhase({ turns: [INQUIRY_TEXT_PROMPT], table, plan: base.plan, customerItems: def!.customerRules.split("\n").map((t) => t.trim()).filter(Boolean), inquiry: { customerName: def!.customerName, otherCustomers: async () => others } })
  // 変更案は画面の承認と同じく表に重ねてある（applyChanges が問い合わせの文面にも重ねる）
  const text = run.table.inquiryText
  const texts = [text.subject ?? "", text.intro ?? ""].filter(Boolean)
  const guard = nameGuard(table)
  const otherNames = otherCustomerTest(others, def!.customerName)
  const values = [...new Set(view.output.flatMap((r) => [r.cells.workName.value, r.cells.client.value]).filter((v) => [...v].length >= 4 && !v.includes("〔")))]
  const FIXED_WORDS = ["データに無い", "推定に自信", "AI", "CSV", "変換", "列"]
  const check = {
    personal: texts.filter((t) => guard.has(t)).length,
    otherCustomers: texts.filter(otherNames).length,
    rowValues: texts.filter((t) => values.some((v) => t.includes(v))).length,
    fixedWords: texts.filter((t) => FIXED_WORDS.some((w) => t.includes(w))).length,
  }
  const calls = run.log.flatMap((l) => (l.calls as string[]) ?? [])
  const outcome = { inquiries: inquiries.length, mail: text.subject !== null, proposeCalls: calls.filter((c) => c === "propose_inquiry").length, ...check }
  console.log(`\n問い合わせ ${outcome.inquiries} 件: メール ${outcome.mail ? "あり" : "なし"}・propose_inquiry ${outcome.proposeCalls} 回`)
  console.log(`文の確かめ: 個人名 ${check.personal} / ほかの顧客名 ${check.otherCustomers} / 工事名・注文者の値 ${check.rowValues} / 決まった言葉・中の言葉 ${check.fixedWords}  $${run.total.toFixed(3)}`)
  writeFileSync(join(OUT!, `${caseId}-inquiry.json`), JSON.stringify({ status: run.status, reason: run.reason, outcome, subject: text.subject, intro: text.intro, total: run.total, ms: Date.now() - t00, log: run.log }, null, 1))
  writeSummary("inquiry", { status: run.status, ...(run.reason ? { reason: run.reason } : {}), score: compare(csvRows(run.table)), turns: run.log.length, ms: Date.now() - t00, conversionUsd: base.usd, usd: run.total })
  if (run.error) throw run.error
}
