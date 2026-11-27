import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { GyoshuSummaryTable, RoundingNote } from "@/components/convert/summary-panel"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { RULE7_TAX_LABELS, SELECTION_LABELS, SELECTION_MODES, TAX_LABELS, type Rule7Tax, type TaxMode } from "@/lib/convert/koji-selection"
import { ROUNDING_LABELS, ROUNDINGS } from "@/lib/convert/transforms"

/**
 * 7割と金額（ダウンロードの段の中）: 設定（Excel の金額が税込か・7割の計算・端数・載せる工事）と、業種ごとの件数と7割・決算書の額を入れる欄
 */
export function SelectionSettings() {
  const actions = useCaseActions()
  const { tax, rule7Tax, rounding, selection, manualCount, basis } = useCase(
    useShallow((s) => ({ tax: s.work.tax, rule7Tax: s.work.rule7Tax, rounding: s.work.rounding, selection: s.work.selection, manualCount: s.work.manual.size, basis: s.work.basis })),
  )
  const roundingTotals = useTable((t) => t.roundingTotals)
  const summary = useCaseView((v) => v.summary)
  return (
    <section className="grid gap-3 border-t pt-4" aria-labelledby="selection-heading" data-testid="selection-section">
      <h3 id="selection-heading" className="text-sm font-medium">
        7割と金額
      </h3>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="Excel の金額" hint="顧客の Excel の金額が税込か税抜か。7割の計算と違えば 1.1 で掛け割りして比べます（金額は変えません）">
          <Segmented label="Excel の金額" value={tax} options={(Object.keys(TAX_LABELS) as TaxMode[]).map((v) => ({ value: v, label: TAX_LABELS[v] }))} onChange={actions.setTax} testId="tax" />
        </Field>
        <Field label="7割の計算" hint="決算書の完成工事高（基準額）が税抜か税込か。初期値は全体ルールの画面の設定">
          <Segmented label="7割の計算" value={rule7Tax} options={(Object.keys(RULE7_TAX_LABELS) as Rule7Tax[]).map((v) => ({ value: v, label: RULE7_TAX_LABELS[v] }))} onChange={actions.setRule7Tax} testId="rule7-tax" />
        </Field>
        <Field label="千円未満">
          <Segmented label="千円未満の端数" value={rounding} options={ROUNDINGS.map((value) => ({ value, label: ROUNDING_LABELS[value] }))} onChange={actions.setRounding} testId="rounding" />
        </Field>
        <Field label="載せる工事" hint="7割ルール: 業種ごとに、元請を金額の大きい順に元請の基準額の7割を超えるまで、続いて残りを合計の基準額の7割を超えるまで載せます。軽微な工事（税込500万円未満、建築一式は1,500万円未満）は10件まで。全件: 7割以上なら件数は自由。顧客が絞ったデータもこちら">
          <Segmented label="載せる工事" value={selection} options={SELECTION_MODES.map((m) => ({ value: m, label: SELECTION_LABELS[m] }))} onChange={actions.changeSelection} testId="selection" />
        </Field>
        {manualCount > 0 && (
          <Button variant="outline" size="sm" onClick={actions.clearManual}>
            手動の入れ外し（{manualCount}件）を戻す
          </Button>
        )}
      </div>
      {roundingTotals && <RoundingNote floor={roundingTotals.floor} round={roundingTotals.round} current={rounding} />}
      <GyoshuSummaryTable summary={summary} basis={basis} rule7Tax={rule7Tax} onBasisChange={actions.setBasis} />
      {tax === "unknown" && (
        <p className="text-xs font-semibold text-muted-foreground" data-testid="tax-unknown-note">
          Excel の金額が分からないので、税込とみなして判定しています。
        </p>
      )}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5" title={hint}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
