import type { AiCache } from "../convert/pipeline"
import { toSavedAiCache, toSavedWork, type CaseWork, type SavedAiCache, type SavedWork } from "./state"

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "pending" }
  /** 送れなかった。間を空けて送り直す */
  | { kind: "failed"; message: string }
  /** 大きすぎて保存できなかった。次の変更で送り直す */
  | { kind: "tooLarge" }
  /** 別の画面が先に保存した。上書きしないので、再読み込みしてもらう */
  | { kind: "conflict" }
  /** 案件が消された（削除の途中） */
  | { kind: "gone" }

export type SaveRequest = { version: number; work: SavedWork; aiCache?: SavedAiCache }
export type SaveResponse = { ok: true; version: number } | { ok: false; reason: "conflict" | "gone" | "tooLarge" }

export type AutosaveOptions = {
  /** 保存を送る。signal は1回の要求の上限時間（timeoutMs）で止まる（固まった要求を待ち続けない） */
  save: (req: SaveRequest, signal: AbortSignal) => Promise<SaveResponse>
  /** 読んだときの版（まだ保存が無ければ 0） */
  version: number
  /** 読んだときの作業（まだ保存が無ければ null。最初の保存で AI の結果も送る） */
  saved: CaseWork | null
  onStatus: (status: SaveStatus) => void
  errorMessage: (e: unknown) => string
  debounceMs?: number
  /** 失敗が続いた回数から、送り直すまでの間 */
  retryMs?: (failures: number) => number
  /** 1回の保存の要求の上限時間（超えたら失敗として扱う） */
  timeoutMs?: number
}

/** 1回の保存の要求の上限時間 */
export const SAVE_TIMEOUT_MS = 30_000

const retryBackoff = (failures: number) => Math.min(1000 * 2 ** (failures - 1), 30_000)

/**
 * 作業を変わるたびに（少し待ってまとめて）保存する。保存は1つずつ順に送り、送っている間の変更は次にまとめて送る。
 * AI の結果（大きい）は前に保存したものから変わったときだけ送る。
 * 送れなければ間を広げながら送り直し、大きすぎれば次の変更で送り直す。どちらも保存できるまで状態に出し続ける。
 * 別の画面が先に保存した・案件が消されたときは止める（上書きしない）
 */
export function createAutosave(options: AutosaveOptions) {
  const { save, onStatus, errorMessage, debounceMs = 800, retryMs = retryBackoff, timeoutMs = SAVE_TIMEOUT_MS } = options
  let version = options.version
  let savedWork = options.saved && JSON.stringify(toSavedWork(options.saved))
  let savedAiCache: AiCache | null = options.saved?.aiCache ?? null
  /** まだ保存できていない最新の作業 */
  let latest: CaseWork | null = null
  let sending = false
  let stopped = false
  let problem: SaveStatus | null = null
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 閉じた（画面を離れた）。新しい変更は受けず、失敗しても送り直さない */
  let closed = false

  const schedule = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(flush, ms)
  }
  /** settle を待っている呼び出し（保存し終えたら true、保存できなかったら false で返す） */
  let waiters: ((saved: boolean) => void)[] = []
  const report = (status: SaveStatus) => {
    problem = status.kind === "saved" || status.kind === "pending" ? null : status
    onStatus(status)
    if (status.kind === "pending" || !waiters.length) return
    const done = waiters
    waiters = []
    for (const w of done) w(status.kind === "saved")
  }

  async function flush() {
    clearTimeout(timer)
    if (sending || stopped || !latest) return
    const work = latest
    const workJson = JSON.stringify(toSavedWork(work))
    const aiChanged = work.aiCache !== savedAiCache
    if (workJson === savedWork && !aiChanged) {
      latest = null
      report({ kind: "saved" })
      return
    }
    sending = true
    let res: SaveResponse
    try {
      res = await save({ version, work: toSavedWork(work), aiCache: aiChanged ? toSavedAiCache(work.aiCache) : undefined }, AbortSignal.timeout(timeoutMs))
    } catch (e) {
      failures++
      report({ kind: "failed", message: errorMessage(e) })
      if (!closed) schedule(retryMs(failures))
      return
    } finally {
      sending = false
    }
    if (!res.ok) {
      stopped = res.reason !== "tooLarge"
      report({ kind: res.reason })
      return
    }
    failures = 0
    version = res.version
    savedWork = workJson
    savedAiCache = work.aiCache
    if (latest === work) {
      latest = null
      report({ kind: "saved" })
    } else void flush()
  }

  /**
   * 待たずに送り、今の変更まで保存し終えるのを待つ。保存し終えたら true、送れない・止まっている（別の画面・削除・大きすぎる）なら false
   * （サーバーが保存した作業を読む処理の前に使う。例: チャットの送る前）
   */
  function settle(): Promise<boolean> {
    if (stopped) return Promise.resolve(false)
    if (latest === null && !sending) return Promise.resolve(problem === null)
    const waiting = new Promise<boolean>((resolve) => waiters.push(resolve))
    void flush()
    return waiting
  }

  return {
    change(work: CaseWork) {
      if (stopped || closed) return
      latest = work
      if (!problem) report({ kind: "pending" })
      // 送れなかった後は、送り直しの間を待つ（変更のたびに送り直さない）
      if (problem?.kind !== "failed") schedule(debounceMs)
    },
    /**
     * 閉じる（画面を離れるとき）: 新しい変更は受けず、待っている変更を待たずに送り、失敗しても送り直さない（最後の1回だけ試す）。
     * 送っている最中なら、その結果（と続きの1回）を待つ。保存し終えたら true、保存できなかった（あきらめた・止まっている）なら false
     */
    close(): Promise<boolean> {
      closed = true
      clearTimeout(timer)
      return settle()
    },
    /** 閉じたのを開き直す（すぐにつなぎ直したとき）。保存できていない変更があれば送り直す */
    reopen() {
      if (!closed) return
      closed = false
      if (latest && !sending && !stopped) schedule(debounceMs)
    },
    /** 保存できていない変更があるか */
    unsaved: () => !stopped && (latest !== null || sending),
    settle,
  }
}
