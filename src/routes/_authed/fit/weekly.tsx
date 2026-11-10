import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { FIT_NAME } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { formatDate, todayIso } from "@/lib/fit/procedure"
import { WEEKLY_COLUMNS, WEEKLY_DATE_COLUMNS, isUpdated, type WeeklyRow } from "@/lib/fit/weekly"
import { cn } from "@/lib/utils"
import { saveFile } from "@/lib/save-file"
import { exportWeeklyFn, getWeeklyReportFn, weeklyPreviewFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/weekly")({
  loader: () => weeklyPreviewFn(),
  head: () => ({ meta: [{ title: `週次の案件表 | ${FIT_NAME}` }] }),
  component: WeeklyPage,
})

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Excel を作ってダウンロードさせる（ExcelJS は大きいので、出すときだけ読み込む） */
async function download(rows: WeeklyRow[], createdAt: number) {
  const { weeklyXlsx, weeklyFileName } = await import("@/lib/fit/weekly-xlsx")
  saveFile(await weeklyXlsx(rows), weeklyFileName(todayIso(new Date(createdAt))), XLSX_TYPE)
}

const timeText = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })

function WeeklyPage() {
  const { rows, hasPrevious, reports } = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const updated = rows.filter(isUpdated)

  async function exportNow() {
    setBusy("export")
    try {
      const { meta, rows } = await exportWeeklyFn()
      await download(rows, meta.createdAt)
      toast.success("案件表を出して記録しました")
      await router.invalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function again(id: string) {
    setBusy(id)
    try {
      const report = await getWeeklyReportFn({ data: { id } })
      if (!report) throw new Error("記録が見つかりません")
      await download(report.rows, report.meta.createdAt)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppShell tool={FIT}>
      <PageHeader
        title="週次の案件表"
        description="SHARP に渡す案件表（1行＝1手続）。「全件」と「今週の変更」の2シートで、足した行は青、前回から変わったセルは黄色になります。"
        actions={
          <Button size="lg" className="h-10 px-4" onClick={exportNow} disabled={busy !== null || rows.length === 0} data-testid="weekly-export">
            {busy === "export" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            案件表を出す
          </Button>
        }
      />

      <section className="mb-8 grid gap-3">
        <h2 className="text-lg font-semibold">
          {hasPrevious ? "前回から変わった行" : "初めて出す案件表（すべての行が新しい行）"}
          <span className="ml-2 text-sm font-normal text-muted-foreground num" data-testid="weekly-updated-count">
            {updated.length}件 / 全{rows.length}件
          </span>
        </h2>
        {updated.length === 0 ? (
          <p className="text-sm text-muted-foreground">前回から変わった行はありません。</p>
        ) : (
          <div className="overflow-auto rounded-xl border bg-card">
            <table className="w-full border-separate border-spacing-0 text-xs" data-testid="weekly-preview">
              <thead className="bg-muted">
                <tr>
                  {WEEKLY_COLUMNS.map((c) => (
                    <th key={c} className="border-b px-2 py-2 text-left align-bottom font-medium whitespace-pre-line text-muted-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {updated.map((r) => (
                  <tr key={r.id} data-testid="weekly-row">
                    {r.values.map((v, i) => (
                      <td
                        key={i}
                        className={cn("border-b px-2 py-1.5 align-top whitespace-nowrap", WEEKLY_DATE_COLUMNS.has(i) && "num", r.added ? "bg-sky-50 dark:bg-sky-950/40" : r.changed[i] && "bg-amber-100 dark:bg-amber-900/40")}
                        data-changed={r.changed[i] ? "1" : undefined}
                      >
                        {WEEKLY_DATE_COLUMNS.has(i) ? formatDate(v) : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">出した記録</h2>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ出していません。</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card" data-testid="weekly-reports">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="flex-1 num">{timeText(r.createdAt)}</span>
                <span className="text-muted-foreground num">{r.count}件</span>
                <Button variant="outline" size="sm" onClick={() => again(r.id)} disabled={busy !== null}>
                  {busy === r.id ? <Loader2 className="animate-spin" /> : <Download />}
                  もう一度出す
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}
