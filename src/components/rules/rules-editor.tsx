import { useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { charCount, MAX_RULES_TOTAL, type Rules, type RuleTarget } from "@/lib/chat/rules"
import { errorMessage } from "@/lib/errors"
import { saveRulesFn } from "@/server/rules-fns"

/**
 * 全体ルール・顧客ルールの文章（1つの文章をそのまま直して保存する）。チャットの AI への指示にそのまま入る。
 * ほかの画面が先に保存していたら保存を断り、入力を残したまま今の文章を見せる（もう一度保存すると、今の文章を置き換える）
 */
export function RulesEditor({ target, initial, testId }: { target: RuleTarget; initial: Rules; testId: string }) {
  const [saved, setSaved] = useState(initial)
  const [loaded, setLoaded] = useState(initial)
  const [draft, setDraft] = useState(initial.text)
  /** ほかの画面で保存された今の文章（保存を断ったときだけ） */
  const [conflict, setConflict] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (initial !== loaded) {
    setLoaded(initial)
    setSaved(initial)
    setDraft(initial.text)
    setConflict(null)
  }
  const length = charCount(draft.trim())
  const changed = draft.trim() !== saved.text

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const r = await saveRulesFn({ data: { target, version: saved.version, text: draft } })
      setSaved(r.rules)
      if (r.ok) {
        setDraft(r.rules.text)
        setConflict(null)
        toast.success("ルールを保存しました")
      } else setConflict(r.rules.text)
    } catch (e) {
      toast.error(errorMessage(e, "ルールを保存できませんでした"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2" data-testid={testId}>
      <Textarea
        className="min-h-48 text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="1行に1つの決まりを書きます（例: - 工事名の「(仮称)」は取る）"
        aria-label="ルールの文章"
        data-testid="rules-input"
      />
      {conflict !== null && (
        <div className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs" data-testid="rules-conflict">
          <p className="text-destructive">ほかの画面でルールが保存されました。この入力で保存し直すと、次の文章を置き換えます。</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{conflict || "（空）"}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy || (!changed && conflict === null) || length > MAX_RULES_TOTAL} data-testid="rules-save">
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          保存
        </Button>
        <span className={length > MAX_RULES_TOTAL ? "text-xs text-destructive" : "text-xs text-muted-foreground"} data-testid="rules-length">
          {length.toLocaleString("ja-JP")} / {MAX_RULES_TOTAL.toLocaleString("ja-JP")} 字{changed && "（まだ保存していません）"}
        </span>
      </div>
    </div>
  )
}
