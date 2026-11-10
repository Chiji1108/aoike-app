import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable, type SortingState } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search, Sun } from "lucide-react"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { StatusBadge } from "@/components/fit/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FIT_NAME } from "@/lib/constants"
import { PROCEDURE_STATUSES, PROCEDURE_STATUS_LABELS, acceptedOnOf, bookNumber, formatDate, statusOf, type ProcedureStatus } from "@/lib/fit/procedure"
import { PROCEDURE_KINDS, PROCEDURE_KIND_LABELS, type ProcedureKind } from "@/lib/fit/types"
import { cn } from "@/lib/utils"
import { listProceduresFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/")({
  loader: () => listProceduresFn(),
  head: () => ({ meta: [{ title: `手続 | ${FIT_NAME}` }] }),
  component: ProceduresPage,
})

type Source = Awaited<ReturnType<typeof listProceduresFn>>[number]
type Row = Source & { number: string; status: ProcedureStatus; acceptedOn: string | null; defects: string }

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const col = createColumnHelper<typeof features, Row>()

/** 日付の列（空はどちら向きに並べ替えても後ろ） */
const dateColumn = (id: keyof Row & string, header: string) =>
  col.accessor((r) => (r[id] as string | null) || undefined, { id, header, sortFn: "alphanumeric", sortUndefined: "last", cell: (c) => <span className="num">{formatDate(c.getValue())}</span> })

const columns = col.columns([
  col.accessor((r) => r.bookYear * 100_000 + r.seq, {
    id: "number",
    header: "事件簿番号",
    cell: (c) => (
      <Link to="/fit/cases/$caseId" params={{ caseId: c.row.original.caseId }} className="font-medium text-brand num hover:underline" data-testid="fit-number">
        {c.row.original.number}
      </Link>
    ),
  }),
  col.accessor((r) => PROCEDURE_KIND_LABELS[r.kind], { id: "kind", header: "申請区分", sortFn: "alphanumeric" }),
  col.accessor((r) => PROCEDURE_STATUSES.indexOf(r.status), { id: "status", header: "状況", cell: (c) => <StatusBadge status={c.row.original.status} /> }),
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

function ProceduresPage() {
  const sources = Route.useLoaderData()
  const rows = useMemo<Row[]>(
    () =>
      sources.map((s) => ({
        ...s,
        number: bookNumber(s.bookYear, s.seq),
        status: statusOf(s, s.openDefects),
        acceptedOn: acceptedOnOf(s),
        defects: s.openDefects.map((d) => d.content).join("、"),
      })),
    [sources],
  )
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<ProcedureStatus | "open" | "">("open")
  const [kind, setKind] = useState<ProcedureKind | "">("")
  const [builder, setBuilder] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "number", desc: true }])

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
        if (status === "open" ? r.status === "closed" : status && r.status !== status) return false
        if (kind && r.kind !== kind) return false
        if (builder && r.case.builder !== builder) return false
        if (!needle) return true
        // 共通ID・氏名・フリガナ・申請ID・設備ID・事件簿番号で探す
        return [r.case.commonId ?? "", r.case.name, r.case.kana, r.applicationId, r.facilityId, r.number].some((v) => v.toLowerCase().includes(needle))
      }),
    [rows, status, kind, builder, needle],
  )

  const table = useTable({ features, data, columns, getRowId: (r) => r.id, onSortingChange: setSorting, state: { sorting } })
  const tableWidth = Object.values(WIDTH).reduce((a, b) => a + b, 0)

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
        <NativeSelect aria-label="状況" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-40 [&_select]:h-9" data-testid="fit-status-filter">
          <option value="open">終了以外（{rows.length - (counts.get("closed") ?? 0)}）</option>
          <option value="">すべて（{rows.length}）</option>
          {PROCEDURE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROCEDURE_STATUS_LABELS[s]}（{counts.get(s) ?? 0}）
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="申請区分" value={kind} onChange={(e) => setKind(e.target.value as ProcedureKind | "")} className="w-36 [&_select]:h-9">
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
        <span className="ml-auto text-sm text-muted-foreground num">{data.length}件</span>
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
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto rounded-xl border bg-card">
          <table className="w-full table-fixed border-separate border-spacing-0 text-xs" style={{ minWidth: tableWidth }} data-testid="fit-table">
            <colgroup>
              {table.getAllLeafColumns().map((c) => (
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
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-0" data-testid="fit-row">
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className={cn("border-b px-2 py-1.5 align-top text-xs whitespace-normal break-words", cell.column.id === "number" && "sticky left-0 z-10 bg-card")}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </AppShell>
  )
}
