import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseSession, useCaseView, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { InquiryPanel } from "@/components/convert/inquiry-panel"
import { Button } from "@/components/ui/button"
import { INQUIRY_TEXT_PROMPT } from "@/lib/inquiry/text"

/**
 * 問い合わせのタブ: 顧客に聞くセルと、メールの件名・前置き・本文・「送った」。送ったあと（返事待ち）にまだ答えのない問い合わせが残れば、
 * 上に件数と「残りは聞かない」「もう一度メールの下書きを作る」を出す（聞くことが無くなれば済み）。送ったあとに増えた問い合わせは、送り直すよう案内する
 */
export function InquiryTab() {
  const actions = useCaseActions()
  const { config } = useCaseSession()
  const shown = useTable((t) => t.shown)
  const { inquiries, waiting, active, left, unsent, chatCanSend } = useCaseView(
    useShallow((v) => ({
      inquiries: v.inquiries,
      waiting: v.todo.inquiry.state === "waiting",
      active: v.todo.inquiry.active,
      left: v.todo.inquiry.left,
      unsent: v.todo.inquiry.unsent,
      chatCanSend: v.chatCanSend,
    })),
  )
  const pendingInquiryText = useCase((s) => derive(s).pendingInquiryText)
  const { dismissed, text, sent } = useCase(useShallow((s) => ({ dismissed: s.work.dismissed, text: s.work.inquiryText, sent: s.work.inquirySent })))
  if (!shown) return null
  return (
    <>
      {waiting && (
        <div className="grid gap-1 rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid="inquiry-remaining">
          <div className="flex flex-wrap items-center gap-2">
            {left > 0 && (
              <>
                <span>
                  まだ答えのない問い合わせ <strong className="num">{left}</strong> 件
                </span>
                <Button size="sm" variant="outline" onClick={actions.dismissRemaining} data-testid="inquiry-dismiss-remaining">
                  残りは聞かない
                </Button>
              </>
            )}
            {config.chatEnabled && (
              <Button
                size="sm"
                variant="outline"
                disabled={!chatCanSend || pendingInquiryText}
                title={pendingInquiryText ? "前のメールの下書きの案をチャットで承認か却下してください" : undefined}
                onClick={() => actions.askChat(INQUIRY_TEXT_PROMPT)}
                data-testid="inquiry-redraft"
              >
                もう一度メールの下書きを作る
              </Button>
            )}
          </div>
          {active > left && (
            <p className="text-xs text-muted-foreground" data-testid="inquiry-tax-left">
              金額の税込・税抜もまだ聞いています（答えはダウンロードの段の「7割と金額」で入れます）。
            </p>
          )}
        </div>
      )}
      {unsent > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="inquiry-unsent">
          送ったあとに増えた、まだ送っていない問い合わせが <strong className="num">{unsent}</strong> 件あります。メールを送り直して「送った」を押してください。
        </p>
      )}
      <InquiryPanel
        inquiries={inquiries}
        allRows={shown}
        dismissed={dismissed}
        text={text}
        onText={actions.setInquiryText}
        onToggle={actions.toggleInquiry}
        sent={sent}
        onSent={actions.markInquirySent}
      />
    </>
  )
}
