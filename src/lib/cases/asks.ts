import { askKey } from "@/lib/convert/plan"
import type { CaseWork } from "./state"

/** 前の形の、計画の聞き返しの並び順の id（答え・取り消しの単位に使っていた） */
const LEGACY_ASK = /^plan-ask-(\d+)$/
const REPORT = "report:"

/**
 * 保存済みの前の形の作業を読む: 計画の聞き返しの答え（reportAnswers）と取り消しの記録（単位の名前・答えの前後）が並び順の id（plan-ask-0 など）なら、
 * 保存した計画のその順の聞き返しの鍵（askKey）に読み替える（前の形はその計画の並びで答えていた）。計画にもう無い順のものはそのまま残す（どの聞き返しにも当たらない）
 */
export function withAskKeys(w: CaseWork): CaseWork {
  const asks = w.plan?.plan.asks ?? []
  const rename = (k: string) => {
    const m = LEGACY_ASK.exec(k)
    const a = m ? asks[Number(m[1])] : undefined
    return a ? askKey(a) : k
  }
  const renameGroup = (g: string) => (g.startsWith(REPORT) ? REPORT + rename(g.slice(REPORT.length)) : g)
  const legacy =
    Object.keys(w.reportAnswers).some((k) => LEGACY_ASK.test(k)) ||
    w.undo.some((e) => (e.proposalId.startsWith(REPORT) && LEGACY_ASK.test(e.proposalId.slice(REPORT.length))) || e.reportAnswers?.some(([k]) => LEGACY_ASK.test(k)))
  if (!legacy) return w
  return {
    ...w,
    reportAnswers: Object.fromEntries(Object.entries(w.reportAnswers).map(([k, v]) => [rename(k), v])),
    undo: w.undo.map((e) => ({
      ...e,
      proposalId: renameGroup(e.proposalId),
      label: renameGroup(e.label),
      ...(e.reportAnswers ? { reportAnswers: e.reportAnswers.map(([k, b, a]): [string, string | null, string | null] => [rename(k), b, a]) } : {}),
    })),
  }
}
