import { useEffect } from "react"
import { FileUp } from "lucide-react"
import { useCase, useCaseActions, useCaseView } from "@/components/cases/store/context"
import { cn } from "@/lib/utils"
import { ChatColumn } from "./chat-column"
import { WorkPanel } from "./work-panel"

/**
 * 案件の画面の並べ方（lib/cases/layout.ts の layoutOf を読んで置くだけ）: 見出し・チャットの欄・作業の画面と、ドラッグしたファイルの受け口。
 * 作業の画面は表がある間ずっと置いたまま、閉じても隠すだけにする（表の検索・並べ替え・表示する列・工事場所の調査・置換の欄を消さない）。
 * 広い画面ではチャットの右、狭い画面では画面の上に重ねる。幅が変わっても同じ要素のまま
 */
export function CaseLayout({ header }: { header: React.ReactNode }) {
  const layout = useCaseView((v) => v.layout)
  const actions = useCaseActions()
  const dropFiles = useDropFiles()
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropFiles}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-6" inert={layout.covered}>
        {header}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 min-w-0", layout.chat === "column" ? "w-[400px] shrink-0 border-r 2xl:w-[440px]" : "mx-auto w-full max-w-3xl xl:border-x")} inert={layout.covered} data-testid="chat-column">
          <ChatColumn />
        </div>
        {layout.work && (
          <div
            hidden={!layout.work.shown}
            tabIndex={-1}
            className={cn("min-h-0 min-w-0 outline-none", layout.work.place === "side" ? "flex-1" : "fixed inset-0 z-50 bg-background shadow-xl")}
            {...(layout.work.place === "side" ? {} : { role: "dialog", "aria-modal": true, "aria-label": "作業の画面" })}
            onKeyDown={(e) => {
              // 重ねて開いたときの Escape で閉じる。中の欄が済ませた Escape（セルの手直しをやめるなど。preventDefault の印）と、
              // 画面の外に開いたメニューの Escape は見送る
              if (layout.work?.place !== "overlay" || e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return
              actions.setWorkShown(false)
            }}
            data-testid="work-frame"
          >
            <WorkPanel />
          </div>
        )}
      </div>

      <DropOverlay />
    </div>
  )
}

/** ドラッグしている間の印。印は、離した・ドラッグをやめた・窓の外へ出たときに必ず消す */
function DropOverlay() {
  const actions = useCaseActions()
  const dragging = useCase((s) => s.ui.dragging)
  useEffect(() => {
    if (!dragging) return
    const stop = () => actions.setDragging(false)
    const leaveWindow = (e: DragEvent) => {
      if (!e.relatedTarget) stop()
    }
    window.addEventListener("drop", stop)
    window.addEventListener("dragend", stop)
    window.addEventListener("dragleave", leaveWindow)
    return () => {
      window.removeEventListener("drop", stop)
      window.removeEventListener("dragend", stop)
      window.removeEventListener("dragleave", leaveWindow)
    }
  }, [dragging, actions])
  if (!dragging) return null
  return (
    <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-violet-400 bg-violet-50/70 text-sm font-medium text-violet-800 dark:bg-violet-950/60 dark:text-violet-200" data-testid="drop-overlay">
      <FileUp className="mr-2 size-5" /> 離すとアップロードします
    </div>
  )
}

const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files")

/**
 * 画面のどこにドラッグしたファイルも、📎と同じくアップロードする（重ねて開いた作業の画面も同じ要素の中）。
 * 画面の外へ出た（relatedTarget が画面の中でない）ら印を消す
 */
function useDropFiles() {
  const actions = useCaseActions()
  return {
    onDragEnter: (e: React.DragEvent) => {
      if (hasFiles(e)) actions.setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) actions.setDragging(false)
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      actions.setDragging(false)
      if (e.dataTransfer.files.length) void actions.attach([...e.dataTransfer.files])
    },
  }
}
