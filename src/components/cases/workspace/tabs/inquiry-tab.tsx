import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseSession, useCaseView, useTable } from "@/components/cases/store/context"
import { InquiryPanel } from "@/components/convert/inquiry-panel"
import { Button } from "@/components/ui/button"
import { INQUIRY_TEXT_PROMPT } from "@/lib/inquiry/text"

/**
 * 問い合わせのタブ: 顧客に聞くセルと、メールの件名・前置き・本文。送ったあと（返事待ち）にまだ答えのない問い合わせが残れば、
 * 上に件数と「残りは聞かない」「もう一度メールの下書きを作る」を出す（聞くことが無くなれば済み）
 */
export function InquiryTab() {
  const actions = useCaseActions()
  const { config } = useCaseSession()
  const shown = useTable((t) => t.shown)
  const { inquiries, waiting, active, chatCanSend } = useCaseView(
    useShallow((v) => ({ inquiries: v.inquiries, waiting: v.todo.inquiry.state === "waiting", active: v.todo.inquiry.active, chatCanSend: v.chatCanSend })),
  )
  const { dismissed, text } = useCase(useShallow((s) => ({ dismissed: s.work.dismissed, text: s.work.inquiryText })))
  if (!shown) return null
  return (
    <>
      {waiting && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid="inquiry-remaining">
          <span>
            まだ答えのない問い合わせ <strong className="num">{active}</strong> 件
          </span>
          <Button size="sm" variant="outline" onClick={actions.dismissRemaining} data-testid="inquiry-dismiss-remaining">
            残りは聞かない
          </Button>
          {config.chatEnabled && (
            <Button size="sm" variant="outline" disabled={!chatCanSend} onClick={() => actions.askChat(INQUIRY_TEXT_PROMPT)} data-testid="inquiry-redraft">
              もう一度メールの下書きを作る
            </Button>
          )}
        </div>
      )}
      <InquiryPanel inquiries={inquiries} allRows={shown} dismissed={dismissed} text={text} onText={actions.setInquiryText} onToggle={actions.toggleInquiry} />
    </>
  )
}
