import { useEffect, useMemo, useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { FileText, Plus, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"
import { AppShell, KINTAI } from "@/components/app-shell"
import { KINTAI_NAME } from "@/lib/constants"
import { DayList } from "@/components/attendance/day-list"
import { EmployeePicker } from "@/components/attendance/employee-picker"
import { EntryDialog, type EntryTarget } from "@/components/attendance/entry-dialog"
import { PeriodNav } from "@/components/attendance/period-nav"
import { SummaryCards } from "@/components/attendance/summary-cards"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { COMMUTE_TYPE_LABELS, defaultDailyFare, periodCommuteTotal } from "@/lib/commute"
import {
  PERIOD_KEY_RE,
  currentPeriodKey,
  formatPeriodTitle,
  getPeriodDates,
  isDateInPeriod,
  todayIso,
} from "@/lib/period"
import { summarize } from "@/lib/time"
import { getPeriodAttendance, type AttendanceRow } from "@/server/attendance"
import { listEmployees } from "@/server/employees"

const LAST_EMPLOYEE_KEY = "aoike:last-employee"

const searchSchema = z.object({
  employee: z.string().optional().catch(undefined),
  period: z.string().regex(PERIOD_KEY_RE).optional().catch(undefined),
})

export const Route = createFileRoute("/_authed/kintai/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: KINTAI_NAME }] }),
  loaderDeps: ({ search }) => ({ employee: search.employee, period: search.period }),
  loader: async ({ deps }) => {
    const employees = await listEmployees()
    const period = deps.period ?? currentPeriodKey()
    const selected =
      employees.find((e) => e.id === deps.employee) ?? employees.find((e) => e.active) ?? undefined
    const attendance = selected
      ? await getPeriodAttendance({ data: { employeeId: selected.id, period } })
      : null
    return { employees, period, selectedId: selected?.id, attendance }
  },
  component: AttendancePage,
})

function AttendancePage() {
  const { employees, period, selectedId, attendance } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const pickerEmployees = useMemo(
    () => employees.filter((e) => e.active || e.id === selectedId),
    [employees, selectedId],
  )

  // 前回選択した従業員を覚えておく
  useEffect(() => {
    if (search.employee) return
    try {
      const last = localStorage.getItem(LAST_EMPLOYEE_KEY)
      if (last && last !== selectedId && employees.some((e) => e.id === last && e.active)) {
        navigate({ search: (s) => ({ ...s, employee: last }), replace: true })
      }
    } catch {
      /* localStorage が使えない環境では何もしない */
    }
  }, [search.employee, selectedId, employees, navigate])

  useEffect(() => {
    if (!selectedId) return
    try {
      localStorage.setItem(LAST_EMPLOYEE_KEY, selectedId)
    } catch {
      /* ignore */
    }
  }, [selectedId])

  const [filter, setFilter] = useState<"all" | "entered">("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [target, setTarget] = useState<EntryTarget>({ date: todayIso() })

  const records = attendance?.records ?? []
  const recordsByDate = useMemo(() => new Map(records.map((r) => [r.workDate, r])), [records])
  const allDates = useMemo(() => getPeriodDates(period), [period])
  const dates = filter === "all" ? allDates : allDates.filter((d) => recordsByDate.has(d))
  const summary = useMemo(() => summarize(records), [records])

  function openEntry(date: string, record?: AttendanceRow) {
    setTarget({ date, record })
    setDialogOpen(true)
  }

  function openNewEntry() {
    const today = todayIso()
    if (isDateInPeriod(today, period)) {
      const r = recordsByDate.get(today)
      return openEntry(today, r)
    }
    // 表示中の期間で最初の未入力日
    const firstEmpty = allDates.find((d) => !recordsByDate.has(d) && d <= today) ?? allDates[0]!
    openEntry(firstEmpty)
  }

  if (employees.filter((e) => e.active).length === 0 && !selectedId) {
    return (
      <AppShell tool={KINTAI}>
        <div className="mx-auto mt-10 flex max-w-md flex-col items-center rounded-2xl border bg-card px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <UserPlus className="size-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">はじめに従業員を登録しましょう</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            勤怠を記録するスタッフの氏名を登録すると、ここで勤怠を入力できるようになります。
          </p>
          <Button render={<Link to="/kintai/employees" />} nativeButton={false} size="lg" className="mt-6 h-11 px-5">
            <UserPlus />
            従業員を登録する
          </Button>
        </div>
      </AppShell>
    )
  }

  const employee = attendance?.employee
  const commute =
    employee && employee.commuteType !== "none"
      ? {
          label: `通勤費（${COMMUTE_TYPE_LABELS[employee.commuteType]}）`,
          amount: periodCommuteTotal(employee, records),
        }
      : undefined

  return (
    <AppShell tool={KINTAI}>
      <section className="space-y-6">
        <div>
          <h2 className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground">従業員</h2>
          <EmployeePicker
            employees={pickerEmployees}
            value={selectedId}
            onChange={(id) => navigate({ search: (s) => ({ ...s, employee: id }) })}
          />
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <PeriodNav
            period={period}
            onChange={(p) =>
              navigate({ search: (s) => ({ ...s, period: p === currentPeriodKey() ? undefined : p }) })
            }
          />
          <div className="grid grid-cols-2 gap-2 lg:flex">
            <Button
              render={<Link to="/kintai/report" search={{ employee: selectedId!, period }} />}
              nativeButton={false}
              variant="outline"
              size="lg"
              className="h-11 px-4"
            >
              <FileText />
              勤務報告書（PDF）
            </Button>
            <Button size="lg" className="h-11 px-5" onClick={openNewEntry} disabled={!employee}>
              <Plus />
              勤怠を入力
            </Button>
          </div>
        </div>

        <SummaryCards summary={summary} commute={commute} />

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">
              勤怠一覧
              <span className="block text-xs font-normal text-muted-foreground sm:ml-2 sm:inline sm:text-sm">
                {employee?.name}さん・{formatPeriodTitle(period)}
              </span>
            </h2>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                <TabsTrigger value="all">すべての日</TabsTrigger>
                <TabsTrigger value="entered">入力済みのみ</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {dates.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
              この期間の勤怠はまだ入力されていません。
            </div>
          ) : (
            <DayList
              dates={dates}
              recordsByDate={recordsByDate}
              onSelect={openEntry}
              // 都度の人は、往復運賃と違う日（直行直帰など）だけ一覧に表示する
              usualFare={employee?.commuteType === "per_trip" ? defaultDailyFare(employee) : undefined}
            />
          )}
        </div>
      </section>

      {employee && (
        <EntryDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          target={target}
          employee={employee}
          lastEntry={attendance?.lastEntry ?? null}
          recordsByDate={recordsByDate}
          onSavedInOtherPeriod={(saved) => {
            if (saved === period) return
            toast.info(`${formatPeriodTitle(saved)}として保存されました`, {
              action: {
                label: "表示する",
                onClick: () => navigate({ search: (s) => ({ ...s, period: saved }) }),
              },
            })
          }}
        />
      )}
    </AppShell>
  )
}
