import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { CaseFields, caseInput, caseValues, type CaseValues } from "@/components/fit/case-fields"
import { DateField, SelectField, optionsOf } from "@/components/fit/fields"
import { Button } from "@/components/ui/button"
import { FIT_NAME } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { todayIso } from "@/lib/fit/procedure"
import { PROCEDURE_KIND_LABELS, type ProcedureKind } from "@/lib/fit/types"
import { createCaseFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/new")({
  head: () => ({ meta: [{ title: `申込の受付 | ${FIT_NAME}` }] }),
  component: NewCasePage,
})

/** 申込書が届いたとき：案件と最初の手続を作る（事件簿の番号はここで付く） */
function NewCasePage() {
  const router = useRouter()
  const [values, setValues] = useState<CaseValues>(() => caseValues())
  const [kind, setKind] = useState<ProcedureKind>("new")
  const [receivedOn, setReceivedOn] = useState(todayIso)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof CaseValues>(key: K, value: CaseValues[K]) => setValues((v) => ({ ...v, [key]: value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { caseId } = await createCaseFn({ data: { fitCase: caseInput(values), kind, receivedOn } })
      toast.success("受け付けました")
      await router.navigate({ to: "/fit/cases/$caseId", params: { caseId } })
    } catch (err) {
      toast.error(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <AppShell tool={FIT}>
      <PageHeader title="申込を受け付ける" description="申込書の内容を入れます。足りないところはあとから案件の画面で直せます。" />
      <form onSubmit={submit} className="grid max-w-3xl gap-8">
        <section className="grid gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-2">
          <SelectField label="申請区分" value={kind} onChange={(v) => v && setKind(v)} options={optionsOf(PROCEDURE_KIND_LABELS)} testId="fit-kind" />
          <DateField label="申込書の受付日" value={receivedOn} onChange={(v) => v && setReceivedOn(v)} hint="この日の年で事件簿の番号が付きます" testId="fit-received" />
        </section>
        <CaseFields values={values} set={set} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.history.back()}>
            やめる
          </Button>
          <Button type="submit" size="lg" disabled={saving || !values.name.trim()} data-testid="fit-create">
            {saving && <Loader2 className="animate-spin" />}
            受け付ける
          </Button>
        </div>
      </form>
    </AppShell>
  )
}
