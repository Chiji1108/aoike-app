import { useEffect, useMemo, useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Plus, Search, Sun } from "lucide-react"
import { z } from "zod"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { AlertText } from "@/components/fit/alert-text"
import { StatusBadge } from "@/components/fit/status-badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FIT_NAME } from "@/lib/constants"
import { alertsOf, sortAlerts, type Alert } from "@/lib/fit/alerts"
import { PROCEDURE_STATUSES, PROCEDURE_STATUS_LABELS, acceptedOnOf, bookNumber, formatDate, statusOf, type ProcedureStatus } from "@/lib/fit/procedure"
import { PROCEDURE_KINDS, PROCEDURE_KIND_LABELS, type ProcedureKind } from "@/lib/fit/types"
import { todayIso } from "@/lib/period"
import { cn } from "@/lib/utils"
import { listProceduresFn } from "@/server/fit-fns"

/** 絞り込みは URL に持つ（トップの件数から開ける・開き直しても同じ）。open は終了以外、all はすべて */
const searchSchema = z.object({
  status: z.enum([...PROCEDURE_STATUSES, "open", "all"]).optional(),
  kind: z.enum(PROCEDURE_KINDS).optional(),
  alert: z.literal(true).optional(),
})

export const Route = createFileRoute("/_authed/fit/procedures")({
  validateSearch: searchSchema,
  loader: () => listProceduresFn(),
  head: () => ({ meta: [{ title: `手続 | ${FIT_NAME}` }] }),
  component: ProceduresPage,
})

type Source = Awaited<ReturnType<typeof listProceduresFn>>["rows"][number]
type Row = Source & { number: string; status: ProcedureStatus; acceptedOn: string | null; defects: string; alerts: Alert[] }

const features = tableFeatures({ columnVisibilityFeature, rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const col = createColumnHelper<typeof features, Row>()

/** 日付の列（空はどちら向きに並べ替えても後ろ） */
const dateColumn = (id: keyof Row & string, header: string) =>
  col.accessor((r) => (r[id] as string | null) || undefined, { id, header, sortFn: "alphanumeric", sortUndefined: "last", cell: (c) => <span className="num">{formatDate(c.getValue())}</span> })

const LEVEL_RANK = { danger: 0, warn: 1, info: 2 } as const

const columns = col.columns([
  col.accessor((r) => r.bookYear * 100_000 + r.seq, {
    id: "number",
    header: "事件簿番号",
    enableHiding: false,
    cell: (c) => (
      <Link to="/fit/cases/$caseId" params={{ caseId: c.row.original.caseId }} className="font-medium text-brand num hover:underline" data-testid="fit-number">
        {c.row.original.number}
      </Link>
    ),
  }),
  col.accessor((r) => PROCEDURE_KIND_LABELS[r.kind], { id: "kind", header: "申請区分", sortFn: "alphanumeric" }),
  col.accessor((r) => PROCEDURE_STATUSES.indexOf(r.status), { id: "status", header: "状況", cell: (c) => <StatusBadge status={c.row.original.status} /> }),
  // 急ぐものほど前（注意の無いものは後ろ）
  col.accessor((r) => (r.alerts[0] ? LEVEL_RANK[r.alerts[0].level] : undefined), {
    id: "alerts",
    header: "注意",
    sortUndefined: "last",
    cell: (c) => (
      <span className="grid gap-0.5">
        {c.row.original.alerts.map((a, i) => (
          <AlertText key={i} alert={a} />
        ))}
      </span>
    ),
  }),
  col.accessor((r) => r.case.commonId ?? "", { id: "commonId", header: "共通ID", sortFn: "alphanumeric", cell: (c) => <span className="num">{c.getValue()}</span> }),
  col.accessor((r) => r.case.kana || r.case.name, {
    id: "name",
    header: "顧客名",
    sortFn: "alphanumeric",
    cell: (c) => (
      <span className="block">
        <span className="block font-medium">{c.row.original.case.name}</span>
        {c.row.original.case.kana && <span className="block text-[11px] text-muted-foreground">{c.row.original.case.kana}</span>}
      </span>
    ),
  }),
  col.accessor((r) => r.case.builder, { id: "builder", header: "ビルダー", sortFn: "alphanumeric" }),
  dateColumn("receivedOn", "受付日"),
  dateColumn("acceptedOn", "受任日"),
  col.accessor((r) => r.defects, { id: "defects", header: "不備内容", sortFn: "alphanumeric", cell: (c) => <span className="text-red-700 dark:text-red-400">{c.getValue()}</span> }),
  dateColumn("appliedOn", "申請日"),
  col.accessor((r) => r.applicationId, { id: "applicationId", header: "申請ID", sortFn: "alphanumeric", cell: (c) => <span className="num">{c.getValue()}</span> }),
  dateColumn("approvedOn", "認定日"),
  col.accessor((r) => r.facilityId, { id: "facilityId", header: "設備ID", sortFn: "alphanumeric", cell: (c) => <span className="num">{c.getValue()}</span> }),
  dateColumn("completedOn", "完了通知日"),
  dateColumn("invoicedOn", "請求書発行日"),
])

/** 列の幅（px） */
const WIDTH: Record<string, number> = {
  number: 96,
  kind: 104,
  status: 104,
  alerts: 220,
  commonId: 112,
  name: 150,
  builder: 130,
  receivedOn: 92,
  acceptedOn: 92,
  defects: 180,
  appliedOn: 92,
  applicationId: 120,
  approvedOn: 92,
  facilityId: 120,
  completedOn: 96,
  invoicedOn: 104,
}

const COLUMNS_KEY = "fit-procedure-columns"

/** 表示する列は端末ごとに覚える（localStorage が使えなければ毎回すべて） */
function useColumnVisibility() {
  const [state, setState] = useState<ColumnVisibilityState>({})
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_KEY)
      if (saved) setState(JSON.parse(saved) as ColumnVisibilityState)
    } catch {
      /* 使えない環境では覚えない */
    }
  }, [])
  const update = (updater: ColumnVisibilityState | ((old: ColumnVisibilityState) => ColumnVisibilityState)) =>
    setState((old) => {
      const next = typeof updater === "function" ? updater(old) : updater
      try {
        localStorage.setItem(COLUMNS_KEY, JSON.stringify(next))
      } catch {
        /* 使えない環境では覚えない */
      }
      return next
    })
  return [state, update] as const
}

function ProceduresPage() {
  const { rows: sources, settings } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const status = search.status ?? "open"
  const kind = search.kind ?? ""
  const today = todayIso()
  const rows = useMemo<Row[]>(
    () =>
      sources.map((s) => ({
        ...s,
        number: bookNumber(s.bookYear, s.seq),
        status: statusOf(s, s.openDefects),
        acceptedOn: acceptedOnOf(s),
        defects: s.openDefects.map((d) => d.content).join("、"),
        alerts: sortAlerts(alertsOf(s, settings, today)),
      })),
    [sources, settings, today],
  )
  const [query, setQuery] = useState("")
  const [builder, setBuilder] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "number", desc: true }])
  const [columnVisibility, setColumnVisibility] = useColumnVisibility()

  const builders = useMemo(() => [...new Set(rows.map((r) => r.case.builder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")), [rows])
  const counts = useMemo(() => {
    const m = new Map<ProcedureStatus, number>()
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return m
  }, [rows])

  const needle = query.trim().toLowerCase()
  const data = useMemo(
    () =>
      rows.filter((r) => {
        if (status === "open" ? r.status === "closed" : status !== "all" && r.status !== status) return false
        if (kind && r.kind !== kind) return false
        if (builder && r.case.builder !== builder) return false
        if (search.alert && r.alerts.length === 0) return false
        if (!needle) return true
        // 共通ID・氏名・フリガナ・申請ID・設備ID・事件簿番号で探す
        return [r.case.commonId ?? "", r.case.name, r.case.kana, r.applicationId, r.facilityId, r.number].some((v) => v.toLowerCase().includes(needle))
      }),
    [rows, status, kind, builder, needle, search.alert],
  )

  const table = useTable({ features, data, columns, getRowId: (r) => r.id, onSortingChange: setSorting, onColumnVisibilityChange: setColumnVisibility, state: { sorting, columnVisibility } })
  const visible = table.getVisibleLeafColumns()
  const tableWidth = visible.reduce((a, c) => a + (WIDTH[c.id] ?? 100), 0)
  const shown = table.getRowModel().rows

  return (
    <AppShell tool={FIT}>
      <PageHeader
        title="手続"
        description="1行が1つの手続（SHARP の案件表の1行）。状況は日付と印から決まります。"
        actions={
          <Button render={<Link to="/fit/new" />} nativeButton={false} size="lg" className="h-10 px-4" data-testid="fit-new">
            <Plus />
            申込を受け付ける
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="共通ID・氏名・フリガナ・申請ID・設備ID" aria-label="探す" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="fit-search" />
        </div>
        <NativeSelect
          aria-label="状況"
          value={status}
          onChange={(e) => void navigate({ search: (s) => ({ ...s, status: e.target.value === "open" ? undefined : (e.target.value as ProcedureStatus | "all") }), replace: true })}
          className="w-40 [&_select]:h-9"
          data-testid="fit-status-filter"
        >
          <option value="open">終了以外（{rows.length - (counts.get("closed") ?? 0)}）</option>
          <option value="all">すべて（{rows.length}）</option>
          {PROCEDURE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROCEDURE_STATUS_LABELS[s]}（{counts.get(s) ?? 0}）
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="申請区分"
          value={kind}
          onChange={(e) => void navigate({ search: (s) => ({ ...s, kind: (e.target.value || undefined) as ProcedureKind | undefined }), replace: true })}
          className="w-36 [&_select]:h-9"
        >
          <option value="">申請区分すべて</option>
          {PROCEDURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {PROCEDURE_KIND_LABELS[k]}
            </option>
          ))}
        </NativeSelect>
        {builders.length > 0 && (
          <NativeSelect aria-label="ビルダー" value={builder} onChange={(e) => setBuilder(e.target.value)} className="w-40 [&_select]:h-9">
            <option value="">ビルダーすべて</option>
            {builders.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </NativeSelect>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={!!search.alert} onChange={(e) => void navigate({ search: (s) => ({ ...s, alert: e.target.checked || undefined }), replace: true })} data-testid="fit-alert-filter" />
          注意があるものだけ
        </label>
        <span className="ml-auto text-sm text-muted-foreground num" data-testid="fit-count">
          {data.length}件
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" aria-label="表示する列" title="表示する列" />}>
            <Columns3 />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>表示する列</DropdownMenuLabel>
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(v)}>
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Sun className="size-6" />
          </span>
          <p className="mt-4 font-medium">まだ手続がありません</p>
          <p className="mt-1 text-sm text-muted-foreground">申込書が届いたら「申込を受け付ける」から登録します。事件簿の番号はそのときに付きます。</p>
        </div>
      ) : (
        <>
          {/* スマホではカード（表は横に長いので） */}
          <ul className="grid gap-2 sm:hidden" data-testid="fit-cards">
            {shown.map(({ original: r }) => (
              <li key={r.id}>
                <Link to="/fit/cases/$caseId" params={{ caseId: r.caseId }} className="grid gap-1.5 rounded-xl border bg-card p-3">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-brand num">{r.number}</span>
                    <span className="text-xs text-muted-foreground">{PROCEDURE_KIND_LABELS[r.kind]}</span>
                    <StatusBadge status={r.status} className="ml-auto" />
                  </span>
                  <span className="font-medium">{r.case.name}</span>
                  <span className="text-xs text-muted-foreground num">
                    {r.case.commonId ?? "共通ID まだ無し"}
                    {r.case.builder && `・${r.case.builder}`}
                  </span>
                  {r.alerts.map((a, i) => (
                    <AlertText key={i} alert={a} />
                  ))}
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden max-h-[calc(100dvh-14rem)] overflow-auto rounded-xl border bg-card sm:block">
            <table className="w-full table-fixed border-separate border-spacing-0 text-xs" style={{ minWidth: tableWidth }} data-testid="fit-table">
              <colgroup>
                {visible.map((c) => (
                  <col key={c.id} style={{ width: WIDTH[c.id] }} />
                ))}
              </colgroup>
              <TableHeader className="sticky top-0 z-20 bg-muted">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="hover:bg-transparent">
                    {hg.headers.map((h) => {
                      const sorted = h.column.getIsSorted()
                      return (
                        <TableHead
                          key={h.id}
                          aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                          className={cn("h-auto border-b bg-muted px-2 py-2 align-bottom text-xs whitespace-normal text-muted-foreground", h.column.id === "number" && "sticky left-0 z-30")}
                        >
                          <button type="button" className="inline-flex items-end gap-1 text-left font-medium hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                            <span>
                              <table.FlexRender header={h} />
                            </span>
                            {sorted === "asc" ? <ArrowUp className="size-3 shrink-0" /> : sorted === "desc" ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUpDown className="size-3 shrink-0 opacity-40" />}
                          </button>
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.id} className="border-0" data-testid="fit-row">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "border-b px-2 py-1.5 align-top text-xs whitespace-normal break-words",
                          cell.column.id === "number" && "sticky left-0 z-10 bg-card",
                          cell.column.id === "alerts" && row.original.alerts[0]?.level === "danger" && "bg-red-50 dark:bg-red-950/40",
                          cell.column.id === "alerts" && row.original.alerts[0]?.level === "warn" && "bg-amber-50 dark:bg-amber-950/40",
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  )
}
