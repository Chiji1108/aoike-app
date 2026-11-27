import { Download, FileText } from "lucide-react"
import { useCase, useCaseActions } from "@/components/cases/store/context"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { FILE_KIND_LABELS, downloadHistory, fileUrl } from "@/lib/cases/types"

const dayText = (ms: number) => new Date(ms).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })
const timeText = (ms: number) => new Date(ms).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })

/**
 * ダウンロードの履歴（見出しの「…」から開く）: この画面でダウンロードしたときに残した控え（CSV・最後の Excel・問い合わせの Excel）を新しい順に並べる。
 * 押すとそのときの中身をダウンロードする（今の表はダウンロードの前の確認から）。開くかは ui.dialogs.downloads
 */
export function DownloadsDialog() {
  const actions = useCaseActions()
  const open = useCase((s) => s.ui.dialogs.downloads)
  const files = useCase((s) => s.runtime.files)
  const history = downloadHistory(files)
  return (
    <Dialog open={open} onOpenChange={actions.setDownloadsOpen}>
      <DialogContent className="flex max-h-[min(36rem,calc(100dvh-2rem))] flex-col sm:max-w-lg" data-testid="downloads-dialog">
        <DialogHeader>
          <DialogTitle>ダウンロードの履歴</DialogTitle>
          <DialogDescription>ダウンロードしたときの中身の控えです。今の表とは違うことがあります（今の表は「ダウンロード」から）。</DialogDescription>
        </DialogHeader>
        {history.length ? (
          <ItemGroup className="-mx-1 min-h-0 gap-1.5 overflow-y-auto px-1 py-0.5" data-testid="download-history">
            {history.map((f) => (
              <div key={f.id} role="listitem">
                <Item size="sm" variant="outline" render={<a href={fileUrl(f.id)} download={f.name} />} data-kind={f.kind} data-file={f.name}>
                  <ItemMedia variant="icon">
                    <FileText className="text-muted-foreground" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="block w-full truncate">{f.name}</ItemTitle>
                    <ItemDescription>
                      {FILE_KIND_LABELS[f.kind]}・<span className="num">{dayText(f.createdAt)}</span> にダウンロードしたもの（<span className="num">{timeText(f.createdAt)}</span>）
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Download className="size-4 text-muted-foreground" aria-hidden />
                  </ItemActions>
                </Item>
              </div>
            ))}
          </ItemGroup>
        ) : (
          <p className="text-muted-foreground" data-testid="download-history-empty">
            まだダウンロードしていません
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
