import { expect, test } from "vitest"
import { askKey, type PlanAsk } from "@/lib/convert/plan"
import { heuristicPlan } from "@/lib/convert/heuristic-plan"
import { KOJI_KEIREKI, KOJI_PLAN_HINTS } from "@/lib/spec/koji-keireki"
import { withAskKeys } from "../asks"
import { fromSaved, newWork, toSavedWork, type CaseWork } from "../state"
import type { UndoEntry } from "../undo"

const ASK_B: PlanAsk = { kind: "doubtful", text: "B列", column: 1, values: [] }
const ASK_C: PlanAsk = { kind: "unfinished", text: "C列", column: 2, values: ["未"] }

function work(): CaseWork {
  const plan = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, { name: "s", rows: [["工事名"]], hidden: [false] })
  return { ...newWork("f", "excluded"), plan: { plan: { ...plan, asks: [ASK_B, ASK_C] }, source: "ai" } }
}
const entry = (proposalId: string, answers: [string, string | null, string | null][]): UndoEntry => ({ id: proposalId, proposalId, kind: "approval", label: proposalId, at: 0, edits: [], manual: [], added: [], external: [], reportAnswers: answers })

test("前の形（並び順の id）の答えと取り消しの記録は、保存した計画のその順の聞き返しの鍵に読み替える", () => {
  const w: CaseWork = {
    ...work(),
    reportAnswers: { tax: "excluded", "plan-ask-1": "keep", "plan-ask-5": "exclude" },
    undo: [entry("report:plan-ask-1", [["plan-ask-1", null, "keep"]]), entry("report:tax", [["tax", null, "excluded"]])],
  }
  const read = fromSaved(toSavedWork(w), [])
  expect(read.reportAnswers).toEqual({ tax: "excluded", [askKey(ASK_C)]: "keep", "plan-ask-5": "exclude" })
  expect(read.undo.map((e) => [e.proposalId, e.label, e.reportAnswers])).toEqual([
    [`report:${askKey(ASK_C)}`, `report:${askKey(ASK_C)}`, [[askKey(ASK_C), null, "keep"]]],
    ["report:tax", "report:tax", [["tax", null, "excluded"]]],
  ])
})

test("鍵で持っている作業はそのまま（同じもの）", () => {
  const w: CaseWork = { ...work(), reportAnswers: { [askKey(ASK_B)]: "keep" } }
  expect(withAskKeys(w)).toBe(w)
})
