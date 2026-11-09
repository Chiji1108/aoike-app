import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { ChevronDown, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, UserRoundX, Users } from "lucide-react"
import { toast } from "sonner"
import { AppShell, KINTAI_NAV, PageHeader } from "@/components/app-shell"
import { KINTAI_NAME } from "@/lib/constants"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { YenField } from "@/components/attendance/yen-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CommuteType } from "@/db/kintai-schema"
import { COMMUTE_TYPE_LABELS, describeCommute, formatYen, type CommuteSetting } from "@/lib/commute"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { createEmployee, deleteEmployee, listEmployees, updateEmployee } from "@/server/employees"

export const Route = createFileRoute("/_authed/kintai/employees")({
  loader: () => listEmployees(),
  head: () => ({ meta: [{ title: `従業員 | ${KINTAI_NAME}` }] }),
  component: EmployeesPage,
})

type Employee = Awaited<ReturnType<typeof listEmployees>>[number]

function EmployeesPage() {
  const employees = Route.useLoaderData()
  const router = useRouter()
  const active = employees.filter((e) => e.active)
  const inactive = employees.filter((e) => !e.active)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState<Employee | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  async function setActive(emp: Employee, value: boolean) {
    try {
      await updateEmployee({ data: { id: emp.id, active: value } })
      toast.success(value ? `${emp.name}さんを有効に戻しました` : `${emp.name}さんを無効にしました`)
      await router.invalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await deleteEmployee({ data: { id: deleting.id } })
      toast.success(`${deleting.name}さんを削除しました`)
      await router.invalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <AppShell nav={KINTAI_NAV}>
      <PageHeader
        title="従業員"
        description="勤怠を記録するスタッフを登録します。"
        actions={
          <Button
            size="lg"
            className="h-10 px-4"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus />
            従業員を追加
          </Button>
        }
      />

      {active.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Users className="size-6" />
          </span>
          <p className="mt-4 font-medium">まだ従業員が登録されていません</p>
          <p className="mt-1 text-sm text-muted-foreground">
            「従業員を追加」から、勤怠を記録するスタッフの氏名を登録してください。
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {active.map((emp) => {
            const commute = describeCommute(emp)
            return (
              <li key={emp.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar name={emp.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{emp.name}</span>
                  {commute && (
                    <span className="block truncate text-xs text-muted-foreground num">
                      通勤：{commute}
                      {emp.commuteRoute && `（${emp.commuteRoute}）`}
                    </span>
                  )}
                </span>
                <Button
                  render={<Link to="/kintai" search={{ employee: emp.id }} />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex"
                >
                  勤怠を見る
                </Button>
                <EmployeeMenu
                  onEdit={() => {
                    setEditing(emp)
                    setFormOpen(true)
                  }}
                  onToggle={() => setActive(emp, false)}
                />
              </li>
            )
          })}
        </ul>
      )}

      {inactive.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-4 transition-transform ${showInactive ? "" : "-rotate-90"}`} />
            無効の従業員（{inactive.length}人）
          </button>
          {showInactive && (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                無効にした従業員は勤怠の入力画面に表示されません。過去の勤怠データはそのまま残っています。
              </p>
              <ul className="mt-3 divide-y overflow-hidden rounded-2xl border bg-card">
                {inactive.map((emp) => (
                  <li key={emp.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <Avatar name={emp.name} muted />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{emp.name}</span>
                    <Badge variant="secondary">無効</Badge>
                    <Button
                      render={<Link to="/kintai" search={{ employee: emp.id }} />}
                      nativeButton={false}
                      variant="ghost"
                      size="sm"
                      className="hidden sm:inline-flex"
                    >
                      勤怠を見る
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setActive(emp, true)}>
                      <RotateCcw />
                      有効に戻す
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${emp.name}さんを削除`}
                      onClick={() => setDeleting(emp)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <EmployeeFormDialog open={formOpen} onOpenChange={setFormOpen} employee={editing} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting?.name}さんを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              勤怠データが1件もない場合のみ削除できます。勤怠データがある場合は「無効」のままにしておいてください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}

function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        muted ? "bg-muted text-muted-foreground" : "bg-brand-soft text-brand"
      }`}
    >
      {name.trim().slice(0, 1)}
    </span>
  )
}

function EmployeeMenu({ onEdit, onToggle }: { onEdit: () => void; onToggle: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="操作" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil />
          編集
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggle}>
          <UserRoundX />
          無効にする
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type FormValues = { name: string } & CommuteSetting

const EMPTY_FORM: FormValues = {
  name: "",
  commuteType: "none",
  commuteRoute: "",
  commuteOneWayFare: 0,
  commutePassMonthly: 0,
}

function toForm(employee: Employee | null): FormValues {
  if (!employee) return EMPTY_FORM
  const { name, commuteType, commuteRoute, commuteOneWayFare, commutePassMonthly } = employee
  return { name, commuteType, commuteRoute, commuteOneWayFare, commutePassMonthly }
}

function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee: Employee | null
}) {
  const router = useRouter()
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const isEdit = !!employee

  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    setError(null)
    setNameError(null)
  }

  // 開くたびに、編集する従業員の内容（追加なら空）から始める
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setValues(toForm(employee))
      setError(null)
      setNameError(null)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = values.name.trim()
    if (!trimmed) return setNameError("氏名を入力してください")
    setPending(true)
    setError(null)
    try {
      const data = { ...values, name: trimmed }
      if (employee) {
        await updateEmployee({ data: { ...data, id: employee.id } })
        toast.success(`${trimmed}さんの情報を保存しました`)
      } else {
        await createEmployee({ data })
        toast.success(`${trimmed}さんを追加しました`)
      }
      await router.invalidate()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{isEdit ? "従業員を編集" : "従業員を追加"}</DialogTitle>
            <DialogDescription>氏名と通勤費は勤務報告書に印字されます。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="emp-name">氏名</Label>
            <Input
              id="emp-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="例：青池 花子"
              className="h-11 text-base"
              autoComplete="off"
              aria-invalid={!!nameError}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="grid gap-2">
            <Label>通勤費</Label>
            <div role="radiogroup" aria-label="通勤費" className="grid grid-cols-3 gap-1.5">
              {(Object.keys(COMMUTE_TYPE_LABELS) as CommuteType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={values.commuteType === t}
                  onClick={() => set("commuteType", t)}
                  className={cn(
                    "h-10 rounded-lg border text-sm font-medium transition-colors",
                    values.commuteType === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted",
                  )}
                >
                  {COMMUTE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {values.commuteType === "pass" && "定期代の月額を、毎月の勤務報告書に載せます。"}
              {values.commuteType === "per_trip" && "出勤した日ごとに往復分の運賃を自動で入れます（日ごとに変更もできます）。"}
              {values.commuteType === "none" && "通勤費を支給しない場合はこちら。勤務報告書にも載りません。"}
            </p>
          </div>

          {values.commuteType !== "none" && (
            <div className="grid gap-4 rounded-xl bg-muted/50 p-4">
              <div className="grid gap-2">
                <Label htmlFor="emp-route">通勤経路</Label>
                <Input
                  id="emp-route"
                  value={values.commuteRoute}
                  onChange={(e) => set("commuteRoute", e.target.value)}
                  placeholder="例：○○駅⇔△△駅（JR）"
                  maxLength={100}
                  className="h-10 bg-background text-base"
                  autoComplete="off"
                />
              </div>
              {values.commuteType === "pass" ? (
                <div className="grid gap-2">
                  <Label htmlFor="emp-pass">定期代（月額）</Label>
                  <YenField
                    id="emp-pass"
                    value={values.commutePassMonthly}
                    onChange={(v) => set("commutePassMonthly", v)}
                    className="[&_input]:bg-background"
                  />
                  <p className="text-xs text-muted-foreground">6ヶ月定期なら、その金額を6で割った額を入力してください。</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="emp-fare">片道の運賃</Label>
                  <div className="flex items-center gap-2">
                    <YenField
                      id="emp-fare"
                      value={values.commuteOneWayFare}
                      onChange={(v) => set("commuteOneWayFare", v)}
                      className="[&_input]:bg-background"
                    />
                    {values.commuteOneWayFare > 0 && (
                      <span className="text-sm text-muted-foreground num">
                        往復 {formatYen(values.commuteOneWayFare * 2)}／日
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {isEdit ? "保存" : "追加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
