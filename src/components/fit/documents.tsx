import { useRef, useState } from "react"
import { CheckCircle2, Circle, Download, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { errorMessage } from "@/lib/errors"
import { DOC_TYPES, DOC_TYPE_LABELS, MAX_DOC_BYTES, fileUrl, requiredDocs, type DocType } from "@/lib/fit/documents"
import { formatDate } from "@/lib/fit/procedure"
import type { ProcedureKind } from "@/lib/fit/types"
import { todayIso } from "@/lib/period"
import { cn } from "@/lib/utils"
import type { FileView } from "@/server/fit-store"

/** 手続に書類を置く（/api/fit/procedures/<id>/files。種類と名前はヘッダーで送る） */
async function uploadDoc(procedureId: string, docType: DocType, file: File) {
  if (file.size > MAX_DOC_BYTES) throw new Error("ファイルは 100MB までです")
  const res = await fetch(`/api/fit/procedures/${procedureId}/files`, {
    method: "POST",
    headers: { "x-doc-type": docType, "x-file-name": encodeURIComponent(file.name) },
    body: file,
  })
  if (!res.ok) throw new Error((await res.text()) || "書類を置けませんでした")
}

const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`)
const dateOf = (ms: number) => formatDate(todayIso(new Date(ms)))

/**
 * 手続の書類：申請に要る書類が届いたか（置くと「届いた」）と、置いた書類の版・ダウンロードの記録。
 * 同じ種類を置き直すと新しい版になり、前の版も残る
 */
export function Documents({ procedureId, kind, sharedOwnership, files, onChanged }: { procedureId: string; kind: ProcedureKind; sharedOwnership: boolean; files: FileView[]; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<DocType>("other")
  const [uploading, setUploading] = useState(false)
  // 押したダウンロードを、読み直さずに回数と最後の日へ足す（記録はサーバーがダウンロードのときに残す）
  const [clicked, setClicked] = useState<Record<string, { n: number; at: number }>>({})
  const required = requiredDocs(kind, sharedOwnership)
  const has = new Set(files.map((f) => f.docType))
  const byType = DOC_TYPES.map((t) => [t, files.filter((f) => f.docType === t)] as const).filter(([, fs]) => fs.length > 0)

  function pick(t: DocType) {
    setDocType(t)
    input.current?.click()
  }

  async function onFiles(list: FileList | null) {
    const chosen = [...(list ?? [])]
    if (input.current) input.current.value = ""
    if (chosen.length === 0) return
    setUploading(true)
    try {
      for (const f of chosen) await uploadDoc(procedureId, docType, f)
      toast.success(`${DOC_TYPE_LABELS[docType]}を置きました`)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid gap-3" data-testid="fit-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">書類</h4>
        <div className="flex items-center gap-2">
          <NativeSelect aria-label="置く書類の種類" value={docType} onChange={(e) => setDocType(e.target.value as DocType)} className="w-44 [&_select]:h-8" data-testid="doc-type">
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading} data-testid="doc-upload">
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            置く
          </Button>
          <input ref={input} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} data-testid="doc-input" />
        </div>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="申請に要る書類" data-testid="doc-checklist">
        {required.map((t) => (
          <li key={t}>
            <button
              type="button"
              onClick={() => pick(t)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                has.has(t) ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "text-muted-foreground hover:bg-muted",
              )}
              title={has.has(t) ? "届いた（押すと新しい版を置く）" : "まだ届いていない（押すと置く）"}
              data-testid="doc-check"
              data-done={has.has(t) ? "1" : "0"}
            >
              {has.has(t) ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
              {DOC_TYPE_LABELS[t]}
            </button>
          </li>
        ))}
      </ul>

      {byType.length > 0 && (
        <ul className="grid gap-1 text-sm" data-testid="doc-files">
          {byType.flatMap(([t, fs]) =>
            fs.map((f, i) => (
              <li key={f.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5", i === 0 ? "bg-muted/40" : "text-muted-foreground")} data-testid="doc-file">
                <span className="w-36 text-xs">
                  {DOC_TYPE_LABELS[t]}
                  {fs.length > 1 && <span className="ml-1 num">第{f.version}版</span>}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs num">
                  {sizeText(f.size)}・{dateOf(f.createdAt)}
                </span>
                <DownloadCount downloads={f.downloads + (clicked[f.id]?.n ?? 0)} last={clicked[f.id]?.at ?? f.lastDownloadAt} />
                {f.purgedAt ? (
                  <span className="text-xs">保存期間が過ぎて消した</span>
                ) : (
                  <Button render={<a href={fileUrl(f.id)} download />} nativeButton={false} variant="ghost" size="icon-sm" aria-label={`${f.name} をダウンロード`} onClick={() => setClicked((c) => ({ ...c, [f.id]: { n: (c[f.id]?.n ?? 0) + 1, at: Date.now() } }))}>
                    <Download />
                  </Button>
                )}
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  )
}

function DownloadCount({ downloads, last }: { downloads: number; last: number | null }) {
  return (
    <span className="text-xs num" data-testid="doc-downloads">
      {downloads > 0 && last != null ? `${downloads}回ダウンロード（最後 ${dateOf(last)}）` : "未ダウンロード"}
    </span>
  )
}
