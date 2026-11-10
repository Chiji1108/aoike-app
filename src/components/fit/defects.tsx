import { useState } from "react"
import { Check, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { FitDefect } from "@/db/fit-schema"
import { errorMessage } from "@/lib/errors"
import { formatDate, todayIso } from "@/lib/fit/procedure"
import { DEFECT_KIND_LABELS, DEFECT_PARTY_LABELS, type DefectKind, type DefectParty } from "@/lib/fit/types"
import { cn } from "@/lib/utils"
import { addDefectFn, deleteDefectFn, updateDefectFn } from "@/server/fit-fns"
import { DateField, SelectField, TextField, dateOrNull, optionsOf } from "./fields"

/**
 * 手続の不備・補正。済んでいないものは週次の案件表の「不備内容」に出る。申請後の補正が済んでいなければ状況が「補正中」になる
 */
export function Defects({ procedureId, defects, applied, onChanged }: { procedureId: string; defects: FitDefect[]; applied: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action()
      toast.success(done)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-2" data-testid="fit-defects">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">不備・補正</h4>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} data-testid="defect-add">
            <Plus />
            足す
          </Button>
        )}
      </div>
      {defects.length === 0 && !adding && <p className="text-xs text-muted-foreground">ありません</p>}
      <ul className="grid gap-1.5">
        {defects.map((d) => (
          <li key={d.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm", d.resolvedOn && "text-muted-foreground")} data-testid="defect-row">
            <span className="text-xs text-muted-foreground">{DEFECT_KIND_LABELS[d.kind]}</span>
            <span className={cn("min-w-0 flex-1 font-medium", d.resolvedOn && "line-through")}>{d.content}</span>
            {d.requestedTo && <span className="text-xs">{DEFECT_PARTY_LABELS[d.requestedTo]}に依頼</span>}
            {d.dueOn && !d.resolvedOn && <span className="text-xs num">期限 {formatDate(d.dueOn)}</span>}
            {d.resolvedOn ? (
              <span className="text-xs num">{formatDate(d.resolvedOn)} 解決</span>
            ) : (
              <Button variant="outline" size="sm" onClick={() => run(() => updateDefectFn({ data: { id: d.id, defect: { resolvedOn: todayIso() } } }), "解決にしました")} data-testid="defect-resolve">
                <Check />
                今日解決
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="消す" onClick={() => run(() => deleteDefectFn({ data: { id: d.id } }), "消しました")}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      {adding && (
        <DefectForm
          defaultKind={applied ? "after" : "before"}
          onCancel={() => setAdding(false)}
          onSubmit={async (defect) => {
            await run(() => addDefectFn({ data: { procedureId, defect } }), "不備を足しました")
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function DefectForm({
  defaultKind,
  onCancel,
  onSubmit,
}: {
  defaultKind: DefectKind
  onCancel: () => void
  onSubmit: (d: { kind: DefectKind; content: string; receivedOn: string | null; dueOn: string | null; requestedTo: DefectParty | null; resolvedOn: null }) => Promise<void>
}) {
  const [kind, setKind] = useState<DefectKind>(defaultKind)
  const [content, setContent] = useState("")
  const [receivedOn, setReceivedOn] = useState(todayIso())
  const [dueOn, setDueOn] = useState("")
  const [requestedTo, setRequestedTo] = useState<DefectParty | "">("")
  return (
    <form
      className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!content.trim()) return
        void onSubmit({ kind, content, receivedOn: dateOrNull(receivedOn), dueOn: dateOrNull(dueOn), requestedTo: requestedTo || null, resolvedOn: null })
      }}
    >
      <SelectField label="種類" value={kind} onChange={(v) => v && setKind(v)} options={optionsOf(DEFECT_KIND_LABELS)} />
      <TextField label="内容（案件表の「不備内容」）" value={content} onChange={setContent} className="sm:col-span-2" testId="defect-content" />
      <DateField label="連絡を受けた日" value={receivedOn} onChange={setReceivedOn} />
      <DateField label="期限" value={dueOn} onChange={setDueOn} hint={kind === "after" ? "補正の通知に書かれた日" : undefined} />
      <SelectField label="依頼した相手" value={requestedTo} onChange={setRequestedTo} options={optionsOf(DEFECT_PARTY_LABELS)} empty="—" />
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          やめる
        </Button>
        <Button type="submit" size="sm" disabled={!content.trim()} data-testid="defect-save">
          足す
        </Button>
      </div>
    </form>
  )
}
