import { useEffect, useMemo, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { DurationField } from "@/components/attendance/duration-field"
import { YenField } from "@/components/attendance/yen-field"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { defaultDailyFare, formatYen, type CommuteSetting } from "@/lib/commute"
import { DEFAULT_ENTRY } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { DATE_RE, addDays, formatDateWithWeekday, periodKeyForDate, weekdayIndex } from "@/lib/period"
import { TIME_RE, calcWorkMinutes, formatDuration, timeToMinutes } from "@/lib/time"
import { cn } from "@/lib/utils"
import { deleteAttendance, saveAttendance, type AttendanceRow } from "@/server/attendance"

type FormValues = {
  workDate: string
  startTime: string
  endTime: string
  breakMinutes: number
  overtimeMinutes: number
  note: string
  commuteFare: number
}

export type EntryTarget = { date: string; record?: AttendanceRow }

type LastEntry = { startTime: string; endTime: string; breakMinutes: number } | null

function initialValues(target: EntryTarget, last: LastEntry, defaultFare: number): FormValues {
  if (target.record) {
    const { workDate, startTime, endTime, breakMinutes, overtimeMinutes, note, commuteFare } = target.record
    return { workDate, startTime, endTime, breakMinutes, overtimeMinutes, note, commuteFare }
  }
  const base = last ?? DEFAULT_ENTRY
  return {
    workDate: target.date,
    startTime: base.startTime,
    endTime: base.endTime,
    breakMinutes: base.breakMinutes,
    overtimeMinutes: 0,
    note: "",
    commuteFare: defaultFare,
  }
}

export function EntryDialog({
  open,
  onOpenChange,
  target,
  employee,
  lastEntry,
  recordsByDate,
  onSavedInOtherPeriod,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: EntryTarget
  employee: { id: string; name: string } & CommuteSetting
  lastEntry: LastEntry
  recordsByDate: Map<string, AttendanceRow>
  onSavedInOtherPeriod?: (period: string) => void
}) {
  const router = useRouter()
  const defaultFare = defaultDailyFare(employee)
  const [values, setValues] = useState<FormValues>(() => initialValues(target, lastEntry, defaultFare))
  const [editingId, setEditingId] = useState<string | undefined>(target.record?.id)
  const [pending, setPending] = useState<"save" | "next" | "delete" | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setValues(initialValues(target, lastEntry, defaultFare))
      setEditingId(target.record?.id)
      setServerError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    setServerError(null)
  }

  const isEdit = !!editingId
  const duplicate = !isEdit && recordsByDate.has(values.workDate)

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormValues, string>> = {}
    if (!DATE_RE.test(values.workDate)) e.workDate = "日付を入力してください"
    if (!TIME_RE.test(values.startTime)) e.startTime = "出勤時刻を入力してください"
    if (!TIME_RE.test(values.endTime)) e.endTime = "退勤時刻を入力してください"
    if (!e.startTime && !e.endTime) {
      const span = timeToMinutes(values.endTime) - timeToMinutes(values.startTime)
      if (span <= 0) e.endTime = "退勤時刻は出勤時刻より後にしてください"
      else if (values.breakMinutes > span) e.breakMinutes = "休憩時間が勤務時間を超えています"
    }
    if (duplicate) e.workDate = "この日はすでに入力済みです"
    return e
  }, [values, duplicate])

  const hasError = Object.keys(errors).length > 0
  const workMinutes =
    !errors.startTime && !errors.endTime && !errors.breakMinutes ? calcWorkMinutes(values) : null

  async function submit(mode: "save" | "next") {
    if (hasError) return
    setPending(mode)
    setServerError(null)
    try {
      await saveAttendance({ data: { ...values, id: editingId, employeeId: employee.id } })
      const savedPeriod = periodKeyForDate(values.workDate)
      await router.invalidate()

      if (mode === "next") {
        // 次の平日で未入力の日へ（同じ時刻を引き継ぐ）
        let next = addDays(values.workDate, 1)
        for (let i = 0; i < 62; i++) {
          const w = weekdayIndex(next)
          if (w !== 0 && w !== 6 && !recordsByDate.has(next)) break
          next = addDays(next, 1)
        }
        toast.success(`${formatDateWithWeekday(values.workDate)}を保存しました`)
        setValues((prev) => ({ ...prev, workDate: next, overtimeMinutes: 0, note: "", commuteFare: defaultFare }))
        setEditingId(undefined)
      } else {
        toast.success(`${formatDateWithWeekday(values.workDate)}の勤怠を保存しました`)
        onOpenChange(false)
      }
      onSavedInOtherPeriod?.(savedPeriod)
    } catch (e) {
      setServerError(errorMessage(e))
    } finally {
      setPending(null)
    }
  }

  async function remove() {
    if (!editingId) return
    setPending("delete")
    try {
      await deleteAttendance({ data: { id: editingId } })
      await router.invalidate()
      toast.success("勤怠を削除しました")
      setConfirmDelete(false)
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPending(null)
    }
  }

  const validDate = DATE_RE.test(values.workDate)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg"
          // スマートフォンで開いた瞬間にキーボードや日付ピッカーが出ないようにする
          initialFocus={false}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit("save")
            }}
          >
            <DialogHeader className="border-b px-5 pt-5 pb-4">
              <DialogTitle className="text-lg">
                {validDate ? formatDateWithWeekday(values.workDate) : "勤怠の入力"}
                <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                  {isEdit ? "編集" : "新規"}
                </span>
              </DialogTitle>
              <DialogDescription>{employee.name}さん</DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 px-5 py-5">
              <Field label="勤務日" htmlFor="workDate" error={errors.workDate}>
                <Input
                  id="workDate"
                  type="date"
                  value={values.workDate}
                  onChange={(e) => set("workDate", e.target.value)}
                  aria-invalid={!!errors.workDate}
                  className="h-11 w-full text-base num sm:w-48"
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="出勤" htmlFor="startTime" error={errors.startTime}>
                  <Input
                    id="startTime"
                    type="time"
                    step={300}
                    value={values.startTime}
                    onChange={(e) => set("startTime", e.target.value)}
                    aria-invalid={!!errors.startTime}
                    className="h-11 text-base num"
                    required
                  />
                </Field>
                <Field label="退勤" htmlFor="endTime" error={errors.endTime}>
                  <Input
                    id="endTime"
                    type="time"
                    step={300}
                    value={values.endTime}
                    onChange={(e) => set("endTime", e.target.value)}
                    aria-invalid={!!errors.endTime}
                    className="h-11 text-base num"
                    required
                  />
                </Field>
              </div>

              <Field label="休憩時間" htmlFor="breakMinutes" error={errors.breakMinutes}>
                <DurationField
                  id="breakMinutes"
                  value={values.breakMinutes}
                  onChange={(v) => set("breakMinutes", v)}
                  presets={[0, 45, 60, 90]}
                  invalid={!!errors.breakMinutes}
                />
              </Field>

              <Field label="残業時間" htmlFor="overtimeMinutes">
                <DurationField
                  id="overtimeMinutes"
                  value={values.overtimeMinutes}
                  onChange={(v) => set("overtimeMinutes", v)}
                  presets={[0, 30, 60, 90, 120]}
                />
              </Field>

              {employee.commuteType === "per_trip" && (
                <Field label="通勤費" htmlFor="commuteFare">
                  <CommuteFareField
                    value={values.commuteFare}
                    onChange={(v) => set("commuteFare", v)}
                    oneWayFare={employee.commuteOneWayFare}
                  />
                </Field>
              )}

              <Field label="備考" htmlFor="note" optional>
                <Input
                  id="note"
                  value={values.note}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="例：外出（法務局）、半休 など"
                  maxLength={200}
                  className="h-11 text-base"
                />
              </Field>

              <div className="flex items-center justify-between rounded-xl bg-muted/70 px-4 py-3">
                <span className="text-sm text-muted-foreground">実働時間</span>
                <span className="text-base font-semibold num">
                  {workMinutes === null ? "—" : formatDuration(workMinutes)}
                </span>
              </div>

              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            </div>

            <DialogFooter className="sticky bottom-0 z-10 m-0 flex-col-reverse items-stretch gap-2 rounded-none border-t bg-popover px-5 py-4 sm:flex-row sm:items-center">
              {isEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 />
                  削除
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 sm:mr-auto"
                  disabled={hasError || !!pending}
                  onClick={() => submit("next")}
                >
                  {pending === "next" && <Loader2 className="animate-spin" />}
                  保存して次の平日へ
                </Button>
              )}
              <Button type="button" variant="ghost" className="hidden h-10 sm:inline-flex" onClick={() => onOpenChange(false)}>
                キャンセル
              </Button>
              <Button type="submit" className="h-11 px-6 text-base sm:h-10 sm:text-sm" disabled={hasError || !!pending}>
                {pending === "save" && <Loader2 className="animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この勤怠を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {employee.name}さんの{validDate ? formatDateWithWeekday(values.workDate) : ""}
              の勤怠を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            {/* 削除が終わるまで確認を閉じないよう、閉じるボタン（AlertDialogAction）ではなく普通のボタンにする */}
            <Button variant="destructive" onClick={remove} disabled={pending === "delete"}>
              {pending === "delete" && <Loader2 className="animate-spin" />}
              削除する
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Field({
  label,
  htmlFor,
  error,
  optional,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">任意</span>}
      </Label>
      {children}
      <p className={cn("text-xs text-destructive", !error && "hidden")}>{error}</p>
    </div>
  )
}

/** 往復・片道・なしをワンタップで選べる通勤費入力 */
function CommuteFareField({
  value,
  onChange,
  oneWayFare,
}: {
  value: number
  onChange: (yen: number) => void
  oneWayFare: number
}) {
  const presets = [
    { label: "往復", yen: oneWayFare * 2 },
    { label: "片道", yen: oneWayFare },
    { label: "なし", yen: 0 },
  ].filter((p) => p.yen > 0 || p.label === "なし")
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map(({ label, yen }) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(yen)}
            className={cn(
              "h-9 min-w-14 rounded-lg border px-3 text-sm font-medium num transition-colors",
              value === yen
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted",
            )}
          >
            {label}
            {yen > 0 && <span className="ml-1 text-xs font-normal opacity-80">{formatYen(yen)}</span>}
          </button>
        ))}
      </div>
      <YenField id="commuteFare" value={value} onChange={onChange} />
    </div>
  )
}
