import { z } from "zod"
import { createAutosave, type SaveRequest, type SaveResponse } from "@/lib/cases/autosave"
import type { CaseWork } from "@/lib/cases/state"
import { errorMessage } from "@/lib/errors"
import type { CaseStore, PeerState } from "./create-case-store"

/** 同じブラウザの別のタブとの知らせ（hello は開いた、here は hello への返事、saved は保存した、bye は閉じた） */
const peerMessageSchema = z.object({
  kind: z.enum(["hello", "here", "saved", "bye"]),
  tab: z.string().min(1).max(64),
})
type PeerMessage = z.infer<typeof peerMessageSchema>

/** 知らせ合う道（BroadcastChannel の使うところだけ。使えない環境では null） */
export type PeerChannel = {
  post: (m: PeerMessage) => void
  /** 届いた知らせを受け取る（中身は確かめていない。受け取る側が zod で確かめる） */
  listen: (receive: (data: unknown) => void) => void
  close: () => void
}

export type SyncOptions = {
  save: (req: SaveRequest) => Promise<SaveResponse>
  /** 読んだときの版（まだ保存が無ければ 0） */
  version: number
  /** 読んだときの作業（まだ保存が無ければ null） */
  saved: CaseWork | null
  /** 案件ごとの知らせ合う道を開く（使えない環境では null） */
  channel: () => PeerChannel | null
}

/** 案件ごとの知らせ合う道の名前 */
export const peerChannelName = (caseId: string) => `csv-case:${caseId}`

/** ブラウザの BroadcastChannel（使えない環境では null。今のまま、ぶつかってから再読み込み） */
export function broadcastChannel(caseId: string): () => PeerChannel | null {
  return () => {
    if (typeof BroadcastChannel === "undefined") return null
    const ch = new BroadcastChannel(peerChannelName(caseId))
    return {
      post: (m) => ch.postMessage(m),
      listen: (receive) => {
        ch.onmessage = (e: MessageEvent<unknown>) => receive(e.data)
      },
      close: () => ch.close(),
    }
  }
}

/**
 * 保存・同期の層。ストアの作業（work）の参照が変わったら自動保存（lib/cases/autosave.ts）に渡し、保存の状態をストアの sync に入れる
 * （保存しない状態〔runtime〕の変化では送らない）。別の画面が先に保存したら今と同じく止めて再読み込みを頼む。
 * そのうえで、同じブラウザの別のタブとは開いたとき・保存したとき・閉じたときに知らせ合い、ぶつかる前に見出しに出す（sync.peer）
 */
export function createCaseSync(store: CaseStore, options: SyncOptions) {
  const tab = crypto.randomUUID()
  let channel: PeerChannel | null = null
  /** 開いている別のタブ */
  const peers = new Set<string>()
  const setPeer = (peer: PeerState) => store.setState((s) => (s.sync.peer === peer ? s : { sync: { ...s.sync, peer } }))
  const post = (kind: PeerMessage["kind"]) => channel?.post({ kind, tab })

  const autosave = createAutosave({
    version: options.version,
    saved: options.saved,
    save: async (req) => {
      const res = await options.save(req)
      if (res.ok) post("saved")
      return res
    },
    onStatus: (status) => store.setState((s) => ({ sync: { ...s.sync, status } })),
    errorMessage: (e) => errorMessage(e, "保存できませんでした"),
  })
  // 作業が変わったときだけ送る（ストアを作ったときから。保存の状態・runtime の変化では送らない）
  store.subscribe((s, prev) => {
    if (s.work !== prev.work) autosave.change(s.work)
  })

  function receive(data: unknown) {
    const m = peerMessageSchema.safeParse(data)
    if (!m.success || m.data.tab === tab) return
    const { kind, tab: from } = m.data
    if (kind === "bye") {
      peers.delete(from)
      if (!peers.size && store.getState().sync.peer === "open") setPeer("none")
      return
    }
    peers.add(from)
    if (kind === "hello") post("here")
    // 別のタブが保存したら、この画面の作業は古い（再読み込みするまで saved のまま）
    if (kind === "saved") setPeer("saved")
    else if (store.getState().sync.peer === "none") setPeer("open")
  }

  return {
    /**
     * 画面につなぐ（離れる前の警告・別のタブとの道）。返す関数で外す（画面の中で別のページに移ったときは、待っている変更をすぐに送る）
     */
    connect() {
      const warn = (e: BeforeUnloadEvent) => {
        if (autosave.unsaved()) e.preventDefault()
      }
      // タブを閉じる（React の後片付けは走らない）・戻るで戻った（ページの控えから開き直した）ときも知らせる
      const hide = () => post("bye")
      const show = (e: PageTransitionEvent) => {
        if (e.persisted) post("hello")
      }
      window.addEventListener("beforeunload", warn)
      window.addEventListener("pagehide", hide)
      window.addEventListener("pageshow", show)
      channel = options.channel()
      channel?.listen(receive)
      post("hello")
      return () => {
        window.removeEventListener("beforeunload", warn)
        window.removeEventListener("pagehide", hide)
        window.removeEventListener("pageshow", show)
        autosave.flush()
        post("bye")
        channel?.close()
        channel = null
        peers.clear()
      }
    },
    /** 今の作業まで保存し終えるのを待つ（lib/cases/autosave.ts の settle。チャットの送る前・振り返り） */
    settle: () => autosave.settle(),
  }
}

export type CaseSync = ReturnType<typeof createCaseSync>
