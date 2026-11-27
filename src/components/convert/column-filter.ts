import type { CellResult, CellStatus } from "@/lib/convert/convert"
import { cellTone, LEGEND_TONES } from "./status"

/**
 * 表の列のフィルター（Excel の見出しの ▼ と同じ）。1つの列は「値で絞る」か「色で絞る」のどちらか（Excel と同じ。両方は持たない）。
 * exclude は外す値（表示の値ではなく、セルの値。選ぶ欄の項目はコード。空白は ""）。残す値ではなく外す値で持つのは、値の一覧が
 * ほかの列・表の中の検索・直すの段で狭まっていても、一覧に無かった値を黙って隠さないため。tone は残すセルの色（cellTone）
 */
export type ColumnFilterValue = { exclude: readonly string[] } | { tone: CellStatus }

/** 列のフィルターの一覧（TanStack Table の columnFilters と同じ形。保存しない） */
export type ColumnFilters = { id: string; value: ColumnFilterValue }[]

/** 表の見え方（検索・並べ替え・列の表示・列のフィルター）。案件の画面の ui.grid（保存しない。開き直すと外れる。Excel と同じ） */
export type TableGrid = {
  query: string
  sorting: { id: string; desc: boolean }[]
  columnVisibility: Record<string, boolean>
  columnFilters: ColumnFilters
}

export const EMPTY_GRID: TableGrid = { query: "", sorting: [], columnVisibility: {}, columnFilters: [] }

/** 色で絞れる色（凡例と同じ: ルールで変換・AI・要確認・エラー。色の無い「そのまま」は出さない） */
export const FILTER_TONES = LEGEND_TONES

/** 値の一覧で空白を出す名前（Excel と同じ） */
export const BLANK_LABEL = "（空白）"

/** その列のセルがフィルターに合うか（value はその列のセルの値。cell は色を見る。元の行の列は色を持たない） */
export function matchesColumnFilter(value: string, cell: CellResult | undefined, filter: ColumnFilterValue) {
  if ("tone" in filter) return !!cell && cellTone(cell) === filter.tone
  return !filter.exclude.includes(value)
}

/** 列のフィルターを1つ差しかえる（null は外す）。並びは足した順（「絞り込み中」に出す順） */
export function withColumnFilter(filters: ColumnFilters, id: string, value: ColumnFilterValue | null): ColumnFilters {
  const rest = filters.filter((f) => f.id !== id)
  if (!value) return rest
  return filters.some((f) => f.id === id) ? filters.map((f) => (f.id === id ? { id, value } : f)) : [...rest, { id, value }]
}

/** 列の表示を変える。隠した列の絞り込みは外す（見えない列で行が消えると、なぜ消えたか分からない） */
export function withColumnVisibility(grid: TableGrid, columnVisibility: Record<string, boolean>): TableGrid {
  return { ...grid, columnVisibility, columnFilters: grid.columnFilters.filter((f) => columnVisibility[f.id] !== false) }
}

/**
 * 値の一覧（値とその件数）を、表に出す順に並べる。空白は最後（Excel と同じ）。label は表示の値（選ぶ欄の項目は名前）。
 * 件数は、ほかの列の絞り込みに合う行で数える（TanStack Table の faceted の値）
 */
export function facetItems(counts: ReadonlyMap<unknown, number>, label: (value: string) => string) {
  const items = [...counts].map(([v, n]) => {
    const value = String(v ?? "")
    return { value, label: value ? label(value) : BLANK_LABEL, count: n }
  })
  return items.sort((a, b) => (a.value === "" ? 1 : b.value === "" ? -1 : a.value.localeCompare(b.value, "ja", { numeric: true })))
}

/** その列にある色と件数（色で絞るに出す。その列にある色だけ） */
export function toneCounts(cells: Iterable<CellResult>) {
  const counts = new Map<CellStatus, number>()
  for (const c of cells) {
    const t = cellTone(c)
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return FILTER_TONES.flatMap((t) => (counts.has(t) ? [{ tone: t, count: counts.get(t)! }] : []))
}
