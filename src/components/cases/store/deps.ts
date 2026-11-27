import type { SaveRequest, SaveResponse } from "@/lib/cases/autosave"
import { fetchCaseFile, uploadCaseFile } from "@/lib/cases/files-client"
import type { CaseFile, CaseStatus, FileKind } from "@/lib/cases/types"
import type { ProposalRecord } from "@/lib/chat/proposals"
import { ADDRESS_API_PATH, lookupAddresses, type AddressLookup } from "@/lib/convert/address"
import { planWithAi, runAiBatch } from "@/server/ai"
import { saveCaseStateFn, updateCaseStatusFn } from "@/server/cases"
import { approveRuleFn, recordProposalFn } from "@/server/chat-fns"
import type { ChatPrefs } from "./create-case-store"

type DataOf<F extends (opts: { data: never }) => unknown> = Omit<Parameters<F>[0]["data"], "caseId">

/**
 * 案件の画面のストアが呼ぶ外の処理（サーバー関数・ファイル・住所データ）。案件の id はここで決めて渡すので、ストアの action は案件を知らない。
 * 単体テストでは偽物を渡す（サーバーの入力はサーバー関数が zod で確かめる）
 */
export type CaseDeps = {
  /** 作業を保存する（signal は自動保存が決める1回の要求の上限時間） */
  saveState: (req: SaveRequest, signal: AbortSignal) => Promise<SaveResponse>
  planWithAi: (req: DataOf<typeof planWithAi>) => ReturnType<typeof planWithAi>
  runAiBatch: (req: DataOf<typeof runAiBatch>) => ReturnType<typeof runAiBatch>
  recordProposal: (record: ProposalRecord) => Promise<unknown>
  approveRule: (proposalId: string, item: number) => Promise<unknown>
  updateStatus: (status: CaseStatus) => Promise<unknown>
  uploadFile: (kind: FileKind, file: Blob, name: string) => Promise<CaseFile>
  fetchFile: (fileId: string) => Promise<Uint8Array>
  lookupAddresses: AddressLookup
  /** 端末ごとに覚えるチャットの窓の設定（読めない・書けない端末では無いものとして動く） */
  chatPrefs: { load: () => ChatPrefs | null; save: (p: ChatPrefs) => void }
}

/** 本物のサーバー関数を案件に結ぶ */
export function serverDeps(caseId: string): CaseDeps {
  return {
    saveState: (req, signal) => saveCaseStateFn({ data: { caseId, ...req }, signal }),
    planWithAi: (req) => planWithAi({ data: { caseId, ...req } }),
    runAiBatch: (req) => runAiBatch({ data: { caseId, ...req } }),
    recordProposal: (record) => recordProposalFn({ data: { caseId, record } }),
    approveRule: (proposalId, item) => approveRuleFn({ data: { caseId, proposalId, item } }),
    updateStatus: (status) => updateCaseStatusFn({ data: { id: caseId, status } }),
    uploadFile: (kind, file, name) => uploadCaseFile(caseId, kind, file, name),
    fetchFile: fetchCaseFile,
    // 同梱の住所データを読んで住所を引く（lib/convert/address.ts）
    lookupAddresses: (raws) => lookupAddresses(raws, new URL(ADDRESS_API_PATH, window.location.origin).href),
    chatPrefs: localChatPrefs,
  }
}

const CHAT_PREFS_KEY = "csv.chatWindow"

/**
 * チャットの窓の設定を localStorage に覚える（案件によらず端末ごと）。サーバーで描くとき・使えない端末（プライベートブラウズなど）は覚えない。
 * 読んだ値は形を確かめ、違えば無いものとする
 */
export const localChatPrefs: CaseDeps["chatPrefs"] = {
  load() {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(CHAT_PREFS_KEY) ?? "null")
      if (!v || typeof v !== "object") return null
      const { collapsed, size } = v as Record<string, unknown>
      const s = size as Record<string, unknown> | null
      const okSize = s && typeof s === "object" && typeof s.w === "number" && typeof s.h === "number" && s.w > 0 && s.h > 0
      return { collapsed: collapsed === true, size: okSize ? { w: s.w as number, h: s.h as number } : null, hintShown: (v as Record<string, unknown>).hintShown === true }
    } catch {
      return null
    }
  },
  save(p) {
    try {
      localStorage.setItem(CHAT_PREFS_KEY, JSON.stringify(p))
    } catch {
      /* 覚えられない端末では、この画面の間だけ */
    }
  },
}
