import { useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  Subscribe,
  tableFeatures,
  useTable,
  type Column,
  type Header,
  type Updater,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDown, ArrowDownWideNarrow, ArrowRight, ArrowUp, ArrowUpNarrowWide, Check, ChevronDown, Columns3, Funnel, ListChecks, MapPin, MessageCircleQuestion, RefreshCw, Search, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CellEdit, CellResult, EditSession, RowResult } from "@/lib/convert/convert"
import { INCLUSION_LABELS, rangeToggle, SELECTION_LABELS, type Inclusion, type SelectionMode } from "@/lib/convert/koji-selection"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import type { CsvSpec } from "@/lib/spec/types"
import { cn } from "@/lib/utils"
import { choiceLabel, choicesOf } from "@/lib/spec/choices"
import { CellPicker } from "./cell-picker"
import { facetItems, matchesColumnFilter, toneCounts, type ColumnFilterValue, type TableGrid } from "./column-filter"
import {
  CONFIRM_LABEL,
  FIX_ACTIONS,
  FIX_KINDS,
  FIX_LABELS,
  LEGEND_TIPS,
  LEGEND_TONES,
  NO_FIX,
  ROW_FILTERS,
  STATUS,
  askText,
  cellClass,
  cellTone,
  changedCell,
  fixActionGroups,
  fixActionText,
  fixText,
  inFilter,
  type FixActionId,
  type FixCounts,
  type RowFix,
  type TableFilter,
} from "./status"

type Row = RowResult<KojiFieldId>

/**
 * 列のフィルター（見出しの ▼）は TanStack Table の列のフィルター。値の一覧（faceted）は、その列の ▼ を開いたときだけ数える
 * （ほかの列の絞り込みに合う行で。TanStack Table が覚えるので、開いている間に描き直しても数え直さない）
 */
const features = tableFeatures({
  columnVisibilityFeature,
  columnFilteringFeature,
  columnFacetingFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
})
const columnHelper = createColumnHelper<typeof features, Row>()

/**
 * 列の幅（px）。表に出す行だけで列の幅が決まると、スクロールで幅が揺れるので固定する。
 * 「載せる」と「元の行」の列もここで持つ
 */
const WIDTH: Record<KojiFieldId | "include" | "reasons" | "origin", number> = {
  // 載せるはチェックだけ（7割ルール・全件の別はツールチップ。手で入れ外しした行・除外の行だけ小さな印）
  include: 40,
  // 直す理由と直し方（直すの段の表だけ）
  reasons: 240,
  origin: 84,
  // 「コード 名前」が折り返さない幅（いちばん長い業種「10 タイル・れんが・ブロック」で決める）
  gyoshu: 184,
  client: 170,
  motoukeShitauke: 92,
  jv: 44,
  workName: 240,
  prefecture: 80,
  place: 140,
  engineer: 104,
  amount: 92,
  specialAmount: 108,
  startYm: 80,
  endYm: 80,
  chiefEngineer: 104,
  supervisingEngineer: 104,
}

/** 職員が変えられる列の幅の下限と上限（px）。下限は見出しの名前と ▼ がまだ読める幅、上限は横に2画面ぶんにならない幅 */
const MIN_WIDTH = 48
const MAX_WIDTH = 640
/** 列の幅のつまみで矢印キーを1回押したときに変える幅（px。Shift を押しながらは大きく） */
const KEY_STEP = 16
const KEY_STEP_LARGE = 64
/**
 * 列の幅の定義: 既定は WIDTH、職員が境目で変えられる（「載せる」の列は sticky で左に貼り付けるので変えない）。
 * 既定が下限より狭い列（JV）は、既定の幅を下限にする（何もしないうちに幅が変わらない）
 */
const sized = (id: keyof typeof WIDTH) => ({ size: WIDTH[id], minSize: Math.min(MIN_WIDTH, WIDTH[id]), maxSize: MAX_WIDTH })

/** 手直し中のセル。下書きは行の外に持つ（仮想スクロールで行が消えても残る） */
type Editing = { row: string; field: KojiFieldId; session: EditSession; draft: string }

/** 注意書きを出すセル（選んだ・マウスを乗せたセル）。via は選んだ（フォーカス・手直し）かマウスを乗せただけか */
type Active = { row: string; field: KojiFieldId; via: "focus" | "hover" }

const NOTE_ID = "preview-cell-note"

/**
 * 注意書きを出すセルの小さな store。表の state に持つとマウスを動かすたびに表全体を描き直すので、
 * 注意書きの1行と、選んだかが変わったセルだけが読む
 */
function activeStore() {
  let active: Active | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => active,
    set(next: Active) {
      if (active && active.row === next.row && active.field === next.field && active.via === next.via) return
      active = next
      for (const l of listeners) l()
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}
type ActiveStore = ReturnType<typeof activeStore>

/** 絞り込みを比べる鍵（止めた並びがどの絞り込みのものか） */
const filterKey = (f: TableFilter) => `${f.kind}|${f.reason ?? ""}|${f.ask ?? ""}`

/**
 * 表の見え方の鍵（絞り込み・検索・並べ替え・列のフィルター・列の表示。変わったら止めた並びと Shift＋クリックの起点を捨てる。
 * 列の表示も入れるのは、検索が見えている列だけを探すので、列を出し入れすると検索に合う行が変わるため。
 * 列の幅は入れない（幅を変えても合う行も並びも変わらないので、手直しのあと止めた並びのままにする）
 */
const viewKey = (f: TableFilter, needle: string, grid: TableGrid) =>
  `${filterKey(f)}|${needle}|${JSON.stringify(grid.sorting)}|${JSON.stringify(grid.columnFilters)}|${JSON.stringify(grid.columnVisibility)}`

const resolve = <T,>(u: Updater<T>, old: T) => (typeof u === "function" ? (u as (o: T) => T)(old) : u)

/** 値の一覧に一度に出す数（数千の値を描かない。残りは一覧の中の検索で探す） */
const SHOWN_VALUES = 300

const originText = (r: Row) => `${r.sheet}!${r.row + 1}`

/** 行の理由として見せる数（残りは「他 N」。全部はツールチップ） */
const SHOWN_FIXES = 2

/** 計画の聞き返しの対象の行（表で見る） */
export type AskRows = { id: string; label: string; keys: ReadonlySet<string> }

export const ACTION_ICONS: Record<FixActionId, React.ReactNode> = { decideGyoshu: <ListChecks />, findLocation: <MapPin />, askCustomer: <MessageCircleQuestion /> }

export function PreviewTable({
  spec,
  rows,
  inclusion,
  openEditor,
  onEdit,
  onToggle,
  onToggleRange,
  selection,
  onSelection,
  filter,
  onFilterChange,
  fixes,
  counts,
  asks,
  onOpenInquiry,
  onFixAction,
  onConfirm,
  confirmUndo,
  onGoFix,
  visible,
  grid,
  onQuery,
  onSorting,
  onColumnVisibility,
  onColumnSizing,
  onColumnFilter,
  onClearColumnFilters,
}: {
  spec: CsvSpec<KojiFieldId>
  rows: Row[]
  inclusion: ReadonlyMap<string, Inclusion>
  /** 手直しを始める（直す元の文字列は個人名の記号を「〔Ａ〕」の形で出し、確定した文字列は同じ記号の表で読む） */
  openEditor: (cell: CellResult) => EditSession
  /** 手直し（主任技術者・監理技術者の欄は2列を一緒に決める） */
  onEdit: (rowKey: string, edits: readonly [KojiFieldId, CellEdit][]) => void
  onToggle: (rowKey: string, included: boolean) => void
  /** Shift＋クリックの範囲の入れ外し（1回の操作。keys は手動にする行、skippedExcluded は載せる向きで入れなかった除外の行の数） */
  onToggleRange: (keys: readonly string[], included: boolean, skippedExcluded: number) => void
  /** 載せる工事の選び方（見出しのチェック。ダウンロードの段の7割と金額の「載せる工事」と同じ設定） */
  selection: SelectionMode
  onSelection: (m: SelectionMode) => void
  /** 絞り込み（案件の画面が持つ。直すの段は直す行・表はすべての行。聞き返しの「表で見る」を押しても変わる） */
  filter: TableFilter
  onFilterChange: (f: TableFilter) => void
  /** 行の片付けること（rowFix）と、直す行の数（countFixes）。案件の画面が1回だけ数えて渡す */
  fixes: ReadonlyMap<string, RowFix<KojiFieldId>>
  counts: FixCounts
  /** 計画の聞き返しの対象の行（filter.ask で絞る） */
  asks: readonly AskRows[]
  /** 問い合わせのタブを開く（顧客に聞く行から） */
  onOpenInquiry: () => void
  /** 直し方の操作を押したとき（keys はその行） */
  onFixAction: (action: FixActionId, keys: readonly string[]) => void
  /** 「これでよい」: 要確認・AI の推定の値を、職員が確かめた値にする（取り消せる） */
  onConfirm: (rowKey: string, field: KojiFieldId) => void
  /** 直前の「これでよい」を取り消す（取り消せるときだけ） */
  confirmUndo: (() => void) | null
  /**
   * 直すの段を開く（すべての行の表だけ。表ではセルの色・凡例・ツールチップで直すセルは分かるが、行の理由と直し方〔業種を決める・これでよいなど〕は直すの段の列にだけ出すので、そこへの道）
   */
  onGoFix?: () => void
  /** 表が画面に見えているか（隠れている間は行の高さを測らない） */
  visible: boolean
  /** 表の見え方（検索・並べ替え・列の表示・列のフィルター）。案件の画面が持つ（ui.grid。直すの段と表で同じ） */
  grid: TableGrid
  onQuery: (query: string) => void
  onSorting: (sorting: TableGrid["sorting"]) => void
  /** 隠した列の絞り込みは、受け取った側で外す */
  onColumnVisibility: (v: TableGrid["columnVisibility"]) => void
  /** 列の幅（見出しの境目のドラッグ・矢印キー・ダブルクリックで戻す） */
  onColumnSizing: (v: TableGrid["columnSizing"]) => void
  onColumnFilter: (id: string, value: ColumnFilterValue | null) => void
  onClearColumnFilters: () => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const setFilter = onFilterChange
  const { query, sorting, columnVisibility, columnFilters, columnSizing } = grid
  const needle = query.trim().toLowerCase()
  /**
   * 手直しを始めたときの表示の行（キーの並び）。手直しで行が絞り込み・列のフィルターから外れたり並べ替えで動いたりしても、
   * 絞り込み・並べ替え・検索・列のフィルターを変えるか「更新」を押すまではこの並びのまま出す
   */
  const [pinned, setPinned] = useState<readonly string[] | null>(null)
  const unpin = () => setPinned(null)
  // 見え方が変わったら（表の上でも、次にやること・「表で見る」など外からでも）止めた並びを捨てる（描くときに1か所で）
  const view = viewKey(filter, needle, grid)
  const [pinnedView, setPinnedView] = useState(view)
  if (pinnedView !== view) {
    setPinnedView(view)
    setPinned(null)
  }

  /** 直す理由と直し方の列は、直す行の絞り込み（直すの段）だけに出す（表では出さない） */
  const reasonsColumn = filter.kind === "fix"
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({ id: "include", header: "載せる", enableHiding: false, enableResizing: false, size: WIDTH.include, minSize: WIDTH.include, maxSize: WIDTH.include }),
        ...(reasonsColumn ? [columnHelper.display({ id: "reasons", header: "直す理由と直し方", enableHiding: false, ...sized("reasons") })] : []),
        columnHelper.accessor(originText, {
          id: "origin",
          header: "元の行",
          ...sized("origin"),
          sortFn: "alphanumeric",
          filterFn: (row, _id, fv: ColumnFilterValue) => matchesColumnFilter(originText(row.original), undefined, fv),
        }),
        ...spec.fields.map((f) =>
          // CSV の列（A〜N）との対応は見出しの ▼ の中に出す
          columnHelper.accessor((r) => r.cells[f.id].value, {
            id: f.id,
            header: f.label,
            ...sized(f.id),
            sortFn: "alphanumeric",
            filterFn: (row, _id, fv: ColumnFilterValue) => matchesColumnFilter(row.original.cells[f.id].value, row.original.cells[f.id], fv),
          }),
        ),
      ]),
    [spec, reasonsColumn],
  )
  const store = useRef<ActiveStore | null>(null)
  store.current ??= activeStore()

  const data = useMemo(() => {
    const visible = (id: string) => columnVisibility[id] !== false
    const searched = spec.fields.filter((f) => visible(f.id))
    // 決まった値の項目は表に出す名前（「電気」など）でも探せる
    const hasText = (r: Row) =>
      (visible("origin") && originText(r).toLowerCase().includes(needle)) ||
      searched.some((f) => r.cells[f.id].value.toLowerCase().includes(needle) || (choiceLabel(f, r.cells[f.id].value)?.toLowerCase().includes(needle) ?? false))
    const ask = asks.find((a) => a.id === filter.ask)
    const asked = (key: string) => ask?.keys.has(key) ?? false
    return rows.filter((r) => inFilter(filter, fixes.get(r.key) ?? NO_FIX, inclusion.get(r.key)?.included ?? false, asked, r.key) && (!needle || hasText(r)))
  }, [rows, fixes, inclusion, filter, asks, needle, columnVisibility, spec])
  const activeAsk = asks.find((a) => a.id === filter.ask)

  const table = useTable(
    {
      features,
      data,
      columns,
      getRowId: (r) => r.key,
      onSortingChange: (u) => onSorting(resolve(u, sorting)),
      onColumnVisibilityChange: (u) => onColumnVisibility(resolve(u, columnVisibility)),
      onColumnFiltersChange: (u) => {
        const next = resolve(u, columnFilters)
        for (const id of new Set([...columnFilters, ...next].map((f) => f.id))) onColumnFilter(id, (next.find((f) => f.id === id)?.value as ColumnFilterValue | undefined) ?? null)
      },
      /**
       * 列の幅は離したときに決める（onEnd。Excel と同じく、ドラッグの間は境目の線だけが動く）。ドラッグの間に幅を変え続けると、
       * 行が多いときに表全体を毎フレーム描き直して重い。ドラッグの途中（columnResizing）は TanStack Table の中に持ち、境目のつまみだけが読む
       */
      enableColumnResizing: true,
      columnResizeMode: "onEnd",
      onColumnSizingChange: (u) => {
        // 幅は整数の px で持つ（タッチの引きで小数になる）
        const next = Object.fromEntries(Object.entries(resolve(u, columnSizing)).map(([id, w]) => [id, Math.round(w)]))
        // 動かさずに離した（どの列の幅も今と同じ）ときは書かない
        const width = (sizing: TableGrid["columnSizing"], id: string) => sizing[id] ?? WIDTH[id as keyof typeof WIDTH]
        const ids = new Set([...Object.keys(columnSizing), ...Object.keys(next)])
        if ([...ids].some((id) => width(next, id) !== width(columnSizing, id) || (id in next) !== (id in columnSizing))) onColumnSizing(next)
      },
      state: { sorting, columnVisibility, columnFilters, columnSizing },
    },
    // 表を描き直すのは決まった状態が変わったときだけ（ドラッグの途中の columnResizing では描き直さない）
    (s) => ({ sorting: s.sorting, columnVisibility: s.columnVisibility, columnFilters: s.columnFilters, columnSizing: s.columnSizing }),
  )
  const filtered = table.getFilteredRowModel().rows
  const live = table.getRowModel().rows.map((r) => r.original)
  /** まとめて頼める直し方: 今の絞り込み（理由・検索・列の絞り込み）で見えている行だけ（件数もその行で） */
  const fixGroups = useMemo(
    () => (filter.kind === "fix" && !filter.ask ? fixActionGroups(filtered.map((r) => r.original), inclusion, fixes, filter.reason) : []),
    [filtered, inclusion, fixes, filter],
  )
  const liveKeys = new Set(live.map((r) => r.key))
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const shown = pinned ? pinned.flatMap((k) => byKey.get(k) ?? []) : live
  const outdated = pinned !== null && (shown.length !== live.length || shown.some((r, i) => r.key !== live[i]!.key))
  const visibleColumns = table.getVisibleLeafColumns()

  function startEdit(r: Row, field: KojiFieldId) {
    if (editing) finishEdit(true)
    setPinned((p) => p ?? live.map((r) => r.key))
    store.current!.set({ row: r.key, field, via: "focus" })
    const session = openEditor(r.cells[field])
    setEditing({ row: r.key, field, session, draft: session.text })
  }
  function finishEdit(commit: boolean) {
    if (!editing) return
    setEditing(null)
    if (commit && editing.draft !== editing.session.text) onEdit(editing.row, [[editing.field, editing.session.read(editing.draft)]])
  }
  /** 選ぶ欄で選んだ値を入れる（変わった項目だけ）。閉じたらセルに戻る（キーボードで続けて動ける） */
  /** restoreFocus は選んだ・Escape で閉じたとき（外を押して閉じたときは、押した先のフォーカスを奪わない） */
  function finishPick(r: Row, picked: Partial<Record<KojiFieldId, string>> | undefined, restoreFocus: boolean) {
    if (!editing) return
    const { row, field, session } = editing
    setEditing(null)
    const changed = Object.entries(picked ?? {}).filter(([f, v]) => r.cells[f as KojiFieldId].value !== v) as [KojiFieldId, string][]
    if (changed.length) onEdit(row, changed.map(([f, v]) => [f, session.read(v)]))
    if (restoreFocus) requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(row)}"] td[data-field="${field}"] button`)?.focus())
  }
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  /**
   * Shift＋クリックの範囲の起点: 前に「載せる」を押した行と、そのとき見えていた行の並び。並びを覚えるのは、「直す」の絞り込みなどで
   * 押した行が入れ外しで表から消えても、続けて Shift＋クリックした範囲がその行から始まるように
   */
  const [rangeAnchor, setRangeAnchor] = useState<{ key: string; included: boolean; order: readonly string[] } | null>(null)
  // 絞り込み・検索・並べ替え・選び方が変わったら起点を捨てる（思わぬ広い範囲にしない。描くときに1か所で）
  const anchorView = `${view}|${selection}`
  const [anchorViewSeen, setAnchorViewSeen] = useState(anchorView)
  if (anchorViewSeen !== anchorView) {
    setAnchorViewSeen(anchorView)
    setRangeAnchor(null)
  }
  /**
   * 行の「載せる」を押した。Shift を押しながらなら、前に押した行から今の行まで（前に押したときに見えていた行）を今の向きにそろえる
   * （キーボードの Shift＋Space も同じ。Base UI は押したときのキーの状態を event に載せる）。
   * 起点の行が押したときの向きでなくなっていれば（取り消しで戻ったなど）起点にしない
   */
  function toggleRow(key: string, included: boolean, event: Event) {
    const from = rangeAnchor && rangeAnchor.key !== key && inclusion.get(rangeAnchor.key)?.included === rangeAnchor.included ? rangeAnchor : null
    const range = from && "shiftKey" in event && event.shiftKey ? rangeToggle(from.order, from.key, key, included, inclusion) : null
    setRangeAnchor({ key, included, order: range ? from!.order : shown.map((r) => r.key) })
    if (range) onToggleRange(range.keys, included, range.skippedExcluded)
    else onToggle(key, included)
  }
  /** 項目ごとの定義と選ぶ欄（描くたびに作らない） */
  const fieldInfo = useMemo(() => new Map(spec.fields.map((f) => [f.id, { spec: f, choices: choicesOf(f) }])), [spec])
  /** 値の一覧に出す表示の値（選ぶ欄の項目は名前。業種・元請下請はコードも添える。セルと同じ） */
  const valueLabel = useMemo(
    () => (columnId: string, v: string) => {
      const f = fieldInfo.get(columnId as KojiFieldId)
      const named = f && choiceLabel(f.spec, v)
      return named ? (f.choices?.kind === "codes" && f.choices.set !== "flag" ? `${v} ${named}` : named) : v
    },
    [fieldInfo],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
    getItemKey: (i) => shown[i]!.key,
    // 隠れている間（作業の画面でほかの段を開いている・作業の画面を閉じている）は行の高さを測らない（隠れた行は高さ 0 と測られ、
    // 戻ったときの測り直しでスクロールの位置がずれる）。測った高さを使い続け、見えたら測る
    useCachedMeasurements: !visible,
  })
  const items = virtualizer.getVirtualItems()
  const padTop = items[0]?.start ?? 0
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)

  function renderCell(r: Row, columnId: string) {
    if (columnId === "include") {
      const inc = inclusion.get(r.key)
      // 印は手で入れ外しした行と除外の行だけ（7割ルール・全件の別はツールチップ）
      const mark = inc?.reason === "manual" ? "手" : inc?.reason === "excluded" ? "除外" : null
      const tip = [inc && INCLUSION_LABELS[inc.reason] ? `${inc.included ? "載せる" : "載せない"}（${INCLUSION_LABELS[inc.reason]}）` : "載せない", r.excluded, "Shift を押しながら押すと、前に押した行からここまでをまとめて入れ外しします"]
        .filter(Boolean)
        .join("\n")
      return (
        <TableCell key={columnId} className="sticky left-0 z-10 border-b bg-card px-0 py-1.5 text-center">
          <label className="flex flex-col items-center gap-0.5" title={tip} data-reason={inc?.reason}>
            <Checkbox aria-label="CSVに載せる" checked={inc?.included ?? false} onCheckedChange={(checked, details) => toggleRow(r.key, checked, details.event)} />
            {mark && (
              <span className="text-[10px] leading-none text-muted-foreground" data-testid="include-mark">
                {mark}
              </span>
            )}
          </label>
          {!liveKeys.has(r.key) && (
            <span className="mt-0.5 block text-[10px] leading-none text-amber-700" data-testid="row-unmatched" title="手直しで、今の絞り込み・検索に合わなくなりました。「更新」で表から外れます">
              !
            </span>
          )}
        </TableCell>
      )
    }
    if (columnId === "reasons") {
      const inc = inclusion.get(r.key)
      return (
        <TableCell key={columnId} className="border-b border-l px-2 py-1 align-top" data-testid="reasons-cell">
          {inc?.included && <RowReasons fix={fixes.get(r.key) ?? NO_FIX} onOpenInquiry={onOpenInquiry} onFixAction={(a) => onFixAction(a, [r.key])} onConfirm={(f) => onConfirm(r.key, f)} />}
        </TableCell>
      )
    }
    if (columnId === "origin") {
      return (
        <TableCell key={columnId} className="num border-b px-2 py-1.5 text-muted-foreground" title={originText(r)} data-testid="origin-cell">
          {/* 列からはみ出さない。行番号は必ず見せ、長いシート名の側を「…」で縮める（全部はマウスを乗せると出る） */}
          <span className="flex min-w-0">
            <span className="truncate">{r.sheet}</span>
            <span className="shrink-0">!{r.row + 1}</span>
          </span>
        </TableCell>
      )
    }
    const field = columnId as KojiFieldId
    const cell = r.cells[field]
    const isEditing = editing?.row === r.key && editing.field === field
    const { spec: spec_, choices } = fieldInfo.get(field)!
    const named = choiceLabel(spec_, cell.value)
    return (
      <TableCell
        key={columnId}
        className={cn("border-b border-l p-0 align-top whitespace-normal", cellClass(cell))}
        data-field={field}
        data-status={cell.status}
        data-tone={cellTone(cell)}
        data-changed={changedCell(cell) ? "1" : undefined}
      >
        {isEditing && choices ? (
          <>
            <div ref={setAnchor} className="min-h-8 px-2 py-1.5 ring-2 ring-ring ring-inset">
              <CellValue value={cell.value} named={named} code={choices.kind === "codes" && choices.set !== "flag"} />
            </div>
            <CellPicker
              anchor={anchor}
              field={field}
              label={choices.kind === "engineerRole" ? "配置技術者の立場" : spec_.label}
              choices={choices}
              values={Object.fromEntries(spec.fields.map((f) => [f.id, r.cells[f.id].value])) as Record<KojiFieldId, string>}
              onPick={(picked) => finishPick(r, picked, true)}
              onCancel={(restore) => finishPick(r, undefined, restore)}
            />
          </>
        ) : isEditing ? (
          <CellEditor value={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onDone={finishEdit} />
        ) : (
          // 注意書きはセルの下に出さない（色で状態は分かる）。選んだ・マウスを乗せたセルのものを表の上の1行に出す（キーボードで選んでも出る）
          <CellButton
            store={store.current!}
            row={r.key}
            field={field}
            // ツールチップはセルに1つ: 注意書きがあればそれ、無ければ「…」で切れうる決まった値の全部（「コード 名前」）
            title={cell.message || (named ? (choices?.kind === "codes" && choices.set !== "flag" ? `${cell.value} ${named}` : named) : undefined)}
            onClick={() => startEdit(r, field)}
            hasPopup={!!choices}
          >
            <CellValue value={cell.value} named={named} code={choices?.kind === "codes" && choices.set !== "flag"} />
          </CellButton>
        )}
      </TableCell>
    )
  }

  /** 載せない行の数（全件のときは手で外した行と除外の行。見出しに添える） */
  const offCount = useMemo(() => [...inclusion.values()].filter((i) => !i.included).length, [inclusion])

  const tableWidth = table.getTotalSize()

  // 置かれた欄の高さに合わせ、表の中だけをスクロールする（作業の画面の「表」のタブ）
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {activeAsk ? (
          <span className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-0.5 pr-1 pl-2.5 text-xs text-amber-900" data-testid="ask-filter" data-ask={activeAsk.id}>
            {activeAsk.label}（{activeAsk.keys.size}行）
            <Button size="icon-xs" variant="ghost" className="size-5" aria-label="聞き返しの絞り込みを外す" onClick={() => setFilter({ kind: "all" })}>
              <X />
            </Button>
          </span>
        ) : (
          filter.kind === "fix" &&
          counts.rows > 0 && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="直す理由" data-testid="fix-reasons">
              {FIX_KINDS.filter((k) => counts.byKind[k] > 0).map((k) => (
                <Button
                  key={k}
                  size="xs"
                  variant={filter.reason === k ? "default" : "outline"}
                  aria-pressed={filter.reason === k}
                  onClick={() => setFilter(filter.reason === k ? { kind: "fix" } : { kind: "fix", reason: k })}
                  data-testid={`fix-reason-${k}`}
                >
                  {FIX_LABELS[k]} <span className="num">{counts.byKind[k]}</span>
                </Button>
              ))}
            </div>
          )
        )}
        {filter.kind === "all" && !activeAsk && onGoFix && counts.rows > 0 && (
          <Button size="xs" variant="outline" onClick={onGoFix} title="直す行だけを、理由と直し方の列つきで出します" data-testid="table-go-fix">
            直す <span className="num">{counts.rows}</span>行の理由と直し方 <ArrowRight />
          </Button>
        )}
        <div className="relative w-44 sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="表の中を検索"
            placeholder="表の中を検索"
            className="pl-7"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        {sorting.length > 0 && <span className="text-xs text-muted-foreground">並べ替えは表示だけ</span>}
        {columnFilters.length > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 py-0.5 pr-1 pl-2.5 text-xs text-sky-900" data-testid="column-filters">
            <Funnel className="size-3" aria-hidden />
            絞り込み中: {columnFilters.map((f) => columnLabel(spec, f.id)).join("・")}
            {/* 段の並び・直す理由の数は列の絞り込みの前の数なので、見えている行の数と食い違わないように両方を出す（全部は直す理由・検索の後の行） */}
            <span className="num text-sky-800/80" data-testid="column-filters-count">
              （{data.length}行のうち {filtered.length}行を表示）
            </span>
            <Button size="xs" variant="ghost" className="h-5 px-1.5" onClick={onClearColumnFilters} data-testid="column-filters-clear">
              すべて解除
            </Button>
          </span>
        )}
        {outdated && (
          <span className="flex items-center gap-1.5 text-xs text-amber-700" data-testid="outdated">
            手直しのあと止めています
            <Button size="sm" variant="outline" onClick={unpin}>
              <RefreshCw />
              更新
            </Button>
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="ml-auto" aria-label="表示する列" title="表示する列" data-testid="columns-menu" />}>
            <Columns3 />列
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>表示する列</DropdownMenuLabel>
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(v)}>
                    {columnLabel(spec, c.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {filter.kind === "fix" && !activeAsk && (fixGroups.length > 0 || confirmUndo) && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="まとめて直す" data-testid="fix-actions">
          {fixGroups.map((g) => (
            <Button
              key={`${g.action}:${g.field}`}
              size="xs"
              variant="outline"
              className="bg-background"
              title={FIX_ACTIONS[g.action].title}
              onClick={() => onFixAction(g.action, g.keys)}
              data-testid="fix-action"
              data-action={g.action}
            >
              {ACTION_ICONS[g.action]}
              {fixActionText(g)}
            </Button>
          ))}
          {confirmUndo && (
            <Button size="xs" variant="ghost" onClick={confirmUndo} data-testid="confirm-undo">
              <Undo2 />「{CONFIRM_LABEL}」を取り消す
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <CellNote spec={spec} store={store.current!} byKey={byKey} />
        <ColorLegend rows={rows} fields={visibleColumns.map((c) => c.id)} unmatched={shown.some((r) => !liveKeys.has(r.key))} />
      </div>

      {/* 上に重なる窓（案件の画面のチャット）が隠す分（--chat-cover-table-b・--chat-cover-r）だけ、最後の行の下と右端の列の右にスクロールできる余白を足す */}
      <div ref={scrollRef} className="min-h-0 overflow-auto rounded-xl border bg-card pr-[var(--chat-cover-r,0px)] pb-[var(--chat-cover-table-b,0px)]">
        <table
          data-slot="table"
          data-testid="preview-table"
          // 幅は列の幅の合計に決める（Excel と同じ。欄より狭いときに余りを列に割り振ると、境目で決めた幅と見た目の幅が食い違う。余りは表の右の空白）
          className="table-fixed border-separate border-spacing-0 text-xs"
          style={{ width: tableWidth }}
        >
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.id} style={{ width: c.getSize() }} />
            ))}
          </colgroup>
          <TableHeader className="sticky top-0 z-20 bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  const colFilter = h.column.getFilterValue() as ColumnFilterValue | undefined
                  return (
                    <TableHead
                      key={h.id}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn(
                        "h-auto border-b bg-muted px-2 py-2 align-bottom text-xs whitespace-normal text-muted-foreground",
                        // 境目のつまみ（見出しの右端）の幅だけ右の余白を取り、つまみが ▼ に重ならない（タッチでは つまみが太いので余白も広い）
                        h.column.id === "include" ? "sticky left-0 z-30 px-0" : h.column.getCanResize() ? "relative pr-2.5 pointer-coarse:pr-5" : "relative",
                      )}
                    >
                      {h.column.id === "include" ? (
                        <IncludeHeader selection={selection} onSelection={onSelection} off={offCount} />
                      ) : h.column.getCanFilter() ? (
                        <ColumnMenu
                          column={h.column}
                          label={columnLabel(spec, h.column.id)}
                          tip={columnTip(spec, h.column.id)}
                          sorted={sorted}
                          filter={colFilter}
                          valueLabel={valueLabel}
                          onSort={(desc) => onSorting(desc === null ? [] : [{ id: h.column.id, desc }])}
                          onFilter={(v) => onColumnFilter(h.column.id, v)}
                        />
                      ) : (
                        <table.FlexRender header={h} />
                      )}
                      {h.column.getCanResize() && <ResizeHandle header={h} label={columnLabel(spec, h.column.id)} scrollRef={scrollRef} />}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
            {items.map((vi) => {
              const r = shown[vi.index]!
              const included = inclusion.get(r.key)?.included ?? false
              return (
                <TableRow
                  key={r.key}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  data-row-key={r.key}
                  data-included={included ? "1" : "0"}
                  className={cn("border-0", !included && "opacity-45")}
                >
                  {visibleColumns.map((c) => renderCell(r, c.id))}
                </TableRow>
              )
            })}
            {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className="h-20 text-center text-muted-foreground" data-testid="no-match">
                  {columnFilters.length ? "列の絞り込みに合う" : ""}
                  {needle ? `「${query.trim()}」を含む${ROW_FILTERS[filter.kind].empty}` : ROW_FILTERS[filter.kind].empty}はありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
    </div>
  )
}

/**
 * 見出しの右端の境目（列の幅のつまみ。Excel と同じ）。ドラッグで幅を変え、ダブルクリック・Home で元の幅（WIDTH）に戻す。
 * フォーカスして ←→ でも変えられる（Shift を押しながらは大きく）。タッチでも引ける（指で押しやすいように幅を広げ、引く間は表をスクロールさせない）。
 * ドラッグの間は TanStack Table の columnResizing だけを読み、このつまみだけを描き直して、表の高さの線を動かす（幅は離したときに決める）
 */
function ResizeHandle({ header, label, scrollRef }: { header: Header<typeof features, Row, unknown>; label: string; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const column = header.column
  const size = column.getSize()
  const min = column.columnDef.minSize ?? MIN_WIDTH
  const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(min, w))
  const resize = header.getResizeHandler()
  /** ドラッグの間に線を動かす量（離したときの幅と同じく下限・上限で止める） */
  const shift = (delta: number) => clamp(size + delta) - size
  const setSize = (next: number) => column.table.setColumnSizing((old) => ({ ...old, [column.id]: clamp(next) }))
  return (
    <Subscribe source={column.table.atoms.columnResizing} selector={(r) => (r.isResizingColumn === column.id ? (r.deltaOffset ?? 0) : null)}>
      {(delta) => (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`${label}の列の幅`}
          aria-valuenow={size}
          aria-valuemin={min}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          title="ドラッグで列の幅を変える（ダブルクリックで元の幅）"
          data-testid="column-resizer"
          data-column={column.id}
          data-resizing={delta !== null ? "1" : undefined}
          className="group/resize absolute inset-y-0 right-0 z-10 flex w-2.5 cursor-col-resize touch-none justify-end outline-none select-none pointer-coarse:w-5"
          // 左ボタンだけで引く。押した直後に文字を選び始めない（ドラッグの間にセルの文字が選ばれない）。
          // 選び始めを止めるとフォーカスも移らないので、自分で移す（押したあと ←→ で続けて変えられる）
          onMouseDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.focus({ preventScroll: true })
            resize(e)
          }}
          onTouchStart={resize}
          onDoubleClick={() => column.resetSize()}
          onKeyDown={(e) => {
            // Alt・Cmd・Ctrl と一緒の矢印はブラウザの操作（戻る・行頭など）に渡す
            if (e.altKey || e.metaKey || e.ctrlKey) return
            const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
            if (e.key === "ArrowLeft") setSize(size - step)
            else if (e.key === "ArrowRight") setSize(size + step)
            else if (e.key === "Home") column.resetSize()
            else return
            e.preventDefault()
          }}
          style={delta !== null ? { transform: `translateX(${shift(delta)}px)` } : undefined}
        >
          {/* 見える線: ふだんは細い灰色、マウスを乗せる・フォーカス・ドラッグの間は色を付け、ドラッグの間は表の見えている高さまで伸ばす */}
          <span
            aria-hidden
            className={cn(
              "w-px bg-border group-hover/resize:w-0.5 group-hover/resize:bg-primary group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-primary",
              delta !== null ? "w-0.5 bg-primary" : "h-full",
            )}
            style={delta !== null ? { height: scrollRef.current?.clientHeight } : undefined}
          />
        </div>
      )}
    </Subscribe>
  )
}

/**
 * 「載せる」の見出しのチェック。行がみな付いているかではなく、載せる工事の選び方（ダウンロードの段の7割と金額の「載せる工事」）を出して切り替える。
 * 全件＝チェック、7割ルール＝一部（−）。全件でも手で外した行・除外の行は載せないが、見出しはチェックのまま「外す N」を添える
 * （一部の印を使うと7割ルールと見分けられず、押して何が起きるかが分からなくなる）
 */
function IncludeHeader({ selection, onSelection, off }: { selection: SelectionMode; onSelection: (m: SelectionMode) => void; off: number }) {
  const all = selection === "all"
  const title = all
    ? `今は全件。押すと7割ルールで選び直します（手で入れ外しした行はそのまま）${off ? `。手で外した行・除外の行 ${off} 行は今も載せていません` : ""}`
    : "今は7割ルール。押すと全件を載せます（ダウンロードの段の7割と金額の「全件」と同じ。手で外した行・除外の行は載せません）"
  return (
    <label className="flex flex-col items-center gap-0.5" title={`載せる: ${title}`}>
      <Checkbox
        aria-label={all ? "7割ルールに戻す（今は全件を載せる）" : "全件を載せる（今は7割ルール）"}
        checked={all}
        indeterminate={!all}
        onCheckedChange={() => onSelection(all ? "rule7" : "all")}
        data-testid="include-all"
        data-selection={selection}
      />
      <span className="sr-only">載せる（{SELECTION_LABELS[selection]}）</span>
      {/* 全件で手で外した行・除外の行の数は、目に見える形で小さく出す（列が細いので2行目に） */}
      {all && off > 0 && (
        <span className="text-[10px] leading-none font-normal whitespace-nowrap" data-testid="include-all-off">
          外す{off}
        </span>
      )}
    </label>
  )
}

/**
 * 見出しの ▼（Excel のフィルターと同じ）。見出しを押すと開き、並べ替え（昇順・降順）・色で絞る・値で絞る（一覧の中の検索・全選択／解除・件数）をここでする。
 * 絞っている列は ▼ がじょうごに変わる。選ぶとすぐ表に効く（OK を押さない。閉じるのは Escape か外を押す）。
 * 値の一覧と色は開いている間だけ数える（ColumnFilterPanel は開いたときだけ描く）
 */
function ColumnMenu({
  column,
  label,
  tip,
  sorted,
  filter,
  valueLabel,
  onSort,
  onFilter,
}: {
  column: Column<typeof features, Row, unknown>
  label: string
  tip: string
  sorted: false | "asc" | "desc"
  filter: ColumnFilterValue | undefined
  valueLabel: (columnId: string, value: string) => string
  onSort: (desc: boolean | null) => void
  onFilter: (value: ColumnFilterValue | null) => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex w-full items-end justify-between gap-1 rounded-sm text-left font-medium outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              filter && "text-sky-800",
            )}
            title={`${tip}。押すと並べ替え・絞り込み`}
            data-testid="column-menu"
            data-column={column.id}
            data-filtered={filter ? "1" : undefined}
          />
        }
      >
        <span className="min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {sorted === "asc" ? <ArrowUp className="size-3" aria-label="昇順" /> : sorted === "desc" ? <ArrowDown className="size-3" aria-label="降順" /> : null}
          {filter ? <Funnel className="size-3 fill-current" aria-label="絞り込み中" /> : <ChevronDown className="size-3 opacity-60" aria-hidden />}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-(--available-height) w-72 max-w-[calc(100vw-2rem)] overflow-y-auto" data-testid="column-panel">
        <ColumnFilterPanel column={column} label={label} tip={tip} sorted={sorted} filter={filter} valueLabel={valueLabel} onSort={onSort} onFilter={onFilter} />
      </PopoverContent>
    </Popover>
  )
}

function ColumnFilterPanel({
  column,
  label,
  tip,
  sorted,
  filter,
  valueLabel,
  onSort,
  onFilter,
}: {
  column: Column<typeof features, Row, unknown>
  label: string
  tip: string
  sorted: false | "asc" | "desc"
  filter: ColumnFilterValue | undefined
  valueLabel: (columnId: string, value: string) => string
  onSort: (desc: boolean | null) => void
  onFilter: (value: ColumnFilterValue | null) => void
}) {
  const [search, setSearch] = useState("")
  // ほかの列の絞り込みに合う行の、この列の値と件数・色（TanStack Table が覚える。開いている間だけ数える）
  const counts = column.getFacetedUniqueValues()
  const items = useMemo(() => facetItems(counts, (v) => valueLabel(column.id, v)), [counts, valueLabel, column.id])
  const facetRows = column.getFacetedRowModel().rows
  const tones = useMemo(() => (column.id === "origin" ? [] : toneCounts(facetRows.map((r) => r.original.cells[column.id as KojiFieldId]))), [facetRows, column.id])
  const needle = search.trim().toLowerCase()
  const matched = needle ? items.filter((i) => i.label.toLowerCase().includes(needle) || i.value.toLowerCase().includes(needle)) : items
  /**
   * チェックの付いた値。値で絞っているときは外した値のほか、色で絞っているときはその色のセルの値
   * （色から値に切り替えると、今見えている行から始まる）
   */
  const selected = useMemo(() => {
    if (filter && "tone" in filter) return new Set(facetRows.filter((r) => matchesColumnFilter("", r.original.cells[column.id as KojiFieldId], filter)).map((r) => String(r.getValue(column.id) ?? "")))
    const excluded = new Set(filter?.exclude)
    return new Set(items.filter((i) => !excluded.has(i.value)).map((i) => i.value))
  }, [filter, facetRows, items, column])
  /** 一覧に出ていない（ほかの列・検索・段で今は見えない）のに外したままの値の数 */
  const hiddenExcluded = useMemo(() => {
    if (!filter || !("exclude" in filter)) return 0
    const listed = new Set(items.map((i) => i.value))
    return filter.exclude.filter((v) => !listed.has(v)).length
  }, [filter, items])
  const allOn = matched.every((i) => selected.has(i.value)) && (needle !== "" || hiddenExcluded === 0)
  const someOn = matched.some((i) => selected.has(i.value))
  /**
   * 外す値を決める（チェックの無い値。一覧に無い値〔ほかの列・検索・段で今は見えない値〕で前に外したものは外したまま。外す値が無ければ絞り込みを外す）
   */
  const choose = (next: Set<string>) => {
    const listed = new Set(items.map((i) => i.value))
    const kept = filter && "exclude" in filter ? filter.exclude.filter((v) => !listed.has(v)) : []
    const exclude = [...kept, ...items.filter((i) => !next.has(i.value)).map((i) => i.value)]
    onFilter(exclude.length ? { exclude } : null)
  }
  const toggle = (value: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(value)
    else next.delete(value)
    choose(next)
  }
  const toggleMatched = (on: boolean) => {
    // 検索していない「すべて選択」は、一覧に無い外した値も含めて、この列の絞り込みを外す
    if (on && !needle) return onFilter(null)
    const next = new Set(selected)
    for (const i of matched) if (on) next.add(i.value)
    else next.delete(i.value)
    choose(next)
  }
  const sectionLabel = "text-xs font-medium text-muted-foreground"
  return (
    <div className="flex flex-col gap-2.5 text-xs">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground">{tip}</p>
      </div>
      <div className="flex gap-1.5" role="group" aria-label="並べ替え">
        <Button size="sm" variant={sorted === "asc" ? "default" : "outline"} className="flex-1" aria-pressed={sorted === "asc"} onClick={() => onSort(sorted === "asc" ? null : false)} data-testid="sort-asc">
          <ArrowUpNarrowWide />
          昇順
        </Button>
        <Button size="sm" variant={sorted === "desc" ? "default" : "outline"} className="flex-1" aria-pressed={sorted === "desc"} onClick={() => onSort(sorted === "desc" ? null : true)} data-testid="sort-desc">
          <ArrowDownWideNarrow />
          降順
        </Button>
      </div>
      {tones.length > 0 && (
        <div className="flex flex-col gap-1" role="group" aria-label="色で絞る">
          <p className={sectionLabel}>色で絞る</p>
          <div className="flex flex-wrap gap-1">
            {tones.map(({ tone, count }) => {
              const on = !!filter && "tone" in filter && filter.tone === tone
              return (
                <Button key={tone} size="xs" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => onFilter(on ? null : { tone })} data-testid="filter-tone" data-tone={tone}>
                  <span className={cn("size-2.5 shrink-0 rounded-[3px]", STATUS[tone].dot)} aria-hidden />
                  {STATUS[tone].label}
                  <span className="num opacity-70">{count}</span>
                </Button>
              )
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1" role="group" aria-label="値で絞る">
        <p className={sectionLabel}>値で絞る</p>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={`${label}の値を検索`} placeholder="一覧の中を検索" className="h-7 pl-7 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="flex max-h-60 flex-col overflow-y-auto rounded-md border py-1" data-testid="filter-values">
          {matched.length > 0 && (
            <li>
              <label className="flex items-center gap-2 px-2 py-1 font-medium hover:bg-muted">
                <Checkbox checked={allOn} indeterminate={!allOn && someOn} onCheckedChange={(on) => toggleMatched(on)} data-testid="filter-all" />
                {needle ? "検索結果をすべて選択" : "すべて選択"}
              </label>
            </li>
          )}
          {hiddenExcluded > 0 && (
            <li className="px-2 py-1 text-muted-foreground" data-testid="filter-hidden-excluded">
              一覧に無い値 {hiddenExcluded}件を外しています
            </li>
          )}
          {matched.slice(0, SHOWN_VALUES).map((i) => (
            <li key={i.value}>
              <label className="flex items-center gap-2 px-2 py-1 hover:bg-muted" data-testid="filter-value" data-value={i.value}>
                <Checkbox checked={selected.has(i.value)} onCheckedChange={(on) => toggle(i.value, on)} />
                <span className={cn("min-w-0 flex-1 truncate", !i.value && "text-muted-foreground")} title={i.label}>
                  {i.label}
                </span>
                <span className="num shrink-0 text-muted-foreground">{i.count}</span>
              </label>
            </li>
          ))}
          {matched.length > SHOWN_VALUES && <li className="px-2 py-1 text-muted-foreground">ほか {matched.length - SHOWN_VALUES} 件（一覧の中を検索で探せます）</li>}
          {matched.length === 0 && <li className="px-2 py-1 text-muted-foreground">合う値がありません</li>}
        </ul>
      </div>
      <Button size="sm" variant="ghost" disabled={!filter} onClick={() => onFilter(null)} data-testid="filter-clear">
        <X />
        この列の絞り込みを解除
      </Button>
    </div>
  )
}

/**
 * 載せる行の、片付けることの理由（例:「業種が空」「工事名: AI の推定」）と、その理由の直し方（status.ts の FIX_ACTIONS）。業種は「業種を決める」（業種のタブ）。
 * 要確認・AI の推定の値は「これでよい」でそのまま確かめた値にできる。顧客に聞くセルは直さなくてよいので、どの欄を聞くのかと問い合わせのタブへの道だけ出す
 */
function RowReasons({ fix, onOpenInquiry, onFixAction, onConfirm }: { fix: RowFix<KojiFieldId>; onOpenInquiry: () => void; onFixAction: (a: FixActionId) => void; onConfirm: (field: KojiFieldId) => void }) {
  if (!fix.fixes.length && !fix.ask.length && !fix.gyoshu) return null
  const shown = fix.fixes.slice(0, SHOWN_FIXES)
  const rest = fix.fixes.length - shown.length
  // 同じ直し方は1つだけ出す（例: 都道府県と場所名が空でも「AI で案を出す」は1つ）
  const actions = [...new Set(fix.fixes.flatMap((f) => f.action ?? []))]
  const link = "inline-flex items-center gap-0.5 underline-offset-2 hover:underline [&_svg]:size-3"
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 whitespace-normal" data-testid="row-reasons">
      {/* 業種は直すに数えず、業種のタブでまとめて決める（決めるたびに7割で載せる行が入れ替わる） */}
      {fix.gyoshu && (
        <span className="inline-flex flex-wrap items-center gap-x-1">
          <span className="text-amber-800" data-testid="row-fix" data-field="gyoshu">
            {fixText({ field: "gyoshu", kind: fix.gyoshu })}
          </span>
          <button type="button" className={cn(link, "text-violet-700")} title={FIX_ACTIONS.decideGyoshu.title} onClick={() => onFixAction("decideGyoshu")} data-testid="row-fix-action" data-action="decideGyoshu">
            {ACTION_ICONS.decideGyoshu}
            {FIX_ACTIONS.decideGyoshu.label}
          </button>
        </span>
      )}
      {shown.map((f) => (
        <span key={f.field} className="inline-flex flex-wrap items-center gap-x-1">
          <span className="text-amber-800" title={fix.fixes.map(fixText).join("\n")} data-testid="row-fix" data-field={f.field}>
            {fixText(f)}
          </span>
          {f.confirm && (
            <button type="button" className={cn(link, "text-emerald-700")} title="この値のまま、職員が確かめた値にします" onClick={() => onConfirm(f.field)} data-testid="row-confirm" data-field={f.field}>
              <Check />
              {CONFIRM_LABEL}
            </button>
          )}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-amber-800" title={fix.fixes.map(fixText).join("\n")}>
          他{rest}
        </span>
      )}
      {actions.map((a) => (
        <button key={a} type="button" className={cn(link, "text-violet-700")} title={FIX_ACTIONS[a].title} onClick={() => onFixAction(a)} data-testid="row-fix-action" data-action={a}>
          {ACTION_ICONS[a]}
          {FIX_ACTIONS[a].label}
        </button>
      ))}
      {fix.ask.length > 0 && (
        <button type="button" className={cn(link, "text-muted-foreground")} title="顧客への問い合わせに入っています（直さなくてよい）。問い合わせの段を開きます" onClick={onOpenInquiry} data-testid="row-ask">
          <MessageCircleQuestion />
          {askText(fix.ask)}
        </button>
      )}
    </div>
  )
}

/** セルの値。決まった値の項目は名前で出す（業種・元請下請はコードも小さく添える。CSV にはコードが入る） */
function CellValue({ value, named, code }: { value: string; named: string | undefined; code: boolean }) {
  if (!value) return <span className="text-muted-foreground/50">—</span>
  if (!named) return <span className="whitespace-pre-wrap">{value}</span>
  // 「コード 名前」は折り返さない（列の幅は WIDTH で名前が収まるように決める）。それでも収まらなければ名前の側を「…」で切る
  return (
    <span data-code={value} className="flex min-w-0 items-baseline whitespace-nowrap">
      {code && <span className="num mr-1 shrink-0 text-[10px] text-muted-foreground">{value}</span>}
      <span className="truncate">{named}</span>
    </span>
  )
}

function columnLabel(spec: CsvSpec<KojiFieldId>, id: string) {
  const f = spec.fields.find((f) => f.id === id)
  return f ? f.label : id === "reasons" ? "直す理由と直し方" : "元の行"
}

function columnTip(spec: CsvSpec<KojiFieldId>, id: string) {
  const f = spec.fields.find((f) => f.id === id)
  return f ? `CSV の ${f.letter} 列` : "元の Excel のシートと行"
}

/**
 * セルのボタン。選んだ（フォーカスした）ときだけ注意書きの1行を説明につなぐ（読み上げはフォーカスのときだけ。マウスを乗せただけでは読み上げない）。
 * store を読むのはこのボタンだけなので、選んだセルが変わっても表全体は描き直さない
 */
function CellButton({ store, row, field, title, onClick, hasPopup, children }: { store: ActiveStore; row: string; field: KojiFieldId; title?: string; onClick: () => void; hasPopup?: boolean; children: React.ReactNode }) {
  const focused = useSyncExternalStore(store.subscribe, () => {
    const a = store.get()
    return a?.row === row && a.field === field && a.via === "focus"
  }, () => false)
  return (
    <button
      type="button"
      className="block min-h-8 w-full px-2 py-1.5 text-left break-words hover:ring-1 hover:ring-ring/40 hover:ring-inset"
      title={title}
      aria-describedby={focused ? NOTE_ID : undefined}
      aria-haspopup={hasPopup ? "dialog" : undefined}
      onFocus={() => store.set({ row, field, via: "focus" })}
      onMouseEnter={() => store.set({ row, field, via: "hover" })}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 選んだ・マウスを乗せたセルの状態と注意書き（高さは1行に決めて、出し入れで表が動かないようにする。読み上げは選んだセルの説明として） */
function CellNote({ spec, store, byKey }: { spec: CsvSpec<KojiFieldId>; store: ActiveStore; byKey: ReadonlyMap<string, Row> }) {
  const active = useSyncExternalStore(store.subscribe, store.get, () => null)
  const row = active ? byKey.get(active.row) : undefined
  const field = active?.field
  const cell = row && field ? row.cells[field] : undefined
  const label = field ? spec.fields.find((f) => f.id === field)?.label : undefined
  return (
    <p id={NOTE_ID} className="flex h-5 min-w-0 flex-1 basis-64 items-center gap-1.5 text-xs text-muted-foreground" data-testid="cell-note" data-status={cell?.status}>
      {cell ? (
        <>
          <span className={cn("size-2 shrink-0 rounded-full", STATUS[cell.status].dot)} />
          <span className="shrink-0 font-medium text-foreground">
            {label}（{originText(row!)}）
          </span>
          <span className="truncate" title={[cell.message, `元: ${cell.source}`].filter(Boolean).join("\n")}>
            {STATUS[cell.status].label}
            {cell.message ? `: ${cell.message}` : `（元: ${cell.source || "空"}）`}
          </span>
        </>
      ) : (
        "色のセルを選ぶと、理由をここに出します"
      )}
    </p>
  )
}

/**
 * セルの色の凡例（色は STATUS・cellTone から）。案件の表にある色だけを出す。数えるのは全行（絞り込み・検索・載せない行も）の、見えている列:
 * 凡例はこの案件の表の色の見方なので、絞り込みや検索のたびに出入りして並びが動かないようにする
 */
function ColorLegend({ rows, fields, unmatched }: { rows: readonly Row[]; fields: readonly string[]; unmatched: boolean }) {
  // 数えるのは見えている列だけ（「表示する列」で隠した列の色は表に出ない）
  const shownKey = fields.join(",")
  const tones = useMemo(() => {
    const found = new Set<string>()
    const shownFields = shownKey.split(",") as KojiFieldId[]
    for (const r of rows) for (const f of shownFields) if (r.cells[f]) found.add(cellTone(r.cells[f]))
    return LEGEND_TONES.filter((t) => found.has(t))
  }, [rows, shownKey])
  if (!tones.length && !unmatched) return null
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="セルの色と印" data-testid="color-legend">
      {tones.map((t) => (
        <li key={t} className="flex items-center gap-1" title={LEGEND_TIPS[t]} data-tone={t}>
          {/* 見本はセルの淡い色では白い背景で見分けにくいので、同じ色の濃い方（注意書きの点と同じ） */}
          <span className={cn("size-2.5 shrink-0 rounded-[3px]", STATUS[t].dot)} aria-hidden />
          {STATUS[t].label}
          {LEGEND_TIPS[t] && <span className="sr-only">（{LEGEND_TIPS[t]}）</span>}
        </li>
      ))}
      {/* 「載せる」の列の「!」（列が細いので行には印だけ。タッチでも読めるように意味は凡例に書く） */}
      {unmatched && (
        <li className="flex items-center gap-1 text-amber-700" data-testid="legend-unmatched">
          <span className="font-semibold" aria-hidden>
            !
          </span>
          手直しで今の絞り込み・検索に合わなくなった行（「更新」で外れる）
        </li>
      )}
    </ul>
  )
}

/** 下書き（value）は PreviewTable が持つ。onDone(true) で確定、onDone(false) で取り消し */
function CellEditor({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: (commit: boolean) => void }) {
  const finished = useRef(false)
  const finish = (commit: boolean) => {
    if (finished.current) return
    finished.current = true
    onDone(commit)
  }
  return (
    <input
      autoFocus
      aria-label="セルの値"
      className="h-8 w-full min-w-24 bg-background px-2 outline-none ring-2 ring-ring ring-inset"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true)
        // Escape はこの欄の手直しをやめるだけ。済んだ印（preventDefault）を付け、重ねて開いた作業の画面は閉じない（作業の画面は印のある Escape を見送る）
        if (e.key === "Escape") {
          e.preventDefault()
          finish(false)
        }
      }}
    />
  )
}
