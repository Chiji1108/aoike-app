import { useMemo } from "react"
import { ChevronRight, CircleAlert, CircleCheck, Download, FileSpreadsheet, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BasisSection, fmt, fmtSigned, GyoshuRatioTable } from "@/components/convert/summary-panel"
import { remainingSteps, type StepId } from "@/components/cases/next-steps"
import type { CaseTodo } from "@/lib/cases/todo"
import { FIX_ACTIONS, fixActionText, type FixActionId } from "@/components/convert/status"
import { exportCheck, issueLabel, type ExportCheck } from "@/lib/cases/export-check"
import type { RowResult } from "@/lib/convert/convert"
import { type Basis, type GyoshuSummary, type Rule7Tax } from "@/lib/convert/koji-selection"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { cn } from "@/lib/utils"

const SIDE = { total: "完成工事高", motouke: "うち元請" } as const

/**
 * ダウンロードの段（前はダイアログ。段の中身として置く）。載せる件数・7割に届いたか（届かない業種だけ表で出す）・エラーと要確認の残り・Shift_JIS で書けない文字を出し、
 * 「決算書の額を入れる」で業種ごとの完成工事高（7割の基準額と同じ値）を入れると表の合計と照らす。合わなくても止めない。
 * 出すのは最後の Excel（職員がこれまで作っていた形。Excel で確かめて「CSV で保存」する。直して上げ直すと表に戻る）。CSV は控え。
 * 答えていない聞き返しは「答える」の段で答える（残りの「答える」を押すとそこへ移る）。金額・7割・載せる行に関わる聞き返し（unsettled）が残っている間は、
 * ダウンロードのボタンを控えめにして「このままダウンロード」と書く
 */
export function ExportPanel({
  output,
  summary,
  basis,
  rule7Tax,
  onBasisChange,
  onExcel,
  onCsv,
  steps,
  onGo,
  onFixAction,
  unsettled,
}: {
  output: readonly RowResult<KojiFieldId>[]
  summary: GyoshuSummary[]
  basis: Basis
  rule7Tax: Rule7Tax
  onBasisChange: (code: string, side: "total" | "motouke", value: number | undefined) => void
  onExcel: () => void
  onCsv: () => void
  /** 段の残り（段の並び・ダウンロードのツールチップと同じ言葉で出す。押すとその段へ移る） */
  steps: CaseTodo
  onGo: (id: StepId) => void
  /** 直し方の操作（「業種が空の N 行を一覧で決める」など。表の上と同じ） */
  onFixAction: (action: FixActionId, keys: readonly string[]) => void
  /** 金額・7割・載せる行に関わる聞き返しが残っている・税込か税抜かが決まっていない（ボタンを控えめに。止めはしない） */
  unsettled: boolean
}) {
  const check = useMemo(() => exportCheck(output, summary), [output, summary])
  const label = (kind: string) => (unsettled ? `このままダウンロード（${kind}）` : kind)
  return (
    <div className="grid max-w-3xl gap-3 text-sm" data-testid="export-dialog">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">
          ダウンロード（<span className="num" data-testid="export-rows">{output.length}</span> 件）
        </h2>
        <span className="flex gap-2 sm:ml-auto" data-testid="export-footer" data-unsettled={unsettled ? "1" : "0"}>
          <Button variant="outline" onClick={onCsv} disabled={output.length === 0} data-testid="download-button">
            <Download /> {label("CSV")}
          </Button>
          <Button variant={unsettled ? "outline" : "default"} onClick={onExcel} disabled={output.length === 0} data-testid="export-excel">
            <FileSpreadsheet /> {label("Excel")}
          </Button>
        </span>
      </div>
      <Remaining steps={steps} answers={null} onGo={onGo} onFixAction={onFixAction} />
      <ul className="grid gap-1.5" data-testid="export-checks">
        <Rule7Line check={check} summary={summary} />
        <CheckLine ok={check.mismatches.length === 0} testId="export-basis">
          {check.mismatches.length === 0
            ? check.fromBook.total + check.fromBook.motouke
              ? "決算書の額と合っています"
              : "決算書の額はまだ入れていません"
            : check.mismatches.map((m) => `${m.label}の${SIDE[m.side]}: 決算書 ${fmt(m.entered)} 千円・表の合計 ${fmt(m.rows)} 千円（差 ${fmtSigned(m.diff)} 千円）`).join(" / ")}
        </CheckLine>
        {check.mismatches.length > 0 && <li className="pl-6 text-xs text-muted-foreground">工事の漏れ・税込と税抜の取り違え・業種の分け方の違いが考えられます</li>}
        <CheckLine ok={check.errors === 0} testId="export-errors">
          {check.errors === 0 ? "エラーなし" : `エラー ${check.errors} 件（取り込めないか、誤って取り込まれます）`}
        </CheckLine>
        <CheckLine ok={check.warnings === 0} warn testId="export-warnings">
          {check.warnings === 0 ? "要確認なし" : `要確認 ${check.warnings} 件`}
        </CheckLine>
        <CheckLine ok={check.unencodable.length === 0} testId="export-unencodable">
          {check.unencodable.length === 0
            ? "Shift_JIS で書けない文字なし"
            : `Shift_JIS で書けない文字 ${check.unencodable.length} セル（${[...new Set(check.unencodable.flatMap((u) => u.chars))].join(" ")}）。Excel の「CSV で保存」で「?」になります`}
        </CheckLine>
      </ul>
      <BasisSection summary={summary} basis={basis} rule7Tax={rule7Tax} onBasisChange={onBasisChange} />
      {check.issues.length > 0 && (
        <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs" data-testid="export-issues">
          <summary className="cursor-pointer font-medium">内訳</summary>
          <ul className="mt-1.5 grid gap-0.5">
            {check.issues.slice(0, 30).map((i) => (
              <li key={`${i.status}${i.field}${i.message}`} className={i.status === "error" ? "text-red-700" : "text-amber-800"}>
                {issueLabel(i)}（{i.count}件）
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-muted-foreground" data-testid="export-note">
        Excel で直したら、その Excel をチャットの📎でアップロードすると表に戻ります。取込は1回だけ（追加になる）、「1行目が項目行」は外す。
      </p>
    </div>
  )
}

/**
 * ダウンロードの前に残っていること（次にやることと同じ言葉）。答えるは上に1つずつ出すので、出していれば（answers が上の残りの数）除く。
 * 無ければ済みと出す（上に答えが残っていれば出さない）
 */
function Remaining({
  steps,
  answers,
  onGo,
  onFixAction,
}: {
  steps: CaseTodo
  answers: number | null
  onGo: (id: StepId) => void
  onFixAction: (action: FixActionId, keys: readonly string[]) => void
}) {
  const left = remainingSteps(steps).filter((r) => !(answers !== null && r.id === "answer"))
  if (!left.length && answers) return null
  if (!left.length)
    return (
      <p className="flex items-center gap-2 text-emerald-800" data-testid="export-remaining" data-left="0">
        <CircleCheck className="size-4 text-emerald-600" /> 残りはありません
      </p>
    )
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" data-testid="export-remaining" data-left={left.length}>
      <TriangleAlert className="mr-1 size-4 text-amber-600" />
      <span className="mr-1">残り:</span>
      {left.map((r, i) => (
        <span key={r.id} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 opacity-60" aria-hidden />}
          <Button size="xs" variant="outline" className="bg-background" onClick={() => onGo(r.id)} data-testid={`export-remaining-${r.id}`}>
            {r.text}
          </Button>
        </span>
      ))}
      {steps.fixActions.length > 0 && (
        <span className="flex basis-full flex-wrap gap-1 pt-1" data-testid="export-fix-actions">
          {steps.fixActions.map((g) => (
            <Button
              key={`${g.action}:${g.field}`}
              size="xs"
              variant="ghost"
              className="text-amber-900 underline-offset-2 hover:underline"
              title={FIX_ACTIONS[g.action].title}
              onClick={() => onFixAction(g.action, g.keys)}
              data-testid="export-fix-action"
              data-action={g.action}
            >
              {fixActionText(g)}
            </Button>
          ))}
        </span>
      )}
      <span className="basis-full pt-0.5 text-xs text-amber-800/80">残っていてもダウンロードできます。</span>
    </div>
  )
}

/**
 * 7割の1行。全部の業種で確かめられて満たしていれば1行だけ。届かない・確かめられない（基準額が 0）業種があれば、その業種だけの表を下に出す
 */
function Rule7Line({ check, summary }: { check: ExportCheck; summary: readonly GyoshuSummary[] }) {
  const { short, unchecked, fromBook } = check
  const ok = summary.length > 0 && short.length === 0 && unchecked.length === 0
  const text = ok
    ? `7割: すべての業種で満たしています${fromBook.total + fromBook.motouke ? "" : "（基準は顧客の表の合計）"}`
    : summary.length === 0
      ? "7割: 確かめる業種がありません"
      : [
          ...(short.length ? [`7割に届かない: ${short.map((s) => `${s.label}（${SIDE[s.side]}）`).join("・")}`] : []),
          ...(unchecked.length ? [`7割を確かめられない（金額が 0）: ${unchecked.map((u) => u.label).join("・")}`] : []),
        ].join("。")
  const codes = new Set([...short, ...unchecked].map((s) => s.code))
  return (
    <>
      <CheckLine ok={ok} testId="export-rule7">
        {text}
      </CheckLine>
      {codes.size > 0 && (
        <li className="pl-6">
          <GyoshuRatioTable summary={summary.filter((g) => codes.has(g.code))} />
        </li>
      )}
    </>
  )
}

function CheckLine({ ok, warn = false, testId, children }: { ok: boolean; warn?: boolean; testId: string; children: React.ReactNode }) {
  const Icon = ok ? CircleCheck : warn ? CircleAlert : TriangleAlert
  return (
    <li className={cn("flex items-start gap-2", !ok && (warn ? "text-amber-800" : "text-red-800"))} data-testid={testId} data-ok={ok ? "1" : "0"}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-emerald-600" : warn ? "text-amber-600" : "text-red-600")} />
      <span>{children}</span>
    </li>
  )
}
