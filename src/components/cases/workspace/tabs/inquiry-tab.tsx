import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { InquiryPanel } from "@/components/convert/inquiry-panel"

/** 問い合わせのタブ: 顧客に聞くセルと、メールの件名・前置き・本文 */
export function InquiryTab() {
  const actions = useCaseActions()
  const shown = useTable((t) => t.shown)
  const inquiries = useCaseView((v) => v.inquiries)
  const { dismissed, text } = useCase(useShallow((s) => ({ dismissed: s.work.dismissed, text: s.work.inquiryText })))
  if (!shown) return null
  return <InquiryPanel inquiries={inquiries} allRows={shown} dismissed={dismissed} text={text} onText={actions.setInquiryText} onToggle={actions.toggleInquiry} />
}
