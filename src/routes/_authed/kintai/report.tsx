import { useEffect, useRef, useState } from "react"
import { Link, createFileRoute, notFound } from "@tanstack/react-router"
import { ArrowLeft, Printer } from "lucide-react"
import { z } from "zod"
import { ReportSheet } from "@/components/report/report-sheet"
import { Button } from "@/components/ui/button"
import { PERIOD_KEY_RE, currentPeriodKey, formatPeriodRangeShort, formatPeriodTitle } from "@/lib/period"
import { getPeriodAttendance } from "@/server/attendance"

export const Route = createFileRoute("/_authed/kintai/report")({
  validateSearch: z.object({
    employee: z.string().catch(""),
    period: z.string().regex(PERIOD_KEY_RE).catch(() => currentPeriodKey()),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!deps.employee) throw notFound()
    const data = await getPeriodAttendance({
      data: { employeeId: deps.employee, period: deps.period },
    }).catch(() => {
      throw notFound()
    })
    return { ...data, period: deps.period }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        // 「PDFに保存」時のファイル名になる
        title: loaderData
          ? `勤務報告書_${loaderData.employee.name}_${formatPeriodTitle(loaderData.period)}`
          : "勤務報告書",
      },
    ],
  }),
  component: ReportPage,
})

function ReportPage() {
  const { employee, records, period } = Route.useLoaderData()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)

  // スマートフォンでも A4 全体が見えるように縮小表示（印刷時は等倍）
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const mmToPx = 96 / 25.4
    const update = () => setScale(Math.min(1, el.clientWidth / (210 * mmToPx)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="min-h-dvh bg-[#eef0f3] print:bg-white">
      <header className="no-print z-20 border-b bg-background/90 backdrop-blur sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Button
            render={
              <Link to="/kintai" search={{ employee: employee.id, period: period === currentPeriodKey() ? undefined : period }} />
            }
            nativeButton={false}
            variant="ghost"
            className="h-10 px-2.5"
          >
            <ArrowLeft />
            勤怠に戻る
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              勤務報告書・{employee.name}さん
            </div>
            <div className="text-xs text-muted-foreground num">
              {formatPeriodTitle(period)}（{formatPeriodRangeShort(period)}）
            </div>
          </div>
          <Button size="lg" className="h-11 w-full px-5 sm:w-auto" onClick={() => window.print()}>
            <Printer />
            印刷 / PDFで保存
          </Button>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3 text-xs leading-relaxed text-muted-foreground sm:px-6">
          印刷画面の「送信先（プリンター）」で<strong className="font-medium text-foreground">「PDFに保存」</strong>
          を選ぶとPDFファイルになります。用紙は<strong className="font-medium text-foreground">A4・縦</strong>
          、余白は「なし」または「デフォルト」、倍率は100%でご利用ください。
        </div>
      </header>

      <div className="mx-auto max-w-[calc(210mm+3rem)] px-3 py-6 sm:px-6 sm:py-10 print:max-w-none print:p-0">
        <div ref={wrapRef} className="w-full">
          <div className="report-zoom" style={{ zoom: scale ?? 1, visibility: scale === null ? "hidden" : undefined } as React.CSSProperties}>
            <ReportSheet period={period} employeeName={employee.name} commute={employee} records={records} />
          </div>
        </div>
      </div>
    </div>
  )
}
