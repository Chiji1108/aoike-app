import { Link } from "@tanstack/react-router"
import { Ellipsis, History, Trash2, TriangleAlert } from "lucide-react"
import { useCase, useCaseActions } from "@/components/cases/store/context"
import { Cost } from "@/components/cost"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { SaveStatus } from "@/lib/cases/autosave"
import { CASE_STATUSES, CASE_STATUS_LABELS, downloadHistory } from "@/lib/cases/types"
import { CASE_COST_NOTICE_USD } from "@/lib/cost"
import { useFx } from "./tools"

/** 案件の画面の見出し: 顧客への道・案件の名前・保存の状態・案件の状態・「…」（費用と削除） */
export function CaseHeader({ customer, fiscalYear }: { customer: { id: string; name: string }; fiscalYear: number }) {
  const actions = useCaseActions()
  const status = useCase((s) => s.runtime.status)
  const saveStatus = useCase((s) => s.sync.status)
  return (
    <>
      <div className="min-w-0">
        <nav className="flex gap-1 text-xs text-muted-foreground">
          <Link to="/csv" className="hover:underline">
            顧客
          </Link>
          <span>/</span>
          <Link to="/csv/customers/$customerId" params={{ customerId: customer.id }} className="truncate hover:underline">
            {customer.name}
          </Link>
        </nav>
        <h1 className="truncate text-lg font-semibold tracking-tight">{`${customer.name} ${fiscalYear}年度`}</h1>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SaveIndicator status={saveStatus} />
        <Segmented label="案件の状態" value={status} options={CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] }))} onChange={(s) => void actions.changeStatus(s)} testId="case-status" />
        <CaseMenu />
      </div>
    </>
  )
}

/**
 * 見出しの「…」: 案件の AI の費用の合計・ダウンロードの履歴・削除。費用が10ドルを超えたら、ボタンにも注意を出す（止めない）
 */
function CaseMenu() {
  const actions = useCaseActions()
  const usd = useCase((s) => s.runtime.costUsd)
  const downloads = useCase((s) => downloadHistory(s.runtime.files).length)
  const fx = useFx()
  const over = usd > CASE_COST_NOTICE_USD
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="案件のメニュー" title={over ? `この案件の AI の費用が ${CASE_COST_NOTICE_USD} ドルを超えました` : "案件のメニュー"} data-testid="case-menu" data-over={over || undefined} />}
      >
        {over ? <TriangleAlert className="text-amber-600" /> : <Ellipsis />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className={over ? "font-medium text-amber-700" : undefined} data-testid="case-cost" data-over={over || undefined}>
            この案件の AI の費用 <Cost usd={usd} fx={fx} />
            {over && <span className="block">{CASE_COST_NOTICE_USD} ドルを超えました（止めません）</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => actions.setDownloadsOpen(true)} data-testid="downloads-button">
          <History /> ダウンロードの履歴
          {downloads > 0 && <span className="num ml-auto text-xs text-muted-foreground">{downloads}件</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => actions.setDeleteOpen(true)} data-testid="delete-button">
          <Trash2 /> 案件を削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 保存の状態（保存できないときだけ目立たせる） */
function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = {
    saved: "保存しました",
    pending: "保存しています…",
    failed: status.kind === "failed" ? `保存できませんでした（${status.message}）。少し待って送り直します` : "",
    conflict: "別の画面でこの案件が保存されました。再読み込みしてください（この画面の変更は保存しません）",
    tooLarge: "案件の状態が大きすぎて保存できません（次の変更で送り直します）",
    gone: "この案件は削除されたか、削除の途中です（この画面の変更は保存しません）",
  }[status.kind]
  // 保存できているあいだは目立たせない（読み上げには伝える）。保存できないときだけ目立たせる
  const quiet = status.kind === "saved" || status.kind === "pending"
  return (
    <span role="status" className={quiet ? "sr-only" : "basis-full text-xs font-medium text-red-700"} data-testid="save-status" data-status={status.kind}>
      {text}
    </span>
  )
}
