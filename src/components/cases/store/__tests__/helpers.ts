import type { CaseFile } from "@/lib/cases/types"
import { fixture } from "@/lib/convert/__tests__/helpers"
import type { CaseDeps } from "../deps"
import type { SessionPage } from "../env"

/** 案件の画面の1回分の単体テストの材料（合成のサンプルだけ。実データは使わない） */

export const file = (id: string): CaseFile => ({ id, caseId: "c", kind: "source", name: "sample-messy.xlsx", contentType: "application/octet-stream", size: 1, createdAt: 0 })
export const FILES = [file("f1"), file("f2")]
export const NO_AI = { ok: false as const, reason: "error" as const, message: "偽の AI は使えません", usd: 0 }

export function page(): SessionPage {
  return {
    kase: { id: "c", status: "converting", costUsd: 0 },
    customer: { name: "サンプル" },
    files: FILES,
    state: null,
    proposals: [],
    unreadableProposals: [],
    closedMissing: 0,
    settings: { rule7Tax: "excluded" },
    chatEnabled: true,
    previousUnsaved: false,
    previous: null,
  }
}

/** 偽の外の処理（ファイルはどれも合成のサンプル。AI は使えない。住所は空の結果） */
export function fakeDeps(over: Partial<CaseDeps> = {}): CaseDeps {
  return {
    saveState: async (req) => ({ ok: true, version: req.version + 1 }),
    planWithAi: async () => NO_AI,
    runAiBatch: async () => NO_AI,
    recordProposal: async () => undefined,
    approveRule: async () => undefined,
    approveLocations: async () => undefined,
    updateStatus: async () => undefined,
    uploadFile: async (kind, _f, name) => ({ ...file(crypto.randomUUID()), kind, name }),
    fetchFile: async () => fixture("sample-messy.xlsx"),
    lookupAddresses: async () => new Map(),
    chatPrefs: { load: () => null, save: () => undefined },
    ...over,
  }
}

