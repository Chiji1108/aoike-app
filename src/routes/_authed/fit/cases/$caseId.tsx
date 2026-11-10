import { useState } from "react"
import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router"
import { ArrowLeft, Loader2, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { AppShell, FIT } from "@/components/app-shell"
import { CaseFields, caseInput, caseValues, type CaseValues } from "@/components/fit/case-fields"
import { Defects } from "@/components/fit/defects"
import { DateField, SelectField, optionsOf } from "@/components/fit/fields"
import { ProcedureDialog } from "@/components/fit/procedure-dialog"
import { StatusBadge } from "@/components/fit/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FitCase, FitDefect, FitProcedure } from "@/db/fit-schema"
import { FIT_NAME } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { acceptedOnOf, bookNumber, formatDate, formatYen, statusOf } from "@/lib/fit/procedure"
import type { FeeTable } from "@/lib/fit/settings"
import { todayIso } from "@/lib/period"
import { CLOSE_REASON_LABELS, PROCEDURE_KIND_LABELS, SITE_ADDRESS_KIND_LABELS, type ProcedureKind } from "@/lib/fit/types"
import { addProcedureFn, getCasePageFn, updateCaseFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/cases/$caseId")({
  loader: async ({ params }) => {
    const page = await getCasePageFn({ data: { id: params.caseId } })
    if (!page) throw notFound()
    return page
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.fitCase.name ?? "案件"} | ${FIT_NAME}` }] }),
  component: CasePage,
})

function CasePage() {
  const { fitCase, procedures, defects, feeTables } = Route.useLoaderData()
  const router = useRouter()
  const reload = () => void router.invalidate()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)

  return (
    <AppShell tool={FIT}>
      <Link to="/fit/procedures" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        手続の一覧
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="fit-case-name">
            {fitCase.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground num">
            {fitCase.commonId ? `共通ID ${fitCase.commonId}` : "共通ID まだ無し"}
            {fitCase.builder && `・${fitCase.builder}`}
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing(true)} data-testid="fit-case-edit">
          <Pencil />
          案件を直す
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="grid content-start gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">手続</h2>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="fit-add-procedure">
              <Plus />
              手続を足す
            </Button>
          </div>
          {procedures.map((p) => (
            <ProcedureCard key={p.id} procedure={p} defects={defects.filter((d) => d.procedureId === p.id)} feeTables={feeTables} onChanged={reload} />
          ))}
        </section>
        <CaseSummary fitCase={fitCase} />
      </div>

      {editing && <CaseDialog fitCase={fitCase} onClose={() => setEditing(false)} onSaved={reload} />}
      {adding && <AddProcedureDialog caseId={fitCase.id} onClose={() => setAdding(false)} onSaved={reload} />}
    </AppShell>
  )
}

function ProcedureCard({ procedure: p, defects, feeTables, onChanged }: { procedure: FitProcedure; defects: FitDefect[]; feeTables: readonly FeeTable[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const status = statusOf(p, defects.filter((d) => !d.resolvedOn))
  const items: [string, string][] = [
    ["受付日", formatDate(p.receivedOn)],
    ["受任日", formatDate(acceptedOnOf(p))],
    ["報酬額", formatYen(p.fee)],
    ["申請日", formatDate(p.appliedOn)],
    ["申請ID", p.applicationId],
    [p.kind === "new" ? "認定日" : "完了日", formatDate(p.approvedOn)],
    ["設備ID", p.facilityId],
    ["事業者ID", p.businessId],
    ["完了通知日", formatDate(p.completedOn)],
    ["請求書発行日", formatDate(p.invoicedOn)],
    ["入金日", formatDate(p.paidOn)],
  ]
  return (
    <article className="grid gap-4 rounded-2xl border bg-card p-5" data-testid="fit-procedure">
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold num" data-testid="fit-procedure-number">
          {bookNumber(p.bookYear, p.seq)}
        </span>
        <span className="font-medium">{PROCEDURE_KIND_LABELS[p.kind]}</span>
        <StatusBadge status={status} />
        {p.closeReason && <span className="text-xs text-muted-foreground">{CLOSE_REASON_LABELS[p.closeReason]}</span>}
        {p.onHold && p.holdReason && <span className="text-xs text-amber-700 dark:text-amber-400">保留：{p.holdReason}</span>}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setOpen(true)} data-testid="fit-procedure-edit">
          <Pencil />
          直す
        </Button>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="num">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      {p.note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{p.note}</p>}
      <Defects procedureId={p.id} defects={defects} applied={!!p.appliedOn} onChanged={onChanged} />
      {open && <ProcedureDialog procedure={p} feeTables={feeTables} open={open} onOpenChange={setOpen} onSaved={onChanged} />}
    </article>
  )
}

function CaseSummary({ fitCase: c }: { fitCase: FitCase }) {
  const items: [string, string][] = [
    ["フリガナ", c.kana],
    ["電話", c.phone],
    ["メール", c.email],
    ["現住所", [c.postalCode && `〒${c.postalCode}`, c.address].filter(Boolean).join(" ")],
    ["設置場所", [c.sitePostalCode && `〒${c.sitePostalCode}`, c.siteAddress, c.siteAddressKind && `（${SITE_ADDRESS_KIND_LABELS[c.siteAddressKind]}）`].filter(Boolean).join(" ")],
    ["発電出力", c.outputKw == null ? "" : `${c.outputKw} kW`],
    ["蓄電池など", c.hasBattery ? "あり" : "なし"],
    ["共有名義", c.sharedOwnership ? "共有（同意書が要る）" : "単独"],
  ]
  return (
    <aside className="grid content-start gap-3 rounded-2xl border bg-card p-5 text-sm">
      <h2 className="font-semibold">案件</h2>
      <dl className="grid gap-2">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      {c.note && <p className="whitespace-pre-wrap text-muted-foreground">{c.note}</p>}
    </aside>
  )
}

function CaseDialog({ fitCase, onClose, onSaved }: { fitCase: FitCase; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<CaseValues>(() => caseValues(fitCase))
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof CaseValues>(key: K, value: CaseValues[K]) => setValues((v) => ({ ...v, [key]: value }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateCaseFn({ data: { id: fitCase.id, fitCase: caseInput(values) } })
      toast.success("保存しました")
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-3xl" initialFocus={false}>
        <form onSubmit={save}>
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle className="text-lg">案件を直す</DialogTitle>
          </DialogHeader>
          <div className="px-5 py-5">
            <CaseFields values={values} set={set} />
          </div>
          <DialogFooter className="sticky bottom-0 z-10 m-0 rounded-none border-t bg-popover px-5 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              やめる
            </Button>
            <Button type="submit" disabled={saving || !values.name.trim()} data-testid="fit-case-save">
              {saving && <Loader2 className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 同じ案件に手続を足す（変更届・取下げのあとの申請し直しなど）。番号は受付日の年で付く */
function AddProcedureDialog({ caseId, onClose, onSaved }: { caseId: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<ProcedureKind>("pre_change")
  const [receivedOn, setReceivedOn] = useState(todayIso)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await addProcedureFn({ data: { caseId, kind, receivedOn } })
      toast.success("手続を足しました")
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>手続を足す</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">取下げになって申請し直すときも、新しい手続を足します（元の手続は「取下げ」で残す）。</p>
          <SelectField label="申請区分" value={kind} onChange={(v) => v && setKind(v)} options={optionsOf(PROCEDURE_KIND_LABELS)} testId="fit-add-kind" />
          <DateField label="申込書の受付日" value={receivedOn} onChange={(v) => v && setReceivedOn(v)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              やめる
            </Button>
            <Button type="submit" disabled={saving} data-testid="fit-add-save">
              {saving && <Loader2 className="animate-spin" />}
              足す
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
