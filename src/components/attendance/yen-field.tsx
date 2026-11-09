import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** 円単位の金額入力 */
export function YenField({
  id,
  value,
  onChange,
  invalid,
  className,
}: {
  id: string
  value: number
  onChange: (yen: number) => void
  invalid?: boolean
  className?: string
}) {
  return (
    <div className={cn("relative w-36", className)}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber
          onChange(Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)
        }}
        onFocus={(e) => e.target.select()}
        aria-invalid={invalid}
        className="h-10 pr-9 text-right text-base num"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
        円
      </span>
    </div>
  )
}
