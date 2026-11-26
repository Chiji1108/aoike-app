import { useEffect, useRef } from "react"
import { ChevronDown, FileUp, MessageSquare, Paperclip } from "lucide-react"
import { LazyMotion, MotionConfig } from "motion/react"
import * as m from "motion/react-m"
import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView } from "@/components/cases/store/context"
import type { ChatSize } from "@/components/cases/store/create-case-store"
import { Button } from "@/components/ui/button"
import { ATTACH_ACCEPT } from "@/lib/cases/types"
import type { ChatPlace } from "@/lib/cases/layout"
import { cn } from "@/lib/utils"
import { ChatColumn } from "./chat-column"
import { WorkPanel } from "./work-panel"

/** チャットの窓の決まった大きさ（px）。高さは画面に合わせて、これより低い画面では縮める（CSS の max-height） */
const CHAT_W = 420
const CHAT_H = 640
/** 大きさを変えるときの最小（px） */
const MIN_W = 320
const MIN_H = 280

/**
 * 案件の画面の並べ方（lib/cases/layout.ts の layoutOf を読んで置くだけ）: 見出し・作業の画面・チャットと、ドラッグしたファイルの受け口。
 * 作業の画面は表がある間ずっと置いたまま、閉じても隠すだけにする（表の検索・並べ替え・表示する列・工事場所の調査・置換の欄を消さない）。
 * 広い画面では作業の画面を横幅いっぱいに置き、チャットは右下の窓（たためる・大きさを変えられる）。狭い画面では作業の画面を上に重ねる。
 * チャットは置き場が変わっても同じ要素のまま（返事の途中・書きかけを消さない）。
 * 窓の大きさ・たたみは窓と作業の画面の枠だけが読む（中身のチャット・作業の画面は描き直さない）
 */
export function CaseLayout({ header }: { header: React.ReactNode }) {
  return (
    <LazyMotion features={loadMotion} strict>
      <MotionConfig reducedMotion="user">
        <Layout header={header} />
      </MotionConfig>
    </LazyMotion>
  )
}

/** 動きの機能（layout アニメーションを含む domMax）は画面を開いたあとに読む。読み終わるまでは動かさずに切り替える */
const loadMotion = () => import("./motion-features").then((r) => r.default)

/** 窓をたたんでいない間だけ「チャットはここにあります」を出す */
function ChatHintSlot() {
  const show = useCase((s) => s.ui.chat.hint && !s.ui.chat.collapsed)
  return show ? <ChatHint /> : null
}

function Layout({ header }: { header: React.ReactNode }) {
  const { workPlace, workShown, chat, covered } = useCaseView(
    useShallow((v) => ({ workPlace: v.layout.work?.place ?? null, workShown: v.layout.work?.shown ?? false, chat: v.layout.chat, covered: v.layout.covered })),
  )
  const dropFiles = useDropFiles()
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropFiles}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-6" inert={covered}>
        {header}
      </div>

      {/* 並べ方の欄（窓の大きさの上限・決まりの高さは、この欄の大きさ〔cqw・cqh〕から） */}
      <div className="relative flex min-h-0 flex-1 [container-type:size]">
        {workPlace && (
          <WorkFrame place={workPlace} shown={workShown} chat={chat}>
            <WorkPanel />
          </WorkFrame>
        )}
        <ChatFrame place={chat} covered={covered}>
          <ChatColumn />
        </ChatFrame>
        {chat === "window" && <ChatLauncher />}
        {chat === "window" && <ChatHintSlot />}
      </div>

      <DropOverlay />
    </div>
  )
}

/**
 * 作業の画面の枠。広い画面では横幅いっぱい、狭い画面では上に重ねる。
 * チャットの窓・右下のボタンが隠す分を CSS の変数で渡し、表と各タブはその分だけスクロールできる余白を足す
 * （各タブは --chat-cover-b だけ下に、表は --chat-cover-r だけ右と --chat-cover-table-b だけ下に。どのセル・項目も窓の外まで動かせる）
 */
function WorkFrame({ place, shown, chat, children }: { place: "inline" | "overlay"; shown: boolean; chat: ChatPlace; children: React.ReactNode }) {
  const actions = useCaseActions()
  const { collapsed, size } = useCase(useShallow((s) => ({ collapsed: s.ui.chat.collapsed, size: s.ui.chat.size })))
  // 窓は下から 5rem・右から 1rem（下はボタン）。表の枠は作業の画面の端から 1rem 内側で、スクロールバーの分（約 1rem）と少しの間を足す。
  // 表は右端の列を窓の左までスクロールできれば、どのセルも窓の外に出せる（下に余白を足すと、窓が高いと最後の行が見出しの下に入る）ので、窓を開いている間は右だけ
  const cover =
    chat !== "window"
      ? undefined
      : collapsed
        ? { "--chat-cover-b": "5.5rem", "--chat-cover-table-b": "5.5rem" }
        : { "--chat-cover-b": `${(size?.h ?? CHAT_H) + 104}px`, "--chat-cover-r": `${(size?.w ?? CHAT_W) + 40}px` }
  return (
    <div
      hidden={!shown}
      tabIndex={-1}
      className={cn("min-h-0 min-w-0 outline-none", place === "inline" ? "flex-1" : "fixed inset-0 z-50 bg-background shadow-xl")}
      style={cover as React.CSSProperties | undefined}
      {...(place === "inline" ? {} : { role: "dialog", "aria-modal": true, "aria-label": "作業の画面" })}
      onKeyDown={(e) => {
        // 重ねて開いたときの Escape で閉じる。中の欄が済ませた Escape（セルの手直しをやめるなど。preventDefault の印）と、
        // 画面の外に開いたメニューの Escape は見送る
        if (place !== "overlay" || e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return
        actions.setWorkShown(false)
      }}
      data-testid="work-frame"
    >
      {children}
    </div>
  )
}

/** 中央 ⇄ 窓・開く ⇄ たたむの動き（約0.3秒。「動きを減らす」の設定では動かさない〔MotionConfig〕） */
const CHAT_MOTION = { layout: { duration: 0.3, ease: [0.2, 0, 0, 1] as const }, opacity: { duration: 0.2 } }

/** 窓の高さ（px か、画面に合わせた決まりの高さ。cqh は並べ方の欄の高さ） */
const windowHeight = (size: ChatSize | null) => (size ? `${size.h}px` : `min(${CHAT_H}px, 100cqh - 6rem)`)

/**
 * チャットの枠。full は画面の中央に大きく、window は右下の窓（左上の角の取っ手で大きさを変える。Escape でたたむ）。
 * 置き場が変わっても、たたんでも、同じ要素のまま動かす（Motion の layout アニメーション。中のチャットは作り直さないので、会話・スクロールの位置・書きかけ・返事の途中が残る）。
 * たたむと枠は右下のボタンの大きさに縮み（中身は窓の大きさのまま右下に寄せて隠す。中のスクロールの位置を変えない）、触れなくする（inert）。
 * 動かすのは置き場とたたみが変わったときだけ（layoutDependency。大きさを変える間は動かさない）
 */
function ChatFrame({ place, covered, children }: { place: ChatPlace; covered: boolean; children: React.ReactNode }) {
  const actions = useCaseActions()
  const { collapsed, size } = useCase(useShallow((s) => ({ collapsed: s.ui.chat.collapsed, size: s.ui.chat.size })))
  const win = place === "window"
  const hidden = win && collapsed
  const moved = `${place}:${hidden}`
  const width = `min(${size?.w ?? CHAT_W}px, 100cqw - 2rem)`
  const height = `min(${windowHeight(size)}, 100cqh - 6rem)`
  return (
    <m.div
      layout
      layoutDependency={moved}
      initial={false}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={CHAT_MOTION}
      id="chat-window"
      className={cn(
        "min-h-0 min-w-0",
        win ? "absolute z-30 overflow-hidden border bg-background shadow-2xl outline-none" : "relative mx-auto w-full max-w-3xl xl:border-x",
        win && (hidden ? "pointer-events-none right-4 bottom-4" : "right-4 bottom-20"),
      )}
      style={win ? { width: hidden ? 48 : width, height: hidden ? 48 : height, borderRadius: hidden ? 24 : 12 } : { borderRadius: 0 }}
      inert={covered || hidden}
      tabIndex={win ? -1 : undefined}
      onKeyDown={(e) => {
        // 窓の Escape でたたむ。中の欄が済ませた Escape・変換中の入力・窓の外に開いたメニューの Escape は見送る。
        // 窓から開いたダイアログ（変更案の中身など）があれば、Escape はそのダイアログを閉じるもの（開いた直後でフォーカスがまだ窓にあっても）
        if (!win || e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing || !e.currentTarget.contains(e.target as Node) || dialogOpen()) return
        actions.setChatOpen(false)
      }}
      data-testid="chat-column"
      data-place={place}
      data-collapsed={hidden ? "1" : undefined}
    >
      {/* 中身は窓の大きさのまま（たたんでも縮めない）。枠の伸び縮みで歪まないよう、中身も layout で補う */}
      <m.div
        layout
        layoutDependency={moved}
        transition={CHAT_MOTION}
        className={win ? "absolute right-0 bottom-0" : "h-full w-full"}
        style={win ? { width, height } : undefined}
      >
        {win && !hidden && <ResizeHandle />}
        {children}
      </m.div>
    </m.div>
  )
}

/** 画面にダイアログが開いている（Escape はそのダイアログのもの） */
const dialogOpen = () => !!document.querySelector('[role="dialog"]:not([data-testid="work-frame"]), [role="alertdialog"]')

/** 大きさを変える1回の量（px。Shift で大きく） */
const RESIZE_STEP = 20

/**
 * 窓の大きさを変える取っ手（窓の左上の角。窓は右下に留めるので、左・上へ引くと大きくなる）。矢印キーでも変えられ（←↑で大きく、→↓で小さく。Shift で大きく）、
 * ダブルクリック・Home で決まった大きさに戻す。最小は MIN_W×MIN_H、最大は並べ方の欄から左と上に 1rem 残すまで。
 * 引いている間はストアの大きさだけを変え（窓と作業の画面の枠だけが描き直す）、離したときに端末に覚える
 */
function ResizeHandle() {
  const actions = useCaseActions()
  const drag = useRef<{ x: number; y: number; w: number; h: number; last: ChatSize } | null>(null)
  /** 今の窓の大きさと、変えられる範囲（並べ方の欄から） */
  const measure = (el: HTMLElement) => {
    const frame = el.closest<HTMLElement>("#chat-window")!
    const r = frame.getBoundingClientRect()
    const area = frame.parentElement!.getBoundingClientRect()
    // 窓は右から 1rem・下から 5rem。左と上に 1rem 残す
    const clamp = (s: ChatSize): ChatSize => ({
      w: Math.round(Math.max(MIN_W, Math.min(area.width - 32, s.w))),
      h: Math.round(Math.max(MIN_H, Math.min(area.height - 96, s.h))),
    })
    return { w: r.width, h: r.height, clamp }
  }
  return (
    <button
      type="button"
      className="absolute top-1 left-1 z-10 flex size-5 cursor-nwse-resize touch-none items-start justify-start rounded-md p-1 text-muted-foreground/60 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="チャットの窓の大きさ（矢印キーで変える。Home で元の大きさ）"
      title="引くと大きさを変えます（ダブルクリックで元の大きさ）"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const { w, h } = measure(e.currentTarget)
        drag.current = { x: e.clientX, y: e.clientY, w, h, last: { w, h } }
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.last = measure(e.currentTarget).clamp({ w: d.w - (e.clientX - d.x), h: d.h - (e.clientY - d.y) })
        actions.resizeChat(d.last, false)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d) actions.resizeChat(d.last, true)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onDoubleClick={() => actions.resizeChat(null, true)}
      onKeyDown={(e) => {
        if (e.key === "Home") {
          e.preventDefault()
          return actions.resizeChat(null, true)
        }
        const step = e.shiftKey ? RESIZE_STEP * 3 : RESIZE_STEP
        const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
        if (!delta) return
        e.preventDefault()
        const { w, h, clamp } = measure(e.currentTarget)
        actions.resizeChat(clamp({ w: w + delta[0]!, h: h + delta[1]! }), true)
      }}
      data-testid="chat-resize"
    >
      <span aria-hidden className="block size-2.5 rounded-tl-sm border-t-2 border-l-2 border-current" />
    </button>
  )
}

/**
 * 初めて窓にしたときに出す「チャットはここにあります（たためます）」。右下のボタンの左に出す（窓の上に出すと、高い窓では作業の画面の上の行〔次にやること〕に重なる）。
 * 下の欄を押せるよう、「わかった」のほかは押しても素通りする
 */
function ChatHint() {
  const actions = useCaseActions()
  return (
    <div
      role="status"
      className="pointer-events-none absolute right-20 bottom-6 z-30 flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-xs text-background shadow-lg"
      data-testid="chat-hint"
    >
      <span>チャットはここにあります（右のボタン・Esc でたためます）</span>
      <button type="button" className="pointer-events-auto rounded px-1 font-medium underline-offset-2 hover:underline" onClick={actions.dismissChatHint} data-testid="chat-hint-close">
        わかった
      </button>
    </div>
  )
}

/**
 * 右下の丸いボタン（チャットの窓を開く・たたむ）。たたんでいる間にチャットから届いたものがあれば印を付け（失敗した返事は赤）、
 * 📎を並べる（たたんでいてもアップロードできる。画面へのドラッグも同じ）
 */
function ChatLauncher() {
  const actions = useCaseActions()
  const { collapsed, unread } = useCase(useShallow((s) => ({ collapsed: s.ui.chat.collapsed, unread: s.ui.chat.unread })))
  const input = useRef<HTMLInputElement>(null)
  const unreadText = unread === "error" ? "チャットに失敗した返事があります" : unread ? "チャットに新しい返事があります" : ""
  return (
    <div className="absolute right-4 bottom-4 z-30 flex items-center gap-2">
      {collapsed && (
        <>
          <Button
            size="icon"
            variant="outline"
            className="size-10 rounded-full bg-background shadow-md"
            onClick={() => input.current?.click()}
            aria-label="ファイルをアップロード"
            title="ファイルをアップロード"
            data-testid="chat-launcher-attach"
          >
            <Paperclip />
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            data-testid="chat-launcher-file-input"
            onChange={(e) => {
              if (e.target.files?.length) void actions.attach([...e.target.files])
              e.target.value = ""
            }}
          />
        </>
      )}
      <Button
        className="relative size-12 rounded-full shadow-lg [&_svg:not([class*='size-'])]:size-5"
        aria-expanded={!collapsed}
        aria-controls="chat-window"
        aria-label={`${collapsed ? "チャットを開く" : "チャットをたたむ"}${unreadText ? `（${unreadText}）` : ""}`}
        title={collapsed ? "チャットを開く" : "チャットをたたむ（Esc）"}
        onClick={() => actions.setChatOpen(collapsed)}
        data-testid="chat-launcher"
        data-unread={unread ?? undefined}
      >
        {collapsed ? <MessageSquare /> : <ChevronDown />}
        {unread && <span className={cn("absolute -top-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-background", unread === "error" ? "bg-red-500" : "bg-violet-400")} data-testid="chat-unread" />}
      </Button>
      <span className="sr-only" aria-live="polite">
        {unreadText}
      </span>
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
