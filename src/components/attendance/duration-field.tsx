import { Input } from "@/components/ui/input"
import { formatDuration } from "@/lib/time"
import { cn } from "@/lib/utils"

/** 分単位の時間入力（よく使う値はワンタップで選べる） */
export function DurationField({
  id,
  value,
  onChange,
  presets,
  invalid,
}: {
  id: string
  value: number
  onChange: (minutes: number) => void
  presets: number[]
  invalid?: boolean
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "h-9 min-w-14 rounded-lg border px-3 text-sm font-medium num transition-colors",
              value === m
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted",
            )}
          >
            {m === 0 ? "なし" : formatDuration(m)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-32">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            step={5}
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
            分
          </span>
        </div>
        {value >= 60 && <span className="text-sm text-muted-foreground num">＝ {formatDuration(value)}</span>}
      </div>
    </div>
  )
}
