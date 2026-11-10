import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FIT_NAME } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { DOC_TYPE_LABELS, retentionUntil } from "@/lib/fit/documents"
import { bookNumber, formatDate } from "@/lib/fit/procedure"
import { purgeFilesFn, purgeableFilesFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/retention")({
  loader: () => purgeableFilesFn(),
  head: () => ({ meta: [{ title: `書類の保存期間 | ${FIT_NAME}` }] }),
  component: RetentionPage,
})

/** 保存期間が過ぎた書類：一覧で確かめてから消す（個人情報を必要以上に持ち続けない）。消しても、置いた・消した記録は残る */
function RetentionPage() {
  const { retentionYears, rows } = Route.useLoaderData()
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const allSelected = rows.length > 0 && selected.size === rows.length

  async function purge() {
    setBusy(true)
    try {
      const n = await purgeFilesFn({ data: { ids: [...selected] } })
      toast.success(`${n}件の書類を消しました`)
      setSelected(new Set())
      await router.invalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <AppShell tool={FIT}>
      <PageHeader
        title="書類の保存期間"
        description={`終わった手続（入金済み・取下げ・中止）の書類で、帳簿を閉じた年末から${retentionYears}年たったもの。消す前に確かめてください（期間は設定で変えられます）。`}
        actions={
          <Button variant="destructive" size="lg" className="h-10 px-4" disabled={selected.size === 0 || busy} onClick={() => setConfirming(true)} data-testid="retention-purge">
            <Trash2 />
            選んだ書類を消す（{selected.size}）
          </Button>
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">保存期間が過ぎた書類はありません。</p>
      ) : (
        <div className="overflow-auto rounded-xl border bg-card">
          <table className="w-full text-sm" data-testid="retention-table">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox aria-label="すべて選ぶ" checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.file.id)) : new Set())} />
                </th>
                <th className="px-2 py-2 text-left font-medium">事件簿番号</th>
                <th className="px-2 py-2 text-left font-medium">お客様</th>
                <th className="px-2 py-2 text-left font-medium">書類</th>
                <th className="px-2 py-2 text-left font-medium">ファイル</th>
                <th className="px-2 py-2 text-left font-medium">保存の期限</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.file.id} className="border-t">
                  <td className="px-3 py-1.5">
                    <Checkbox
                      aria-label={`${r.file.name} を選ぶ`}
                      checked={selected.has(r.file.id)}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const next = new Set(s)
                          if (v === true) next.add(r.file.id)
                          else next.delete(r.file.id)
                          return next
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 num">
                    <Link to="/fit/cases/$caseId" params={{ caseId: r.caseId }} className="text-brand hover:underline">
                      {bookNumber(r.bookYear, r.seq)}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5">
                    {DOC_TYPE_LABELS[r.file.docType]}
                    <span className="ml-1 text-xs text-muted-foreground num">第{r.file.version}版</span>
                  </td>
                  <td className="px-2 py-1.5">{r.file.name}</td>
                  <td className="px-2 py-1.5 num">{formatDate(retentionUntil(r.bookYear, retentionYears))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selected.size}件の書類を消しますか？</AlertDialogTitle>
            <AlertDialogDescription>書類のファイルは元に戻せません。置いた・消した記録は手続に残ります。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={purge} disabled={busy} data-testid="retention-confirm">
              {busy && <Loader2 className="animate-spin" />}
              消す
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
