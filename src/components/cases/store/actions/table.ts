import { toast } from "sonner"
import type { GyoshuDecision } from "@/components/convert/gyoshu-panel"
import { CONFIRM_LABEL, shortLabel } from "@/components/convert/status"
import { needsConfirm } from "@/lib/cases/ask-impact"
import type { CaseWork } from "@/lib/cases/state"
import { setTax } from "@/lib/cases/tax"
import { pendingGyoshuItems } from "@/lib/cases/todo"
import { CONFIRM_UNDO, GYOSHU_UNDO, RANGE_UNDO, reportUndoId, SELECTION_UNDO } from "@/lib/cases/undo"
import { answer, approvedChange, decide } from "@/lib/chat/proposals"
import { editKey, editSession, staffEdit, type CellEdit } from "@/lib/convert/convert"
import { selectionSettled, setSelection } from "@/lib/cases/selection"
import { SELECTION_LABELS, type Rule7Tax, type SelectionMode, type TaxMode } from "@/lib/convert/koji-selection"
import { askKey, hasExclusion, type ValueFilter } from "@/lib/convert/plan"
import { applyPlanPatch, sheetShapeOf } from "@/lib/convert/plan-patch"
import type { Rounding } from "@/lib/convert/transforms"
import type { InquiryText } from "@/lib/inquiry/text"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"
import { ASK_KINDS } from "../case-view"
import { setUi, setWork } from "../create-case-store"
import type { CaseEnv } from "../env"
import { commit, undoGroup, type Committed } from "./proposals"
import { supersedeConversion } from "./source"

const SPEC = KOJI_KEIREKI

/** 報告の聞き返しの答えの取り消しの記録の単位（lib/cases/undo.ts の reportUndoId。画面の部品もここから読む） */
export { reportUndoId }

/** 作業の1つの項目を、その時点の値から変える */
const update = <K extends keyof CaseWork>(env: CaseEnv, key: K, next: (prev: CaseWork[K]) => CaseWork[K]) => setWork(env.store, (w) => ({ ...w, [key]: next(w[key]) }))

/**
 * 取り消す（その単位の、まだ取り消していない記録を新しい順に）。承認のあとに変えた値は残して知らせる。計画を戻したら、待っている変換の結果を捨てる（変換し直す）
 */
export function undoWithNotice(env: CaseEnv, group: string, what = "承認") {
  const r = undoGroup(env.store, group)
  if (!r) {
    toast.info(`${what}を取り消せません（取り消しの記録がもう無いか、取り消し済みです）`)
    return
  }
  if (r.planChanged) supersedeConversion(env)
  if (r.kept) toast.warning(`${what}を取り消しました（${r.reverted} 件を戻し、${what}のあとに変えた ${r.kept} 件はそのままにしました）`)
  else toast.success(`${what}を取り消しました（${r.reverted} 件を戻しました）`)
}

/** 取り消せる操作をした通知（取り消せるときだけ「取り消す」を出す。記録が大きすぎて取り消せないときはそう伝える） */
function notifyCommitted(env: CaseEnv, text: string, committed: Committed, group: string, what: string) {
  if (committed === "tooLarge") toast.warning(`${text}（変更が大きすぎて取り消しの記録に残せないので、取り消せません）`)
  else toast.success(text, committed === "undoable" ? { action: { label: "取り消す", onClick: () => undoWithNotice(env, group, what) } } : undefined)
}

/** 表の手直し（1回の手直しで決める項目をまとめて。主任技術者・監理技術者は2列を一緒に） */
export function editCells(env: CaseEnv, rowKey: string, changes: readonly [KojiFieldId, CellEdit][]) {
  update(env, "edits", (prev) => {
    const next = new Map(prev)
    for (const [field, e] of changes) next.set(editKey(rowKey, field), e)
    return next
  })
}

/** 一括置換（空にすると置換を外す）。個人名の記号はその時点の表の記号で読む */
export function replaceValue(env: CaseEnv, field: KojiFieldId, from: string, text: string) {
  const to = text.trim() ? staffEdit(text, env.table(env.store.getState()).letters) : undefined
  update(env, "replacements", (prev) => {
    const { [from]: _, ...rest } = prev[field] ?? {}
    return { ...prev, [field]: to ? { ...rest, [from]: to } : rest }
  })
}

/** 行を載せる・外す */
export function toggleRow(env: CaseEnv, key: string, included: boolean) {
  update(env, "manual", (prev) => new Map(prev).set(key, included))
}

/** 表の Shift＋クリックで範囲をまとめて入れ外しする（1回の操作を1つの取り消しの記録に） */
export function toggleRange(env: CaseEnv, keys: readonly string[], included: boolean, skippedExcluded: number) {
  const skipped = skippedExcluded ? `（除外の ${skippedExcluded} 行は入れていません）` : ""
  if (!keys.length) {
    toast.info(`範囲の行はもう${included ? "載せています" : "外しています"}${skipped}`)
    return
  }
  const id = `${RANGE_UNDO}${crypto.randomUUID()}`
  const committed = commit(env.store, { group: id }, ({ work: w }) => {
    const manual = new Map(w.manual)
    for (const k of keys) manual.set(k, included)
    return { ...w, manual }
  })
  notifyCommitted(env, `${keys.length} 行を${included ? "載せました" : "外しました"}${skipped}`, committed, id, "まとめての入れ外し")
}

/**
 * 「これでよい」: 要確認・AI の推定の値を、職員が同じ値を手で入れた手直し（by staff）にする（表で手で入れたのと同じ editSession）。
 * 値はその時点の表から読む。取り消しの記録に残す
 */
export function confirmCell(env: CaseEnv, rowKey: string, field: KojiFieldId) {
  const id = `${CONFIRM_UNDO}${crypto.randomUUID()}`
  let found = false
  const committed = commit(env.store, { group: id }, (s) => {
    const { shown, letters } = env.table(s)
    const cell = shown?.find((r) => r.key === rowKey)?.cells[field]
    if (!cell) return s.work
    found = true
    const session = editSession(cell, letters)
    return { ...s.work, edits: new Map(s.work.edits).set(editKey(rowKey, field), session.read(session.text)) }
  })
  if (found) notifyCommitted(env, `${shortLabel(field)}を確かめた値にしました`, committed, id, `「${CONFIRM_LABEL}」`)
}

/**
 * 業種の一覧で決める（1回の操作を1つの取り消しの記録に）。値は職員が決めた手直し（表で選んだのと同じ staffEdit）。
 * 案が AI の案の変更案の未決の項目なら、案のまま決めた行はその項目を承認（承認と同じ値・注意書き）、違う値を選んだ行はその項目を却下にする。
 * 取り消すと値を戻す（変更案の項目は決めたまま。チャットの承認の取り消しと同じ）。項目と個人名の記号はその時点の状態から引く
 */
export function decideGyoshu(env: CaseEnv, decisions: readonly GyoshuDecision[], how: "plan" | "pick") {
  if (!decisions.length) return
  const id = `${GYOSHU_UNDO}${crypto.randomUUID()}`
  const committed = commit(env.store, { group: id }, (s) => {
    const { work: w, contents } = s
    const { letters } = env.table(s)
    const pending = pendingGyoshuItems(w.proposals, contents)
    const edits = new Map(w.edits)
    const decided = new Map<string, { applied: number[]; rejected: number[] }>()
    for (const d of decisions) {
      const item = pending.get(d.key)
      const same = item?.edit.value === d.value
      if (item) {
        const x = decided.get(item.proposalId) ?? { applied: [], rejected: [] }
        ;(same ? x.applied : x.rejected).push(item.index)
        decided.set(item.proposalId, x)
      }
      // 案のまま決めた AI の案は、承認したときと同じ値（推定の印を外し、根拠を注意書きに残す）
      const approved = item && same ? approvedChange(w.proposals.find((x) => x.id === item.proposalId)!, { kind: "cell", rowKey: d.key, field: "gyoshu", edit: item.edit }) : null
      edits.set(editKey(d.key, "gyoshu"), approved?.kind === "cell" ? approved.edit : staffEdit(d.value, letters))
    }
    const proposals = w.proposals.map((p) => {
      const x = decided.get(p.id)
      return x ? decide(decide(p, x.applied, "applied"), x.rejected, "rejected") : p
    })
    return { ...w, edits, proposals }
  })
  notifyCommitted(env, how === "plan" ? `${decisions.length} 行の業種を案のまま決めました` : "業種を決めました", committed, id, "業種の決定")
}

/**
 * 載せる工事の選び方を変える（ダウンロードの段の7割と金額の「載せる工事」・表の「載せる」の見出しのチェック・「全件にしますか？」で同じ）。
 * 取り消しの記録に残し、通知の「取り消す」で戻せる。職員が選んだので「答える」の載せる工事にも答えたことにする
 */
export function changeSelection(env: CaseEnv, mode: SelectionMode) {
  // 同じ選び方にもう答えているときだけ何もしない（既定値と同じ値を選んでも、答えたことになる。lib/cases/selection.ts）
  if (selectionSettled(env.store.getState().work, mode)) return
  const id = `${SELECTION_UNDO}${crypto.randomUUID()}`
  // 選び方と一緒に「答えた」を書く（「答える」の載せる工事にも答えたことになる。取り消すと一緒に戻る）
  const committed = commit(env.store, { group: id }, ({ work: w }) => setSelection(w, mode, true))
  notifyCommitted(env, `載せる工事を${SELECTION_LABELS[mode]}にしました`, committed, id, "載せる工事の切り替え")
}

/** 問い合わせに入れる・外す（外した問い合わせは添付・件数に入れない） */
export function toggleInquiry(env: CaseEnv, key: string, ask: boolean) {
  update(env, "dismissed", (prev) => {
    const next = new Set(prev)
    if (ask) next.delete(key)
    else next.add(key)
    return next
  })
}

/** 問い合わせのメールの件名・前置き */
export function setInquiryText(env: CaseEnv, next: (prev: InquiryText) => InquiryText) {
  update(env, "inquiryText", next)
}

/** Excel の金額が税込か（職員が決めた） */
export const setTaxMode = (env: CaseEnv, t: TaxMode) => setWork(env.store, (w) => setTax(w, t, "staff"))
export const setRule7Tax = (env: CaseEnv, t: Rule7Tax) => update(env, "rule7Tax", () => t)
export const setRounding = (env: CaseEnv, r: Rounding) => update(env, "rounding", () => r)
/** 業種ごとの決算書の額（基準額） */
export const setBasis = (env: CaseEnv, code: string, side: "total" | "motouke", v: number | undefined) =>
  update(env, "basis", (prev) => ({ ...prev, [code]: { ...prev[code], [side]: v } }))
/** 手動の入れ外しを戻す */
export const clearManual = (env: CaseEnv) => update(env, "manual", () => new Map())
/** 「全件にしますか？」を閉じる */
export const closeAllHint = (env: CaseEnv) => update(env, "allHintClosed", () => true)

/** 変更案の聞き返しに答える（変更案があれば「はい」で承認できるようになる。いいえで全部を却下） */
export function answerProposal(env: CaseEnv, id: string, a: "yes" | "no") {
  setWork(env.store, (w) => ({ ...w, proposals: w.proposals.map((p) => (p.id === id ? answer(p, a) : p)) }))
}

/**
 * 報告の聞き返しに答える。税込・税抜の答えは取り消しの記録（cases/undo.ts）に残す（取り消すと聞き返しを開き直し、税の設定も戻る）。
 * 計画の聞き返しで載せる件数が大きく減る答えは、押す前に何件減るか・7割に届くかの確かめを出す（数はその時点の状態から）
 */
export function answerReport(env: CaseEnv, id: string, value: string) {
  const { store } = env
  if (id === "selection") {
    // 載せる工事（7割ルール／全件）。答えたあとも表の見出しのチェック・ダウンロードの段の7割と金額で変えられる
    if (value !== "rule7" && value !== "all") return
    commit(store, { group: reportUndoId(id) }, ({ work: w }) => setSelection(w, value, true))
    return
  }
  if (id === "tax") {
    // 「分からない（顧客に聞く）」も職員が決めた値（計画のし直しで上書きしない）
    const next = value === "included" || value === "excluded" ? value : "unknown"
    commit(store, { group: reportUndoId(id) }, ({ work: w }) => ({ ...setTax(w, next, "staff"), reportAnswers: { ...w.reportAnswers, tax: value === "ask" ? "ask" : next } }))
    return
  }
  const { askRows, askEffects, planAsks } = env.view(store.getState())
  const i = askRows.findIndex((r) => r.id === id)
  // 答えるのは押した聞き返しの鍵（確かめを開いている間に計画が変わっても、別の聞き返しに当てない）
  const key = askRows[i]?.key
  if (!key) return
  if (value === "keep") return answerAsk(env, key, value)
  if (value !== "exclude") return
  const effect = askEffects[i]
  if (effect?.impact && needsConfirm(effect.impact)) {
    const { before, after, shortBefore, shortAfter } = effect.impact
    const newlyShort = shortAfter.filter((g) => !shortBefore.includes(g))
    setUi(store, (u) => ({
      dialogs: {
        ...u.dialogs,
        askConfirm: {
          key,
          option: ASK_KINDS[planAsks[i]!.kind].options.find((o) => o.value === "exclude")!.label,
          title: `載せる工事が ${before} 件から ${after} 件に減ります`,
          lines: [
            effect.facts,
            after === 0 ? "載せる工事がなくなります。" : newlyShort.length ? `7割に届かなくなります: ${newlyShort.join("・")}` : "7割には届きます（決算書の額を入れていない業種は、表の合計で見ています）。",
          ].filter((x): x is string => !!x),
        },
      },
    }))
    return
  }
  answerAsk(env, key, value)
}

/** 聞き返しの答えの確かめを閉じる（ok なら「載せない」で答える） */
export function closeAskConfirm(env: CaseEnv, ok: boolean) {
  const pending = env.store.getState().ui.dialogs.askConfirm
  if (ok && pending) answerAsk(env, pending.key, "exclude")
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, askConfirm: null } }))
}

/**
 * 計画の聞き返しに答える。「載せない」側は対象の行を計画の出さない行に足して変換し直す（チャットの set_plan と同じ差分・確かめ方）。
 * 答えと足した分は取り消しの記録（税の答えと同じ記録）に残し、取り消すと答えと足した分だけを戻す（もう同じ除外があれば足さない）。
 * 計画・元のシートはその時点の状態から読み、聞き返しは鍵（askKey）で今の計画から探す（計画を立て直して無くなっていれば答えない）
 */
export function answerAsk(env: CaseEnv, key: string, value: "exclude" | "keep") {
  const { store } = env
  const s0 = store.getState()
  const plan0 = s0.work.plan
  const ask = plan0?.plan.asks?.find((a) => askKey(a) === key)
  if (!ask || !plan0) {
    toast.info("計画を立て直したので、この聞き返しはもうありません（答えていません）")
    return
  }
  const added: ValueFilter[] = value === "exclude" && !hasExclusion(plan0.plan.rowFilter, ask) ? [{ column: ask.column, values: ask.values }] : []
  const patch = { excludeRows: { add: added, remove: [] }, reason: ASK_KINDS[ask.kind].label }
  if (added.length) {
    const { grid } = env.table(s0)
    const { source } = s0.runtime
    if (!grid || !source) {
      toast.error("変換の元のファイルを読んでいます。読み終えてから答えてください")
      return
    }
    // 今の計画で確かめて知らせる。反映は下で、そのときの計画に重ねる（間に変わった計画を古い計画で上書きしない）
    const r = applyPlanPatch(SPEC, plan0.plan, patch, sheetShapeOf(grid), source.sheets)
    if (!r.ok) {
      toast.error(`答えを反映できません: ${r.problems.join(" / ")}`)
      return
    }
    supersedeConversion(env)
  }
  commit(store, { group: reportUndoId(key), exclusions: added }, (s) => {
    const w = s.work
    // 間に計画が立て直されて聞き返しが無くなっていれば答えない
    if (!w.plan || !w.plan.plan.asks?.some((a) => askKey(a) === key)) return w
    let plan = w.plan
    if (added.length) {
      const { grid } = env.table(s)
      const { source } = s.runtime
      // 元を読み直している間（シートが無い）・間に変わった計画には重ねられない: 答えずに残す（聞き返しは開いたまま）
      if (!grid || !source) return w
      const r = applyPlanPatch(SPEC, w.plan.plan, patch, sheetShapeOf(grid), source.sheets)
      if (!r.ok) return w
      plan = { ...w.plan, plan: r.plan }
    }
    return { ...w, ...(added.length ? { plan, converted: false } : {}), reportAnswers: { ...w.reportAnswers, [key]: value } }
  })
}
