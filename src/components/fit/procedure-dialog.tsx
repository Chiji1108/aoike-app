import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FitProcedure } from "@/db/fit-schema"
import { errorMessage } from "@/lib/errors"
import { acceptedOnOf, bookNumber, formatDate, formatYen } from "@/lib/fit/procedure"
import { feeFor, type FeeTable } from "@/lib/fit/settings"
import { CLOSE_REASON_LABELS, NOTICE_KINDS, PROCEDURE_KIND_LABELS, SPECIAL_PAYER_LABELS, type CloseReason, type ProcedureKind, type SpecialPayer } from "@/lib/fit/types"
import { updateProcedureFn } from "@/server/fit-fns"
import { CheckField, DateField, SelectField, TextField, TextareaField, dateOrNull, intOrNull, optionsOf } from "./fields"

type Values = {
  kind: ProcedureKind
  receivedOn: string
  poaReceivedOn: string
  noticeOn: string
  answeredOn: string
  sealCertIssuedOn: string
  fee: string
  special: boolean
  specialAmount: string
  specialPayer: SpecialPayer | ""
  specialNotifiedOn: string
  specialAnsweredOn: string
  onHold: boolean
  holdReason: string
  appliedOn: string
  applicationId: string
  approvedOn: string
  facilityId: string
  businessId: string
  noticeSaved: boolean
  completedOn: string
  invoicedOn: string
  invoiceNumber: string
  paidOn: string
  closeReason: CloseReason | ""
  note: string
}

const s = (v: string | null) => v ?? ""
const n = (v: number | null) => (v == null ? "" : String(v))

function valuesOf(p: FitProcedure): Values {
  return {
    kind: p.kind,
    receivedOn: p.receivedOn,
    poaReceivedOn: s(p.poaReceivedOn),
    noticeOn: s(p.noticeOn),
    answeredOn: s(p.answeredOn),
    sealCertIssuedOn: s(p.sealCertIssuedOn),
    fee: n(p.fee),
    special: p.special,
    specialAmount: n(p.specialAmount),
    specialPayer: p.specialPayer ?? "",
    specialNotifiedOn: s(p.specialNotifiedOn),
    specialAnsweredOn: s(p.specialAnsweredOn),
    onHold: p.onHold,
    holdReason: p.holdReason,
    appliedOn: s(p.appliedOn),
    applicationId: p.applicationId,
    approvedOn: s(p.approvedOn),
    facilityId: p.facilityId,
    businessId: p.businessId,
    noticeSaved: p.noticeSaved,
    completedOn: s(p.completedOn),
    invoicedOn: s(p.invoicedOn),
    invoiceNumber: p.invoiceNumber,
    paidOn: s(p.paidOn),
    closeReason: p.closeReason ?? "",
    note: p.note,
  }
}

const DATE_KEYS = [
  "poaReceivedOn",
  "noticeOn",
  "answeredOn",
  "sealCertIssuedOn",
  "specialNotifiedOn",
  "specialAnsweredOn",
  "appliedOn",
  "approvedOn",
  "completedOn",
  "invoicedOn",
  "paidOn",
] as const

/** 保存する形 */
function toPatch(v: Values) {
  return {
    ...v,
    ...Object.fromEntries(DATE_KEYS.map((k) => [k, dateOrNull(v[k])])),
    fee: intOrNull(v.fee),
    specialAmount: intOrNull(v.specialAmount),
    specialPayer: v.specialPayer || null,
    closeReason: v.closeReason || null,
  } as Partial<Record<keyof Values, unknown>>
}

/** 変わった項目だけ送る（額を入れずに申請区分だけ変えたときに、サーバーが新しい区分の額に入れ直せるように） */
function changedPatch(before: Values, after: Values) {
  const a = toPatch(before)
  const b = toPatch(after)
  return Object.fromEntries(Object.entries(b).filter(([k, v]) => a[k as keyof Values] !== v))
}

/** 手続の編集。保存したら閉じて、画面を読み直す */
export function ProcedureDialog({
  procedure,
  feeTables,
  open,
  onOpenChange,
  onSaved,
}: {
  procedure: FitProcedure
  feeTables: readonly FeeTable[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [initial] = useState(() => valuesOf(procedure))
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }))

  const accepted = acceptedOnOf({ receivedOn: values.receivedOn, poaReceivedOn: dateOrNull(values.poaReceivedOn) })
  const tableFee = accepted ? feeFor(values.kind, accepted, feeTables) : null
  const isChange = NOTICE_KINDS.has(values.kind)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const patch = changedPatch(initial, values)
    if (Object.keys(patch).length === 0) return onOpenChange(false)
    setSaving(true)
    try {
      await updateProcedureFn({ data: { id: procedure.id, patch } })
      toast.success("保存しました")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-3xl" initialFocus={false}>
        <form onSubmit={save}>
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle className="text-lg">
              <span className="num">{bookNumber(procedure.bookYear, procedure.seq)}</span> {PROCEDURE_KIND_LABELS[values.kind]}
            </DialogTitle>
            <DialogDescription>日付や印から状況が決まります。入れたところまで保存されます。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 px-5 py-5">
            <Group title="受付・受任">
              <SelectField label="申請区分" value={values.kind} onChange={(v) => v && set("kind", v)} options={optionsOf(PROCEDURE_KIND_LABELS)} testId="proc-kind" />
              <DateField label="申込書の受付日" value={values.receivedOn} onChange={(v) => v && set("receivedOn", v)} />
              <DateField label="委任状の受付日" value={values.poaReceivedOn} onChange={(v) => set("poaReceivedOn", v)} testId="proc-poa" hint={accepted ? `受任日 ${formatDate(accepted)}（遅いほう）` : "申込書と委任状がそろった日が受任日"} />
              <DateField label="印鑑証明の発行日" value={values.sealCertIssuedOn} onChange={(v) => set("sealCertIssuedOn", v)} hint="申請時点で発行から3か月以内" testId="proc-seal" />
              <TextField
                label="報酬額（税込・円）"
                type="number"
                value={values.fee}
                onChange={(v) => set("fee", v)}
                testId="proc-fee"
                hint={tableFee != null ? `報酬表の額 ${formatYen(tableFee)}。空のまま保存すると受任日の報酬表の額が入ります` : accepted ? "報酬表に額がありません。手で入れてください" : "受任すると報酬表の額が入ります"}
              />
            </Group>

            {isChange && (
              <Group title="区分の告知（7日たてば了承とみなす）">
                <DateField label="告知日" value={values.noticeOn} onChange={(v) => set("noticeOn", v)} />
                <DateField label="お客様の回答日" value={values.answeredOn} onChange={(v) => set("answeredOn", v)} />
              </Group>
            )}

            <Group title="特殊対応・保留">
              <CheckField label="特殊対応あり" checked={values.special} onChange={(v) => set("special", v)} />
              <CheckField label="保留中" checked={values.onHold} onChange={(v) => set("onHold", v)} testId="proc-hold" />
              {values.special && (
                <>
                  <TextField label="特殊対応の額（円）" type="number" value={values.specialAmount} onChange={(v) => set("specialAmount", v)} />
                  <SelectField label="負担" value={values.specialPayer} onChange={(v) => set("specialPayer", v)} options={optionsOf(SPECIAL_PAYER_LABELS)} empty="—" />
                  <DateField label="SHARP への通知日" value={values.specialNotifiedOn} onChange={(v) => set("specialNotifiedOn", v)} />
                  <DateField label="負担の回答日" value={values.specialAnsweredOn} onChange={(v) => set("specialAnsweredOn", v)} />
                </>
              )}
              {values.onHold && <TextField label="保留の理由" value={values.holdReason} onChange={(v) => set("holdReason", v)} className="sm:col-span-2" />}
            </Group>

            <Group title="申請・認定">
              <DateField label="FIT 申請日" value={values.appliedOn} onChange={(v) => set("appliedOn", v)} testId="proc-applied" />
              <TextField label="申請ID" value={values.applicationId} onChange={(v) => set("applicationId", v)} testId="proc-application-id" />
              <DateField label={values.kind === "new" ? "認定日" : "完了日"} value={values.approvedOn} onChange={(v) => set("approvedOn", v)} testId="proc-approved" />
              <TextField label="設備ID" value={values.facilityId} onChange={(v) => set("facilityId", v)} hint={values.kind === "new" ? "新規は認定のときに付く" : "変更系は受付のときに入れる"} />
              <TextField label="事業者ID" value={values.businessId} onChange={(v) => set("businessId", v)} />
              <CheckField label="認定通知書を保存した" checked={values.noticeSaved} onChange={(v) => set("noticeSaved", v)} testId="proc-notice-saved" />
            </Group>

            <Group title="完了・請求">
              <DateField label="完了通知日" value={values.completedOn} onChange={(v) => set("completedOn", v)} testId="proc-completed" hint="この日の月の請求に入る" />
              <DateField label="請求書の発行日" value={values.invoicedOn} onChange={(v) => set("invoicedOn", v)} />
              <TextField label="請求書番号（侍）" value={values.invoiceNumber} onChange={(v) => set("invoiceNumber", v)} />
              <DateField label="入金日" value={values.paidOn} onChange={(v) => set("paidOn", v)} />
              <SelectField label="途中で終わった" value={values.closeReason} onChange={(v) => set("closeReason", v)} options={optionsOf(CLOSE_REASON_LABELS)} empty="—" hint="取下げで申請し直すときは、新しい手続を足す" />
            </Group>

            <TextareaField label="メモ" value={values.note} onChange={(v) => set("note", v)} />
          </div>

          <DialogFooter className="sticky bottom-0 z-10 m-0 rounded-none border-t bg-popover px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              やめる
            </Button>
            <Button type="submit" disabled={saving} data-testid="proc-save">
              {saving && <Loader2 className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}
