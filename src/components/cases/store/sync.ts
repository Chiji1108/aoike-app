import { createAutosave, type SaveRequest, type SaveResponse } from "@/lib/cases/autosave"
import type { CaseWork } from "@/lib/cases/state"
import { errorMessage } from "@/lib/errors"
import type { CaseStore } from "./create-case-store"

export type SyncOptions = {
  caseId: string
  save: (req: SaveRequest, signal: AbortSignal) => Promise<SaveResponse>
  /** 読んだときの版（まだ保存が無ければ 0） */
  version: number
  /** 読んだときの作業（まだ保存が無ければ null） */
  saved: CaseWork | null
  /** 保存する前に作業を保存の形にそろえる（ストアの作業は変えない） */
  prepare: (work: CaseWork) => CaseWork
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
 * 保存の層。つないでいる間、ストアの作業（work）の参照が変わったら自動保存（lib/cases/autosave.ts）に渡し、保存の状態をストアの sync に入れる
 * （保存しない状態〔runtime〕の変化では送らない）。別の画面が先に保存したら止めて再読み込みを頼む
 */
export function createCaseSync(store: CaseStore, options: SyncOptions) {
  const autosave = createAutosave({
    version: options.version,
    saved: options.saved,
    save: options.save,
    onStatus: (status) => store.setState((s) => ({ sync: { ...s.sync, status } })),
    errorMessage: (e) => errorMessage(e, "保存できませんでした"),
  })
  /** 自動保存に渡した最後の作業（つなぎ直したとき、外していた間の変更を渡す） */
  let forwarded = store.getState().work

  return {
    /** 画面につなぐ（自動保存・離れる前の警告）。返す関数で外す: 待っている変更をすぐに送り、そのあとの変更は受けない */
    connect() {
      autosave.reopen()
      const forward = (work: CaseWork) => {
        forwarded = work
        autosave.change(options.prepare(work))
      }
      // 作業が変わったときだけ送る（保存の状態・runtime の変化では送らない）。外していた間の変更も送る
      const unsubscribe = store.subscribe((s) => {
        if (s.work !== forwarded) forward(s.work)
      })
      if (store.getState().work !== forwarded) forward(store.getState().work)
      const warn = (e: BeforeUnloadEvent) => {
        if (autosave.unsaved()) e.preventDefault()
      }
      window.addEventListener("beforeunload", warn)
      return () => {
        unsubscribe()
        window.removeEventListener("beforeunload", warn)
        // 待っている変更を送る（失敗しても送り直さない）。同じ案件を開き直す画面は、保存し終えるかあきらめるまで待つ
        const settled = autosave.close().then((saved) => {
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
