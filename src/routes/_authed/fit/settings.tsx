import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { intOrNull } from "@/components/fit/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FIT_NAME } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { DEFAULT_SETTINGS, type FitSettings } from "@/lib/fit/settings"
import { PROCEDURE_KINDS, PROCEDURE_KIND_LABELS, type ProcedureKind } from "@/lib/fit/types"
import { addMonths } from "@/lib/period"
import { getSettingsFn, saveSettingsFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/settings")({
  loader: () => getSettingsFn(),
  head: () => ({ meta: [{ title: `設定 | ${FIT_NAME}` }] }),
  component: SettingsPage,
})

type DayKey = "sealWarnDays" | "correctionWarnDays" | "deadlineWarnDays" | "stalledAcceptedDays" | "stalledAppliedDays"

const DAY_FIELDS: { key: DayKey; label: string; hint: string }[] = [
  { key: "sealWarnDays", label: "印鑑証明の期限の注意", hint: "期限（発行から3か月）までこの日数を切ったら" },
  { key: "correctionWarnDays", label: "補正の期限の注意", hint: "補正の期限までこの日数を切ったら" },
  { key: "deadlineWarnDays", label: "年度の受付締切の注意", hint: "締切までこの日数を切ったら、未申請の認定の手続を出す" },
  { key: "stalledAcceptedDays", label: "受任してから動いていない", hint: "受任からこの日数たっても申請していなければ" },
  { key: "stalledAppliedDays", label: "申請してから動いていない", hint: "申請からこの日数たっても認定・完了がなければ" },
]

/** 入力中の値（金額・日数は文字列で持つ） */
type Draft = {
  feeTables: { acceptedUntil: string; fees: Record<ProcedureKind, string> }[]
  fiscalDeadlines: { fiscalYear: string; deadline: string }[]
  days: Record<DayKey, string>
  retentionYears: string
}

const toDraft = (s: FitSettings): Draft => ({
  feeTables: s.feeTables.map((t) => ({ acceptedUntil: t.acceptedUntil, fees: Object.fromEntries(PROCEDURE_KINDS.map((k) => [k, t.fees[k] == null ? "" : String(t.fees[k])])) as Record<ProcedureKind, string> })),
  fiscalDeadlines: s.fiscalDeadlines.map((d) => ({ fiscalYear: String(d.fiscalYear), deadline: d.deadline })),
  days: Object.fromEntries(DAY_FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<DayKey, string>,
  retentionYears: String(s.retentionYears),
})

const fromDraft = (d: Draft): FitSettings => ({
  feeTables: d.feeTables.map((t) => ({ acceptedUntil: t.acceptedUntil, fees: Object.fromEntries(PROCEDURE_KINDS.map((k) => [k, intOrNull(t.fees[k])])) as Record<ProcedureKind, number | null> })),
  fiscalDeadlines: d.fiscalDeadlines.map((x) => ({ fiscalYear: Number(x.fiscalYear), deadline: x.deadline })),
  ...(Object.fromEntries(DAY_FIELDS.map((f) => [f.key, Number(d.days[f.key])])) as Record<DayKey, number>),
  retentionYears: Number(d.retentionYears),
})

function SettingsPage() {
  const settings = Route.useLoaderData()
  const router = useRouter()
  const [draft, setDraft] = useState(() => toDraft(settings))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await saveSettingsFn({ data: fromDraft(draft) })
      toast.success("設定を保存しました")
      await router.invalidate()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const last = draft.feeTables.at(-1)
  return (
    <AppShell tool={FIT}>
      <PageHeader title="設定" description="報酬表・年度の受付締切・期限の注意の日数。変えたら保存してください。" />
      <form onSubmit={save} className="grid max-w-4xl gap-8">
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">報酬表（税込・円）</h2>
          <p className="text-sm text-muted-foreground">
            「この日までに受任」の表を使います（受任したときの額で決め、あとで表を変えても入った額は動きません）。空欄は事案ごと（手で入れる）。
          </p>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm" data-testid="fee-tables">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">この日までに受任</th>
                  {PROCEDURE_KINDS.map((k) => (
                    <th key={k} className="px-2 py-2 text-left font-medium">
                      {PROCEDURE_KIND_LABELS[k]}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.feeTables.map((t, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">
                      <Input
                        type="date"
                        aria-label="この日までに受任"
                        value={t.acceptedUntil}
                        onChange={(e) => setDraft((d) => ({ ...d, feeTables: d.feeTables.map((x, j) => (j === i ? { ...x, acceptedUntil: e.target.value } : x)) }))}
                        className="h-9 w-40 num"
                      />
                    </td>
                    {PROCEDURE_KINDS.map((k) => (
                      <td key={k} className="p-2">
                        <Input
                          inputMode="numeric"
                          aria-label={`${PROCEDURE_KIND_LABELS[k]}の報酬`}
                          value={t.fees[k]}
                          onChange={(e) => setDraft((d) => ({ ...d, feeTables: d.feeTables.map((x, j) => (j === i ? { ...x, fees: { ...x.fees, [k]: e.target.value } } : x)) }))}
                          className="h-9 w-24 num"
                        />
                      </td>
                    ))}
                    <td className="p-2">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="この表を消す" disabled={draft.feeTables.length <= 1} onClick={() => setDraft((d) => ({ ...d, feeTables: d.feeTables.filter((_, j) => j !== i) }))}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            data-testid="fee-table-add"
            // 次の期間の表：前の表の額を写し、期限は1年後
            onClick={() => setDraft((d) => ({ ...d, feeTables: [...d.feeTables, { acceptedUntil: last ? addMonths(last.acceptedUntil, 12) : "", fees: { ...(last?.fees ?? toDraft(DEFAULT_SETTINGS).feeTables[0]!.fees) } }] }))}
          >
            <Plus />
            次の期間の報酬表を足す
          </Button>
        </section>

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">年度の受付締切（新規・変更認定）</h2>
          <p className="text-sm text-muted-foreground">年度は4月始まり。届出は1年中受付なので対象外です。</p>
          <ul className="grid gap-2">
            {draft.fiscalDeadlines.map((x, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  inputMode="numeric"
                  aria-label="年度（西暦）"
                  value={x.fiscalYear}
                  onChange={(e) => setDraft((d) => ({ ...d, fiscalDeadlines: d.fiscalDeadlines.map((y, j) => (j === i ? { ...y, fiscalYear: e.target.value } : y)) }))}
                  className="h-9 w-24 num"
                />
                <span className="text-sm">年度の締切</span>
                <Input
                  type="date"
                  aria-label="締切"
                  value={x.deadline}
                  onChange={(e) => setDraft((d) => ({ ...d, fiscalDeadlines: d.fiscalDeadlines.map((y, j) => (j === i ? { ...y, deadline: e.target.value } : y)) }))}
                  className="h-9 w-40 num"
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="この締切を消す" onClick={() => setDraft((d) => ({ ...d, fiscalDeadlines: d.fiscalDeadlines.filter((_, j) => j !== i) }))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => setDraft((d) => ({ ...d, fiscalDeadlines: [...d.fiscalDeadlines, { fiscalYear: String(Number(d.fiscalDeadlines.at(-1)?.fiscalYear ?? new Date().getFullYear()) + 1), deadline: "" }] }))}
          >
            <Plus />
            年度を足す
          </Button>
        </section>

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">期限の注意の日数</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {DAY_FIELDS.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={f.key} className="text-xs text-muted-foreground">
                  {f.label}
                </Label>
                <div className="flex items-center gap-2">
                  <Input id={f.key} inputMode="numeric" value={draft.days[f.key]} onChange={(e) => setDraft((d) => ({ ...d, days: { ...d.days, [f.key]: e.target.value } }))} className="h-9 w-24 num" data-testid={`setting-${f.key}`} />
                  <span className="text-sm">日</span>
                </div>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label htmlFor="retentionYears" className="text-xs text-muted-foreground">
                書類の保存期間
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-sm">帳簿を閉じた年末から</span>
                <Input id="retentionYears" inputMode="numeric" value={draft.retentionYears} onChange={(e) => setDraft((d) => ({ ...d, retentionYears: e.target.value }))} className="h-9 w-20 num" />
                <span className="text-sm">年</span>
              </div>
              <p className="text-xs text-muted-foreground">行政書士法第9条第2項は2年。過ぎた書類は一覧で確かめてから消す</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={saving} data-testid="settings-save">
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </div>
      </form>
    </AppShell>
  )
}
