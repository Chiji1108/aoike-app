import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { InquiryPanel } from "@/components/convert/inquiry-panel"

/** 問い合わせのタブ: 顧客に聞くセル・メールの件名と前置き・添付の Excel */
export function InquiryTab() {
  const actions = useCaseActions()
  const shown = useTable((t) => t.shown)
  const { inquiries, attachment } = useCaseView(useShallow((v) => ({ inquiries: v.inquiries, attachment: v.attachment })))
  const { dismissed, answers, text } = useCase(useShallow((s) => ({ dismissed: s.work.dismissed, answers: s.work.answers, text: s.work.inquiryText })))
  if (!shown) return null
  return (
    <InquiryPanel
      inquiries={inquiries}
      allRows={shown}
      dismissed={dismissed}
      answers={answers}
      text={text}
      onText={actions.setInquiryText}
      attachment={attachment}
      onDownload={actions.downloadInquiry}
      onToggle={actions.toggleInquiry}
    />
  )
}
