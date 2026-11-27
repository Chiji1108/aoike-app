import type { CaseTodo } from "./todo"

/**
 * 作業の画面の「段」（答える → 業種を決める → 直す → 問い合わせ → ダウンロード）と、段とは別に置く「表」・道具（その他）。
 * 段は順番の案内だけで、どの段にもいつでも行ける（縛らない）。どれを開いているか・済んだか・今の段は、ここ1か所で決める
 */

export const STEPS = ["answer", "gyoshu", "fix", "inquiry", "export"] as const
export type StepId = (typeof STEPS)[number]
/** 道具（「その他」にまとめる。段に入らない、ときどき使うもの。7割と金額はダウンロードの段の中） */
export const TOOLS = ["location", "replace"] as const
export type ToolId = (typeof TOOLS)[number]
/** 作業の画面に出すもの: 段・表（すべての行）・道具 */
export type WorkView = StepId | "table" | ToolId

export const VIEW_LABELS: Record<WorkView, string> = {
  answer: "答える",
  gyoshu: "業種を決める",
  fix: "直す",
  inquiry: "問い合わせ",
  export: "ダウンロード",
  table: "表",
  location: "工事場所",
  replace: "一括置換",
}

/** 狭い画面の段の短い名前（横に並べて収まるように） */
export const SHORT_LABELS: Record<StepId, string> = { answer: "答える", gyoshu: "業種", fix: "直す", inquiry: "問合せ", export: "DL" }

export const isStep = (v: WorkView): v is StepId => (STEPS as readonly string[]).includes(v)
export const isTool = (v: WorkView): v is ToolId => (TOOLS as readonly string[]).includes(v)

/** 段ごとの残りの数（ダウンロードは載せる件数）。lib/cases/todo.ts が数えたものを読むだけ */
export function stepCount(todo: CaseTodo, id: StepId): number {
  if (id === "answer") return todo.answer.length
  if (id === "gyoshu") return todo.gyoshu.rows.length
  if (id === "fix") return todo.fix.rows
  if (id === "inquiry") return todo.inquiry.active
  return todo.exportRows
}

/** 段が済んだか（ダウンロードは済みにしない。いつでも何度でも出せる） */
export function stepDone(todo: CaseTodo, id: StepId): boolean {
  if (id === "inquiry") return todo.inquiry.state === "done"
  if (id === "export") return false
  return stepCount(todo, id) === 0
}

/** 今の段（最初の済んでいない段。全部済めばダウンロード） */
export const currentStep = (todo: CaseTodo): StepId => STEPS.find((id) => !stepDone(todo, id)) ?? "export"

/**
 * 段 from の次の段（from より後ろの最初の済んでいない段。無ければダウンロード）。段の中身の終わりの「済みました。次は ◯◯ →」の行き先
 * （段が済んでも勝手には移らない。押したときだけ移る）
 */
export function nextStep(todo: CaseTodo, from: StepId): StepId {
  return STEPS.slice(STEPS.indexOf(from) + 1).find((id) => !stepDone(todo, id)) ?? "export"
}

/**
 * 開いているもの。表ができたときに今の段に決め（session.ts の watch が ui.tab に書く。そのあとは段が済んでも動かない）、
 * それまで（null）は今の段
 */
export const activeView = (chosen: WorkView | null, todo: CaseTodo): WorkView => chosen ?? currentStep(todo)

/** 表の絞り込みの種類（直すの段は直す行だけ、表はすべての行。切り替えは出さない） */
export const tableKindOf = (view: WorkView): "fix" | "all" => (view === "fix" ? "fix" : "all")
