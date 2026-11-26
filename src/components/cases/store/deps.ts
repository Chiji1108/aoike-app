import type { SaveRequest, SaveResponse } from "@/lib/cases/autosave"
import { fetchCaseFile, uploadCaseFile } from "@/lib/cases/files-client"
import type { CaseFile, CaseStatus, FileKind } from "@/lib/cases/types"
import type { ProposalRecord } from "@/lib/chat/proposals"
import { ADDRESS_API_PATH, lookupAddresses, type AddressLookup } from "@/lib/convert/address"
import { planWithAi, runAiBatch } from "@/server/ai"
import { saveCaseStateFn, updateCaseStatusFn } from "@/server/cases"
import { approveRuleFn, recordProposalFn } from "@/server/chat-fns"
import { approveLocationsFn } from "@/server/location-fns"

type DataOf<F extends (opts: { data: never }) => unknown> = Omit<Parameters<F>[0]["data"], "caseId">

/**
 * 案件の画面のストアが呼ぶ外の処理（サーバー関数・ファイル・住所データ）。案件の id はここで決めて渡すので、ストアの action は案件を知らない。
 * 単体テストでは偽物を渡す（サーバーの入力はサーバー関数が zod で確かめる）
 */
export type CaseDeps = {
  saveState: (req: SaveRequest) => Promise<SaveResponse>
  planWithAi: (req: DataOf<typeof planWithAi>) => ReturnType<typeof planWithAi>
  runAiBatch: (req: DataOf<typeof runAiBatch>) => ReturnType<typeof runAiBatch>
  recordProposal: (record: ProposalRecord) => Promise<unknown>
  approveRule: (proposalId: string, item: number) => Promise<unknown>
  approveLocations: (proposalId: string, items: number[]) => Promise<unknown>
  updateStatus: (status: CaseStatus) => Promise<unknown>
  uploadFile: (kind: FileKind, file: Blob, name: string) => Promise<CaseFile>
  fetchFile: (fileId: string) => Promise<Uint8Array>
  lookupAddresses: AddressLookup
}

/** 本物のサーバー関数を案件に結ぶ */
export function serverDeps(caseId: string): CaseDeps {
  return {
    saveState: (req) => saveCaseStateFn({ data: { caseId, ...req } }),
    planWithAi: (req) => planWithAi({ data: { caseId, ...req } }),
    runAiBatch: (req) => runAiBatch({ data: { caseId, ...req } }),
    recordProposal: (record) => recordProposalFn({ data: { caseId, record } }),
    approveRule: (proposalId, item) => approveRuleFn({ data: { caseId, proposalId, item } }),
    approveLocations: (proposalId, items) => approveLocationsFn({ data: { caseId, proposalId, items } }),
    updateStatus: (status) => updateCaseStatusFn({ data: { id: caseId, status } }),
    uploadFile: (kind, file, name) => uploadCaseFile(caseId, kind, file, name),
    fetchFile: fetchCaseFile,
    // 同梱の住所データを読んで住所を引く（lib/convert/address.ts）
    lookupAddresses: (raws) => lookupAddresses(raws, new URL(ADDRESS_API_PATH, window.location.origin).href),
  }
}
