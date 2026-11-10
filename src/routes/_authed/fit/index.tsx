import { useMemo } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { CheckCircle2, MapPin, Plus } from "lucide-react"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { AlertText } from "@/components/fit/alert-text"
import { StatusBadge } from "@/components/fit/status-badge"
import { Button } from "@/components/ui/button"
import { FIT_NAME } from "@/lib/constants"
import { ALERT_KIND_LABELS, addressPending, alertsOf, sortAlerts } from "@/lib/fit/alerts"
import { PROCEDURE_STATUSES, bookNumber, statusOf, type ProcedureStatus } from "@/lib/fit/procedure"
import { todayIso } from "@/lib/period"
import { listProceduresFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/")({
  loader: () => listProceduresFn(),
  head: () => ({ meta: [{ title: FIT_NAME }] }),
  component: FitTopPage,
})

/** トップ：期限が近いもの・注意（急ぐ順）と、状況ごとの件数 */
function FitTopPage() {
  const { rows, settings } = Route.useLoaderData()
  const today = todayIso()
  const alerts = useMemo(() => sortAlerts(rows.flatMap((r) => alertsOf(r, settings, today))), [rows, settings, today])
  const pending = useMemo(() => addressPending(rows), [rows])
  const counts = useMemo(() => {
    const m = new Map<ProcedureStatus, number>()
    for (const r of rows) {
      const s = statusOf(r, r.openDefects)
      m.set(s, (m.get(s) ?? 0) + 1)
    }
    return m
  }, [rows])

  return (
    <AppShell tool={FIT}>
      <PageHeader
        title="FIT 申請"
        description="期限が近いもの・注意と、状況ごとの件数です。"
        actions={
          <Button render={<Link to="/fit/new" />} nativeButton={false} size="lg" className="h-10 px-4" data-testid="fit-new">
            <Plus />
            申込を受け付ける
          </Button>
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">状況ごとの件数</h2>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9" data-testid="fit-counts">
          {PROCEDURE_STATUSES.map((s) => (
            <li key={s}>
              <Link to="/fit/procedures" search={{ status: s }} className="grid gap-1 rounded-xl border bg-card p-3 hover:bg-muted/40" data-testid={`fit-count-${s}`}>
                <StatusBadge status={s} className="justify-self-start" />
                <span className="text-2xl font-semibold num">{counts.get(s) ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold">
          期限と注意
          <span className="text-sm font-normal text-muted-foreground num">{alerts.length}件</span>
        </h2>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" />
            いま見ておくものはありません
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card" data-testid="fit-alerts">
            {alerts.map((a, i) => (
              <li key={i}>
                <Link to="/fit/cases/$caseId" params={{ caseId: a.caseId }} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/40">
                  <span className="w-20 font-medium text-brand num">{a.number}</span>
                  <span className="w-32 truncate text-sm">{a.name}</span>
                  <span className="w-24 text-xs text-muted-foreground">{ALERT_KIND_LABELS[a.kind]}</span>
                  <AlertText alert={a} className="min-w-0 flex-1" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <MapPin className="size-4" />
          住所確定待ち
          <span className="text-sm font-normal text-muted-foreground num">{pending.length}件</span>
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">地番で申請して認定された新規認定。住居表示が決まったら事前変更届を足します。</p>
        {pending.length > 0 && (
          <ul className="divide-y rounded-2xl border bg-card" data-testid="fit-address-pending">
            {pending.map((r) => (
              <li key={r.id}>
                <Link to="/fit/cases/$caseId" params={{ caseId: r.caseId }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                  <span className="w-20 font-medium text-brand num">{bookNumber(r.bookYear, r.seq)}</span>
                  <span className="text-sm">{r.case.name}</span>
                  <span className="text-xs text-muted-foreground">{r.case.builder}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}
