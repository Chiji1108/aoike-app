import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/** FIT のフォームの欄（見出し・入力・下の注意書き）。入力の id は見出しとつなぐ */

type Common = { label: string; hint?: React.ReactNode; className?: string; testId?: string }

function Field({ label, hint, className, htmlFor, children }: Common & { htmlFor: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function TextField({ value, onChange, type = "text", placeholder, ...common }: Common & { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  const id = useId()
  return (
    <Field {...common} htmlFor={id}>
      <Input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={common.testId} />
    </Field>
  )
}

/** 日付（YYYY-MM-DD。空は未入力） */
export function DateField({ value, onChange, ...common }: Common & { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Field {...common} htmlFor={id}>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 num" data-testid={common.testId} />
    </Field>
  )
}

export function TextareaField({ value, onChange, ...common }: Common & { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Field {...common} htmlFor={id}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={common.testId} />
    </Field>
  )
}

/** 選択肢（空の値「—」は未選択） */
export function SelectField<T extends string>({
  value,
  onChange,
  options,
  empty,
  ...common
}: Common & { value: T | ""; onChange: (v: T | "") => void; options: readonly { value: T; label: string }[]; empty?: string }) {
  const id = useId()
  return (
    <Field {...common} htmlFor={id}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as T | "")} className="[&_select]:h-9" data-testid={common.testId}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}

export function CheckField({ checked, onChange, label, className, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string; testId?: string }) {
  const id = useId()
  return (
    <div className={cn("flex items-center gap-2 self-end py-2", className)}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} data-testid={testId} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

/** 決まった値の表示名の表から、選択肢の並びを作る */
export const optionsOf = <T extends string>(labels: Record<T, string>) => (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }))

/** 入力の文字列 ↔ 保存する値 */
export const dateOrNull = (v: string) => (v ? v : null)
export const intOrNull = (v: string) => {
  const n = Number(v.replace(/[,，円\s]/g, ""))
  return v.trim() && Number.isFinite(n) ? Math.round(n) : null
}
export const numberOrNull = (v: string) => {
  const n = Number(v.trim())
  return v.trim() && Number.isFinite(n) ? n : null
}
