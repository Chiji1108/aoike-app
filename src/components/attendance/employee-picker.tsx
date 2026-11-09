import { cn } from "@/lib/utils"

/** 従業員の切り替え（人数が少ないので、ワンタップで選べるボタン形式） */
export function EmployeePicker({
  employees,
  value,
  onChange,
}: {
  employees: { id: string; name: string; active: boolean }[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  return (
    <div role="radiogroup" aria-label="従業員" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {employees.map((emp) => {
        const selected = emp.id === value
        return (
          <button
            key={emp.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(emp.id)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm font-medium whitespace-nowrap transition-all",
              selected
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "bg-card text-foreground hover:border-foreground/20 hover:bg-muted/60",
              !emp.active && !selected && "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                selected ? "bg-primary-foreground/15" : "bg-brand-soft text-brand",
              )}
            >
              {emp.name.trim().slice(0, 1)}
            </span>
            {emp.name}
            {!emp.active && <span className="text-xs opacity-70">（無効）</span>}
          </button>
        )
      })}
    </div>
  )
}
