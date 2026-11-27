import { VIEW_LABELS, type WorkView } from "@/lib/cases/steps"

/**
 * 作業の画面に開くもの（段・表・道具。lib/cases/steps.ts）。チャットの道具の結果から、その道具の結果を見るところを開く（TOOL_TABS）
 */
export type WorkTab = WorkView

/** チャットの道具 → 結果を見るところ（表を読むだけの道具・ルールの案などは開かない） */
export const TOOL_TABS: Readonly<Record<string, WorkTab>> = {
  set_cells: "table",
  set_include: "table",
  add_rows: "table",
  set_plan: "table",
  set_selection: "export",
  ask_customer: "inquiry",
  record_answers: "inquiry",
  propose_inquiry: "inquiry",
  find_location: "location",
}

export const workTabLabel = (t: WorkTab) => VIEW_LABELS[t]
