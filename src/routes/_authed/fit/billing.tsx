import { useMemo, useState } from "react"
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { FileSpreadsheet, Loader2, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { FIT_NAME } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { billingMonths, billingRows, billingTotal } from "@/lib/fit/ledger"
import { formatDate, formatYen } from "@/lib/fit/procedure"
import { todayIso } from "@/lib/period"
import { XLSX_TYPE, saveFile } from "@/lib/save-file"
import { listProceduresFn, setInvoiceFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/billing")({
  validateSearch: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
  loader: () => listProceduresFn(),
  head: () => ({ meta: [{ title: `請求 | ${FIT_NAME}` }] }),
  component: BillingPage,
})

const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`

/**
 * 請求の月次明細：完了通知日がその月の手続（月末締め）。請求先は SHARP。侍に打ち込みやすいよう明細と合計を出し、
 * 侍で作った請求書の番号と発行日をまとめて入れる
 */
function BillingPage() {
  const { rows: sources } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const thisMonth = todayIso().slice(0, 7)
  const months = useMemo(() => [...new Set([thisMonth, ...billingMonths(sources)])].sort().reverse(), [sources, thisMonth])
  const month = search.month ?? thisMonth
  const rows = useMemo(() => billingRows(sources, month), [sources, month])
  const total = billingTotal(rows)
  const missingFee = rows.filter((r) => r.fee == null)
  const missingSpecial = rows.filter((r) => r.specialMissing)
  // 額が決まっていない手続があるうちは、請求書を入れさせない（侍の請求書と明細がずれる）
  const blocked = missingFee.length > 0 || missingSpecial.length > 0
  const notInvoiced = rows.filter((r) => !r.invoicedOn)
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoicedOn, setInvoicedOn] = useState(todayIso)
  const [saving, setSaving] = useState(false)

  async function exportExcel() {
    const { tableXlsx } = await import("@/lib/fit/table-xlsx")
    const bytes = await tableXlsx(
      "請求明細",
      `FIT 申請代行 請求明細 ${monthLabel(month)}分（完了通知日 ${monthLabel(month)}）`,
      [
        { header: "事件簿番号", width: 12 },
        { header: "お客様名", width: 20 },
        { header: "申請区分", width: 16 },
        { header: "完了通知日", width: 12, type: "date" },
        { header: "報酬額（税込）", width: 14, type: "yen" },
        { header: "特殊対応（税込）", width: 14, type: "yen" },
        { header: "請求書番号", width: 14 },
      ],
      rows.map((r) => [r.number, r.name, r.kind, r.completedOn, r.fee, r.special || null, r.invoiceNumber || null]),
      ["合計", `${rows.length}件`, null, null, rows.reduce((a, r) => a + (r.fee ?? 0), 0), rows.reduce((a, r) => a + r.special, 0) || null, null],
    )
    saveFile(bytes, `FIT請求明細_${month}.xlsx`, XLSX_TYPE)
  }

  async function saveInvoice(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await setInvoiceFn({ data: { ids: notInvoiced.map((r) => r.id), invoiceNumber, invoicedOn } })
      toast.success(`${notInvoiced.length}件に請求書番号を入れました`)
      setInvoiceNumber("")
      await router.invalidate()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell tool={FIT}>
      <PageHeader
        title="請求"
        description="完了通知日がその月の手続を、月末締めで SHARP に請求します。請求書は侍で作ります。"
        actions={
          <Button size="lg" className="h-10 px-4" onClick={exportExcel} disabled={rows.length === 0} data-testid="billing-export">
            <FileSpreadsheet />
            明細を Excel に
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <NativeSelect aria-label="請求の月" value={month} onChange={(e) => void navigate({ search: { month: e.target.value }, replace: true })} className="w-40 [&_select]:h-9" data-testid="billing-month">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </NativeSelect>
        <span className="text-sm num" data-testid="billing-total">
          {rows.length}件・合計 <span className="text-lg font-semibold">{formatYen(total) || "0円"}</span>（税込）
        </span>
      </div>
      {missingFee.length > 0 && <p className="mb-3 text-sm text-red-700 dark:text-red-400">報酬額が空の手続があります（{missingFee.map((r) => r.number).join("、")}）。手続の画面で入れてください。</p>}
      {missingSpecial.length > 0 && (
        <p className="mb-3 text-sm text-red-700 dark:text-red-400">SHARP が負担する特殊対応の額が空の手続があります（{missingSpecial.map((r) => r.number).join("、")}）。手続の画面で入れてください。</p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{monthLabel(month)}に完了通知した手続はありません。</p>
      ) : (
        <div className="mb-6 overflow-auto rounded-xl border bg-card">
          <table className="w-full text-sm" data-testid="billing-table">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                {["事件簿番号", "お客様名", "申請区分", "完了通知日", "報酬額（税込）", "特殊対応", "請求書"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" data-testid="billing-row">
                  <td className="px-3 py-1.5 num">
                    <Link to="/fit/cases/$caseId" params={{ caseId: r.caseId }} className="text-brand hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5">{r.kind}</td>
                  <td className="px-3 py-1.5 num">{formatDate(r.completedOn)}</td>
                  <td className="px-3 py-1.5 text-right num">{r.fee == null ? <span className="text-red-700">空</span> : formatYen(r.fee)}</td>
                  <td className="px-3 py-1.5 text-right num">{r.special ? formatYen(r.special) : ""}</td>
                  <td className="px-3 py-1.5 num">{r.invoicedOn ? `${r.invoiceNumber}（${formatDate(r.invoicedOn)}）` : <span className="text-muted-foreground">まだ</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notInvoiced.length > 0 && (
        <form onSubmit={saveInvoice} className="grid max-w-2xl gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <p className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
            <ReceiptText className="size-4" />
            侍で作った請求書を入れる（まだの {notInvoiced.length}件）
          </p>
          {blocked && <p className="text-xs text-red-700 sm:col-span-3 dark:text-red-400">額が空の手続があるので、先に額を入れてください。</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="invoiceNumber" className="text-xs text-muted-foreground">
              請求書番号（侍）
            </Label>
            <Input id="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="h-9" data-testid="billing-invoice-number" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invoicedOn" className="text-xs text-muted-foreground">
              発行日
            </Label>
            <Input id="invoicedOn" type="date" value={invoicedOn} onChange={(e) => setInvoicedOn(e.target.value)} className="h-9 num" />
          </div>
          <Button type="submit" disabled={saving || blocked || !invoiceNumber.trim() || !invoicedOn} data-testid="billing-invoice-save">
            {saving && <Loader2 className="animate-spin" />}
            まとめて入れる
          </Button>
        </form>
      )}
    </AppShell>
  )
}
