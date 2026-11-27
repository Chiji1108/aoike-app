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
  caseId: string
  save: (req: SaveRequest, signal: AbortSignal) => Promise<SaveResponse>
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
 * 画面を離れたあとも送っている最後の保存（案件ごと）。同じ案件の画面を開き直すときは、読む前にこれを待つ
 * （前の画面の最後の保存より古い版を読むと、新しい画面の保存がぶつかる）
 */
const leaving = new Map<string, Promise<boolean>>()

/**
 * 画面を離れた案件の、最後の保存が終わる（保存し終えたか、あきらめた）のを待つ（読み込みの前。送っていなければすぐ返る）。
 * 前の画面の変更を保存し終えたら true、保存できなかったら false（新しい画面で知らせる）。保存の要求には上限時間があるので必ず終わる
 */
export function savesSettled(caseId: string): Promise<boolean> {
  return leaving.get(caseId) ?? Promise.resolve(true)
}

/**
 * 保存・同期の層。つないでいる間、ストアの作業（work）の参照が変わったら自動保存（lib/cases/autosave.ts）に渡し、保存の状態をストアの sync に入れる
 * （保存しない状態〔runtime〕の変化では送らない）。別の画面が先に保存したら今と同じく止めて再読み込みを頼む。
 * そのうえで、同じブラウザの別のタブとは開いたとき・保存したとき・閉じたときに知らせ合い、ぶつかる前に見出しに出す（sync.peer）
 */
export function createCaseSync(store: CaseStore, options: SyncOptions) {
  /** 今つないでいる道と名乗る id（hello・here を送り、届いた知らせを読む） */
  let current: { ch: PeerChannel; tab: string } | null = null
  /**
   * 閉じていない道と、その道で名乗る id（つなぐたびに新しい id。外したあとも、最後の保存の saved を送ってから bye を送って閉じる。
   * つなぎ直した〔React の StrictMode・同じ画面に戻った〕ときの前の道の bye で、今の道を閉じたと数えさせない）
   */
  const open = new Map<PeerChannel, string>()
  /** この画面が名乗った id（前の道の遅れた知らせを、別のタブのものと数えない） */
  const mine = new Set<string>()
  /** 開いている別のタブ */
  const peers = new Set<string>()
  /** 閉じた（bye を送ってきた）タブ。そのあとに届いた知らせで足し直さない（開き直せば hello が来る） */
  const gone = new Set<string>()
  const setPeer = (peer: PeerState) => store.setState((s) => (s.sync.peer === peer ? s : { sync: { ...s.sync, peer } }))
  const message = (kind: PeerMessage["kind"], tab: string): PeerMessage => ({ kind, tab })

  const autosave = createAutosave({
    version: options.version,
    saved: options.saved,
    save: async (req, signal) => {
      const res = await options.save(req, signal)
      if (res.ok) for (const [ch, tab] of open) ch.post(message("saved", tab))
      return res
    },
    onStatus: (status) => store.setState((s) => ({ sync: { ...s.sync, status } })),
    errorMessage: (e) => errorMessage(e, "保存できませんでした"),
  })
  /** 自動保存に渡した最後の作業（つなぎ直したとき、外していた間の変更を渡す） */
  let forwarded = store.getState().work

  /** 知っている別のタブを忘れる（隠れる・外すとき）。開いている印は外す（別のタブの保存を知った印は、再読み込みするまで残す） */
  function forgetPeers() {
    peers.clear()
    gone.clear()
    if (store.getState().sync.peer === "open") setPeer("none")
  }

  function receive(data: unknown) {
    const m = peerMessageSchema.safeParse(data)
    if (!m.success || mine.has(m.data.tab)) return
    const { kind, tab: from } = m.data
    if (kind === "bye") {
      peers.delete(from)
      gone.add(from)
      if (!peers.size && store.getState().sync.peer === "open") setPeer("none")
      return
    }
    // 別のタブが保存したら、この画面の作業は古い（再読み込みするまで saved のまま）。閉じたタブの保存も受ける
    // （隠れるときは保存の終わりを待てない〔隠れたページは止まる〕ので、bye のあとに最後の保存の saved が届く）
    if (kind === "saved") {
      if (!gone.has(from)) peers.add(from)
      setPeer("saved")
      return
    }
    if (kind === "hello") gone.delete(from)
    else if (gone.has(from)) return
    peers.add(from)
    if (kind === "hello") current?.ch.post(message("here", current.tab))
    if (store.getState().sync.peer === "none") setPeer("open")
  }

  return {
    /**
     * 画面につなぐ（自動保存・離れる前の警告・別のタブとの道）。返す関数で外す: 待っている変更をすぐに送り、そのあとの変更は受けない。
     * 別のタブには、最後の保存が終わって saved を送ってから bye を送って道を閉じる
     */
    connect() {
      autosave.reopen()
      const forward = (work: CaseWork) => {
        forwarded = work
        autosave.change(work)
      }
      // 作業が変わったときだけ送る（保存の状態・runtime の変化では送らない）。外していた間の変更も送る
      const unsubscribe = store.subscribe((s) => {
        if (s.work !== forwarded) forward(s.work)
      })
      if (store.getState().work !== forwarded) forward(store.getState().work)
      const warn = (e: BeforeUnloadEvent) => {
        if (autosave.unsaved()) e.preventDefault()
      }
      const ch = options.channel()
      const tab = crypto.randomUUID()
      mine.add(tab)
      current = ch && { ch, tab }
      if (ch) {
        open.set(ch, tab)
        // 外したあとに届いた知らせは読まない（つなぎ直したときは新しい道で読む）
        ch.listen((data) => {
          if (current?.ch === ch) receive(data)
        })
      }
      // タブを閉じる（React の後片付けは走らない）ときは、すぐに知らせる。戻るで戻った（ページの控えから開き直した）ときは開き直す
      const hide = () => {
        ch?.post(message("bye", tab))
        forgetPeers()
      }
      const show = (e: PageTransitionEvent) => {
        if (e.persisted) ch?.post(message("hello", tab))
      }
      window.addEventListener("beforeunload", warn)
      window.addEventListener("pagehide", hide)
      window.addEventListener("pageshow", show)
      ch?.post(message("hello", tab))
      return () => {
        unsubscribe()
        window.removeEventListener("beforeunload", warn)
        window.removeEventListener("pagehide", hide)
        window.removeEventListener("pageshow", show)
        if (current?.ch === ch) current = null
        forgetPeers()
        // 待っている変更を送り（失敗しても送り直さない）、保存し終えるかあきらめてから、別のタブに bye を送って道を閉じる
        const settled = autosave.close().then((saved) => {
          ch?.post(message("bye", tab))
          ch?.close()
          if (ch) open.delete(ch)
          if (leaving.get(options.caseId) === settled) leaving.delete(options.caseId)
          return saved
        })
        leaving.set(options.caseId, settled)
      }
    },
    /** 今の作業まで保存し終えるのを待つ（lib/cases/autosave.ts の settle。チャットの送る前） */
    settle: () => autosave.settle(),
  }
}

export type CaseSync = ReturnType<typeof createCaseSync>
