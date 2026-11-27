import { useMemo } from "react"
import { Copy, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { CaseStatus } from "@/lib/cases/types"
import type { RowResult } from "@/lib/convert/convert"
import { fieldLabel } from "@/lib/spec/koji-keireki"
import { errorMessage } from "@/lib/errors"
import { countsByItem, DEFAULT_INTRO, inquiryEmail } from "@/lib/inquiry/email"
import { DraftText } from "./draft-text"
import { MAX_INTRO_LENGTH, MAX_SUBJECT_LENGTH, type InquiryText } from "@/lib/inquiry/text"
import { CASE_TOPICS, inquiryKey, REASONS, type Inquiry } from "@/lib/inquiry/inquiry"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"

type Row = RowResult<KojiFieldId>

const BUSY_TITLE = "変換し直しています。終わると使えます"

/**
 * 顧客に問い合わせる: 件数・項目ごとの件数・外すチェックと、メールの件名と本文（聞くことは本文に工事ごとに並べる）。
 * 顧客の答え（メールの本文・ファイル）はチャットに貼る・📎で付けると、チャットの AI が顧客の回答の変更案にする。
 * inquiries は CSV に載せる行から集めたもの
 */
export function InquiryPanel({
  inquiries,
  allRows,
  dismissed,
  text,
  onText,
  onToggle,
  status,
  onSent,
  busy,
  numbers,
}: {
  inquiries: Inquiry[]
  allRows: Row[]
  dismissed: ReadonlySet<string>
  /** 問い合わせのメールの件名と前置き（案件の作業） */
  text: InquiryText
  onText: (next: (prev: InquiryText) => InquiryText) => void
  onToggle: (key: string, ask: boolean) => void
  /** 案件の状態（問い合わせ中＝送った・返事待ち。完了なら「送った」は出さない） */
  status: CaseStatus
  /** 「送った」: 案件の状態を問い合わせ中にする（コピーでは送った扱いにしない。戻すときは案件の状態を切り替える） */
  onSent: () => void
  /** 変換し直している間（表は前の行なので、本文のコピーと「送った」を押せない） */
  busy: boolean
  /** 工事の番号（lib/inquiry/email.ts の inquiryNumbers） */
  numbers: ReadonlyMap<string, number>
}) {
  const active = useMemo(() => inquiries.filter((q) => !dismissed.has(inquiryKey(q))), [inquiries, dismissed])
  const email = useMemo(() => inquiryEmail(active, allRows, numbers, text), [active, allRows, numbers, text])
  const byItem = useMemo(() => {
    const cases = active.flatMap((q) => (q.kind === "case" ? [{ label: CASE_TOPICS[q.topic].label, count: 1 }] : []))
    return [...cases, ...countsByItem(active)]
  }, [active])
  const rowLabel = useMemo(() => new Map(allRows.map((r) => [r.key, `${r.sheet}!${r.row + 1}`])), [allRows])
  const rowByKey = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows])

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${what}をコピーしました`)
    } catch (e) {
      toast.error(errorMessage(e, "コピーできませんでした。文面を選んでコピーしてください"))
    }
  }

  /** 件名・前置きは空にすると決まった文に戻す */
  const editMail = (key: "subject" | "intro", next: string) => onText((t) => ({ ...t, [key]: next.trim() || null }))

  return (
    <section className="mt-10 space-y-4" data-testid="inquiry-panel">
      <div>
        <p className="mt-0.5 text-xs text-muted-foreground">載せる行で、データに無い・推定に自信がない項目です。聞かなくてよいものはチェックを外します。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="inquiry-counts">
        <span className="font-semibold">問い合わせ {active.length} 件</span>
        {inquiries.length !== active.length && <span className="text-muted-foreground">（外した {inquiries.length - active.length} 件）</span>}
        {byItem.map(({ label, count }) => (
          <span key={label} className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
            {label} {count}件
          </span>
        ))}
      </div>

      {inquiries.length > 0 && (
        <details className="rounded-xl border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">問い合わせの一覧（{inquiries.length}件）</summary>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="w-full text-xs" data-testid="inquiry-list">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">聞く</th>
                  <th className="py-1 pr-2">元の行</th>
                  <th className="py-1 pr-2">項目</th>
                  <th className="py-1 pr-2">理由</th>
                  <th className="py-1">今の値</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((q) => {
                  const key = inquiryKey(q)
                  return (
                    <tr key={key} className="border-t" data-inquiry={key}>
                      <td className="py-1 pr-2">
                        <input type="checkbox" aria-label="問い合わせる" checked={!dismissed.has(key)} onChange={(e) => onToggle(key, e.target.checked)} />
                      </td>
                      <td className="num py-1 pr-2 text-muted-foreground">{q.kind === "cell" ? rowLabel.get(q.rowKey) : "案件全体"}</td>
                      <td className="py-1 pr-2">{q.kind === "cell" ? fieldLabel(q.field) : CASE_TOPICS[q.topic].label}</td>
                      <td className="py-1 pr-2">{q.kind === "cell" ? REASONS[q.reason].label : "不明"}</td>
                      <td className="py-1">{q.kind === "cell" ? rowByKey.get(q.rowKey)?.cells[q.field].value || "—" : ""}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {active.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm font-semibold">メール</p>
          {/* 空にすると決まった件名・前置きに戻る */}
          <DraftText label="件名" maxLength={MAX_SUBJECT_LENGTH} value={email.subject} onCommit={(v) => editMail("subject", v)} testId="inquiry-subject" />
          <DraftText multiline label="前置き" maxLength={MAX_INTRO_LENGTH} value={text.intro ?? DEFAULT_INTRO} onCommit={(v) => editMail("intro", v)} testId="inquiry-intro" />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void copy(email.subject, "件名")} data-testid="copy-subject">
              <Copy />
              件名をコピー
            </Button>
            <Button variant="outline" onClick={() => void copy(email.body, "本文")} disabled={busy} title={busy ? BUSY_TITLE : undefined} data-testid="copy-email">
              <Copy />
              本文をコピー
            </Button>
          </div>
          <Textarea readOnly className="h-64 font-mono text-xs" value={email.body} data-testid="inquiry-email" />
          <div className="flex flex-wrap items-center gap-2">
            {status !== "done" && (
              <Button variant="outline" onClick={onSent} disabled={busy || status === "inquiring"} title={busy ? BUSY_TITLE : undefined} data-testid="inquiry-sent">
                <Send />
                送った
              </Button>
            )}
            <span className="text-xs text-muted-foreground" data-testid="inquiry-sent-state">
              {status === "done" ? "案件は完了しています" : status === "inquiring" ? "問い合わせ中（返事待ち）" : "メールを送ったら押します（案件を問い合わせ中にします）"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="answer-note">
            顧客の答えは、メールの本文をチャットに貼るか、届いたファイルをチャットの📎で付けて「回答を読んで」と頼むと、顧客の回答の変更案になります。
          </p>
        </div>
      )}

    </section>
  )
}
