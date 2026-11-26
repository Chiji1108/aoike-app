import { describe, expect, test } from "vitest"
import { applyChanges, type ChatChange } from "../../chat/proposals"
import { editKey, type CellEdit } from "../../convert/convert"
import { fromSaved, newWork, type SavedPlan, savedWorkSchema, toSavedWork, toSavedAiCache, type CaseWork } from "../state"
import { applyInquiryChange, EMPTY_INQUIRY_TEXT } from "../../inquiry/text"
import { canUndo, GYOSHU_UNDO, kindOf, pushUndo, RANGE_UNDO, SELECTION_UNDO, undo, undoEntry, undoEntrySchema, UNDO_LIMITS, type UndoKind } from "../undo"

const chat = (value: string): CellEdit => ({ value, by: "chat" })
const staff = (value: string): CellEdit => ({ value, by: "staff" })

/** 変更を承認したときと同じく、作業に重ねて取り消しの記録を足す */
function approve(w: CaseWork, proposalId: string, changes: ChatChange[]): CaseWork {
  const next = applyChanges(w, [], changes)
  const entry = undoEntry(w, next, { id: `u-${proposalId}`, proposalId, kind: "approval", label: proposalId, at: 0 })
  return entry ? { ...next, undo: pushUndo(next.undo, entry) } : next
}

/** 保存して読み直す（開き直したとき） */
const reopen = (w: CaseWork) => fromSaved(savedWorkSchema.parse(JSON.parse(JSON.stringify(toSavedWork(w)))), toSavedAiCache(w.aiCache))

describe("承認の取り消し", () => {
  const base = { ...newWork("f"), edits: new Map([[editKey("r1", "client"), staff("元の手直し")]]) }

  test("承認で変わった手直し・入れ外し・設定・足した行を前に戻す。開き直しても取り消せる", () => {
    const w = approve(base, "p1", [
      { kind: "cell", rowKey: "r1", field: "client", edit: chat("㈱青池") },
      { kind: "cell", rowKey: "r2", field: "workName", edit: chat("新築工事") },
      { kind: "include", rowKey: "r3", include: false },
      { kind: "settings", tax: "included", selection: "all" },
      { kind: "add", rowKey: "add-1", by: "chat", cells: { workName: chat("足した工事") } },
    ])
    expect(w.undo).toHaveLength(1)
    const r = undo(reopen(w), w.undo[0]!.id)!
    expect(r.kept).toBe(0)
    expect(r.work.edits.get(editKey("r1", "client"))).toEqual(staff("元の手直し"))
    expect(r.work.edits.has(editKey("r2", "workName"))).toBe(false)
    expect(r.work.edits.has(editKey("add-1", "workName"))).toBe(false)
    expect(r.work.manual.has("r3")).toBe(false)
    expect(r.work.tax).toBe("unknown")
    expect(r.work.selection).toBe("rule7")
    expect(r.work.added).toEqual([])
    expect(r.work.undo[0]!.undone).toBe(true)
    // 2回は取り消さない
    expect(undo(r.work, w.undo[0]!.id)).toBeNull()
  })

  test("承認のあとに変えた値は戻さずに数える。ほかの値は戻す（直前でない承認も取り消せる）", () => {
    let w = approve(base, "p1", [
      { kind: "cell", rowKey: "r1", field: "client", edit: chat("㈱青池") },
      { kind: "cell", rowKey: "r2", field: "client", edit: chat("㈲青池") },
    ])
    w = approve(w, "p2", [{ kind: "cell", rowKey: "r2", field: "client", edit: chat("青池商店") }])
    w = { ...w, edits: new Map(w.edits).set(editKey("r1", "client"), staff("職員が直した")) }
    const r = undo(w, "u-p1")!
    expect(r.kept).toBe(2)
    expect(r.work.edits.get(editKey("r1", "client"))).toEqual(staff("職員が直した"))
    expect(r.work.edits.get(editKey("r2", "client"))).toEqual(chat("青池商店"))
    // 新しい承認は取り消せる
    const r2 = undo(r.work, "u-p2")!
    expect(r2.kept).toBe(0)
    expect(r2.work.edits.get(editKey("r2", "client"))).toEqual(chat("㈲青池"))
  })

  test("千円未満の扱いの承認も取り消せる（開き直しても）。承認のあとに職員が変えていれば戻さずに数える", () => {
    const amount = { value: "3500", by: "excel" as const, amount: { raw: "3500.6", transform: "rule.thousandYen" as const } }
    const w = approve(base, "p1", [{ kind: "settings", rounding: "round" }, { kind: "cell", rowKey: "r1", field: "amount", edit: amount }])
    expect(w.rounding).toBe("round")
    // 金額の手直しの千円にする前の値も保存して読み直せる（前の保存の手直しには無い）
    expect(reopen(w).edits.get(editKey("r1", "amount"))).toEqual(amount)
    expect(w.undo[0]!.rounding).toEqual(["floor", "round"])
    expect(canUndo(w.undo[0]!)).toBe(true)
    const r = undo(reopen(w), "u-p1")!
    expect([r.work.rounding, r.reverted, r.kept]).toEqual(["floor", 2, 0])
    const changed = undo({ ...w, rounding: "floor" }, "u-p1")!
    expect([changed.work.rounding, changed.kept]).toEqual(["floor", 1])
    // 同じ扱いの承認は記録に残さない
    expect(approve(base, "p2", [{ kind: "settings", rounding: "floor" }]).undo).toEqual([])
  })

  test("足した行のセルを後から変えていれば、行は外さない", () => {
    let w = approve(base, "p1", [{ kind: "add", rowKey: "add-1", by: "chat", cells: { workName: chat("足した工事") } }])
    w = { ...w, edits: new Map(w.edits).set(editKey("add-1", "workName"), staff("直した")) }
    const r = undo(w, "u-p1")!
    expect(r.work.added.map((a) => a.key)).toEqual(["add-1"])
    expect(r.kept).toBe(1)
  })

  test("足した行の、承認では書いていない項目を後から直していても、行は外さずに数える（その手直しを黙って消さない）", () => {
    let w = approve(base, "p1", [{ kind: "add", rowKey: "add-1", by: "chat", cells: { workName: chat("足した工事") } }])
    w = { ...w, edits: new Map(w.edits).set(editKey("add-1", "client"), staff("後から足した注文者")) }
    const r = undo(w, "u-p1")!
    expect(r.work.added.map((a) => a.key)).toEqual(["add-1"])
    expect(r.work.edits.get(editKey("add-1", "client"))).toEqual(staff("後から足した注文者"))
    expect(r.kept).toBe(1)
  })

  test("記録の大きさは UTF-8 のバイト数で測る（日本語は1文字3バイト）", () => {
    const n = Math.floor(UNDO_LIMITS.approval.bytes / 3 / 80) + 10
    const changes = Array.from({ length: n }, (_, i): ChatChange => ({ kind: "cell", rowKey: `r${i}`, field: "workName", edit: chat("あ".repeat(80)) }))
    const entry = undoEntry(base, applyChanges(base, [], changes), { id: "jp", proposalId: "jp", kind: "approval", label: "", at: 0 })!
    expect(JSON.stringify(entry).length).toBeLessThan(UNDO_LIMITS.approval.bytes)
    expect(pushUndo([], entry).at(-1)!.tooLarge).toBe(true)
  })

  test("計画を戻すと planChanged。今の計画が承認のあとに変わっていれば戻さない", () => {
    const plan: SavedPlan = { plan: { sheets: ["s"], headerRow: 0, dataRows: { start: 1, end: 2 }, skipRows: [], rowFilter: { excludeHidden: true, excludeColumns: [] }, amountUnit: "yen", fields: {} as never, unusedColumns: [], notes: [] }, source: "ai" }
    const before: CaseWork = { ...base, plan }
    const after: CaseWork = { ...before, plan: { ...plan, plan: { ...plan.plan, amountUnit: "thousandYen" as const } } }
    const entry = undoEntry(before, after, { id: "u", proposalId: "p", kind: "approval", label: "計画", at: 0 })!
    const w: CaseWork = { ...after, undo: [entry] }
    const r = undo(w, "u")!
    expect(r.planChanged).toBe(true)
    expect(r.work.plan).toEqual(plan)
    const moved: CaseWork = { ...w, plan: { ...plan, plan: { ...plan.plan, headerRow: 1 } } }
    expect(undo(moved, "u")!.planChanged).toBe(false)
  })

  test("外への書き込み（ルールの追記）だけの承認も記録に残し、戻す値は無いので取り消せない", () => {
    const entry = undoEntry(base, base, { id: "u", proposalId: "p", kind: "approval", label: "ルール", at: 0, external: ["rule"] })!
    expect(entry.external).toEqual(["rule"])
    expect(canUndo(entry)).toBe(false)
    expect(undoEntry(base, base, { id: "u", proposalId: "p", kind: "approval", label: "x", at: 0 })).toBeNull()
  })

  test("記録の数と大きさに上限を付け、1件で上限を超える記録は取り消せない印だけを残す", () => {
    const max = UNDO_LIMITS.approval.entries
    let list = [] as ReturnType<typeof pushUndo>
    for (let i = 0; i < max + 5; i++) list = pushUndo(list, undoEntry(base, approve(base, `p${i}`, [{ kind: "include", rowKey: `r${i}`, include: true }]), { id: `u${i}`, proposalId: `p${i}`, kind: "approval", label: "", at: i })!)
    expect(list).toHaveLength(max)
    expect(list[0]!.id).toBe("u5")
    const big = Array.from({ length: 3000 }, (_, i): ChatChange => ({ kind: "cell", rowKey: `r${i}`, field: "workName", edit: chat("あ".repeat(80)) }))
    const huge = undoEntry(base, applyChanges(base, [], big), { id: "big", proposalId: "big", kind: "approval", label: "", at: 0 })!
    expect(JSON.stringify(huge).length).toBeGreaterThan(UNDO_LIMITS.approval.bytes)
    const pushed = pushUndo(list, huge).at(-1)!
    expect(pushed.tooLarge).toBe(true)
    expect(pushed.kind).toBe("approval")
    expect(canUndo(pushed)).toBe(false)
  })

  const entryOf = (proposalId: string, kind: UndoKind, i: number) =>
    undoEntry(base, approve(base, proposalId, [{ kind: "include", rowKey: `r${i}`, include: true }]), { id: `${proposalId}#${i}`, proposalId, kind, label: "", at: i })!

  test("操作の記録は別の枠で数え、50回積んでも承認の記録を押し出さない", () => {
    let list = [] as ReturnType<typeof pushUndo>
    for (let i = 0; i < UNDO_LIMITS.approval.entries; i++) list = pushUndo(list, entryOf(`p${i}`, "approval", i))
    for (let i = 0; i < 50; i++) list = pushUndo(list, entryOf(`${GYOSHU_UNDO}${i}`, "op", 100 + i))
    const approvals = list.filter((e) => e.kind === "approval")
    const ops = list.filter((e) => e.kind === "op")
    // 承認の記録は全部残り、操作は新しいものから枠の数だけ残る
    expect(approvals.map((e) => e.at)).toEqual(Array.from({ length: UNDO_LIMITS.approval.entries }, (_, i) => i))
    expect(ops.map((e) => e.at)).toEqual(Array.from({ length: UNDO_LIMITS.op.entries }, (_, i) => 140 + i))
    // 承認が増えて枠を超えると、捨てるのは承認の記録の古いものから（操作は残る）
    list = pushUndo(list, entryOf("p-new", "approval", 999))
    expect(list.filter((e) => e.kind === "approval")[0]!.at).toBe(1)
    expect(list.filter((e) => e.kind === "op")).toHaveLength(UNDO_LIMITS.op.entries)
  })

  test("操作の枠の大きさを超えたら操作の古い記録から捨て、承認の記録は大きさの枠も別", () => {
    // 1件が約 70KB の操作の記録（日本語 80 文字 × 300 セル）
    const opEntry = (i: number) => {
      const changes = Array.from({ length: 300 }, (_, j): ChatChange => ({ kind: "cell", rowKey: `o${i}-${j}`, field: "workName", edit: chat("あ".repeat(80)) }))
      return undoEntry(base, applyChanges(base, [], changes), { id: `o${i}`, proposalId: `${RANGE_UNDO}${i}`, kind: "op", label: "", at: i })!
    }
    let list = [entryOf("p0", "approval", 0)]
    for (let i = 1; i <= 9; i++) list = pushUndo(list, opEntry(i))
    const bytes = (es: typeof list) => es.reduce((n, e) => n + new TextEncoder().encode(JSON.stringify(e)).byteLength, 0)
    const ops = list.filter((e) => e.kind === "op")
    expect(ops.length).toBeLessThan(9)
    expect(bytes(ops)).toBeLessThanOrEqual(UNDO_LIMITS.op.bytes)
    expect(ops.at(-1)!.at).toBe(9)
    expect(list[0]!.id).toBe("p0#0")
  })

  test("300行の業種をまとめて決めた1回（前後に AI の案の注意書き 120 文字）と240行の範囲の入れ外しは、1件で枠に入り取り消せる", () => {
    const key = (i: number) => `工事経歴一覧（令和6年度）!${i + 3}`
    const note = "あ".repeat(120)
    const before: CaseWork = { ...base, edits: new Map(Array.from({ length: 300 }, (_, i) => [editKey(key(i), "gyoshu"), { value: "08", by: "chat", status: "warning", guessed: true, message: `AI の案（ほかの工事の傾向）: ${note}` }])) }
    const after: CaseWork = { ...before, edits: new Map(Array.from({ length: 300 }, (_, i) => [editKey(key(i), "gyoshu"), { value: "08", by: "chat", message: `AI の案（工事名）: ${note}` }])) }
    const gyoshu = pushUndo([], undoEntry(before, after, { id: "g", proposalId: `${GYOSHU_UNDO}x`, kind: "op", label: "", at: 0 })!).at(-1)!
    expect(gyoshu.tooLarge).toBeUndefined()
    expect(canUndo(gyoshu)).toBe(true)
    const ranged: CaseWork = { ...base, manual: new Map(Array.from({ length: 240 }, (_, i) => [key(i), true])) }
    const range = pushUndo([], undoEntry(base, ranged, { id: "r", proposalId: `${RANGE_UNDO}x`, kind: "op", label: "", at: 0 })!).at(-1)!
    expect(canUndo(range)).toBe(true)
  })

  test("kind の無い前の記録は、操作の印から枠を決める", () => {
    const old = (proposalId: string) => undoEntrySchema.parse({ id: proposalId, proposalId, label: "", at: 0, edits: [], manual: [], added: [], external: [] })
    expect(old(`${SELECTION_UNDO}x`).kind).toBeUndefined()
    expect([SELECTION_UNDO, RANGE_UNDO, GYOSHU_UNDO, "confirm:"].map((m) => kindOf(old(`${m}x`)))).toEqual(["op", "op", "op", "op"])
    expect(kindOf(old("proposal-id"))).toBe("approval")
    expect(kindOf(old("report:tax"))).toBe("approval")
    // 前の記録の操作も操作の枠で数える（承認を押し出さない）
    let list = Array.from({ length: UNDO_LIMITS.approval.entries }, (_, i) => old(`p${i}`))
    for (let i = 0; i < 20; i++) list = pushUndo(list, old(`${SELECTION_UNDO}${i}`))
    expect(list.filter((e) => kindOf(e) === "approval")).toHaveLength(UNDO_LIMITS.approval.entries)
    expect(list.filter((e) => kindOf(e) === "op")).toHaveLength(UNDO_LIMITS.op.entries)
  })

  test("前の版で保存した作業（取り消しの記録が無い）も読める", () => {
    const { undo: _u, reportAnswers: _r, ...old } = toSavedWork(newWork("f"))
    const read = savedWorkSchema.parse(JSON.parse(JSON.stringify(old)))
    expect(read.undo).toEqual([])
    expect(read.reportAnswers).toEqual({})
  })
})

describe("問い合わせのメールの下書きの承認の取り消し", () => {
  const text = applyInquiryChange(EMPTY_INQUIRY_TEXT, { kind: "inquiryMail", subject: "AI の件名", intro: "AI の前置き" })

  test("承認した件名・前置きを取り消すと前の文面に戻る。前の作業（文面の無い保存）は空の文面として読む。承認のあとに職員が直していたら残す", () => {
    const before = newWork("f")
    const after = { ...before, inquiryText: text }
    const entry = undoEntry(before, after, { id: "u", proposalId: "p1", kind: "approval", label: "p1", at: 0 })!
    expect(canUndo(entry)).toBe(true)
    const w = reopen({ ...after, undo: [entry] })
    expect(w.inquiryText).toEqual(text)
    expect(undo(w, "u")!.work.inquiryText).toEqual(EMPTY_INQUIRY_TEXT)
    const edited = { ...after, undo: [entry], inquiryText: { ...text, subject: "職員の件名" } }
    const r = undo(edited, "u")!
    expect(r).toMatchObject({ kept: 1, reverted: 1 })
    expect(r.work.inquiryText).toEqual({ ...EMPTY_INQUIRY_TEXT, subject: "職員の件名" })
    const { inquiryText: _, ...old } = toSavedWork(newWork("f"))
    expect(savedWorkSchema.parse(old).inquiryText).toEqual(EMPTY_INQUIRY_TEXT)
  })
})

describe("報告の聞き返しの答えの取り消し", () => {
  test("答え（と答えで変えた税の設定）を記録し、取り消すと聞き返しを開き直す。開き直しても取り消せる", () => {
    const before = newWork("f")
    const after = { ...before, tax: "included" as const, taxBy: "staff" as const, reportAnswers: { tax: "included" } }
    const entry = undoEntry(before, after, { id: "u1", proposalId: "report:tax", kind: "approval", label: "report:tax", at: 0 })!
    expect(canUndo(entry)).toBe(true)
    const w = { ...after, undo: pushUndo([], entry) }
    const r = undo(reopen(w), "u1")!
    expect(r.work.reportAnswers).toEqual({})
    expect(r.work.tax).toBe("unknown")
    expect(r.work.taxBy).toBe(null)
    // 答え1つは1件（答えで変えた税の設定は答えの一部）
    expect(r.reverted).toBe(1)
  })
  test("計画の聞き返しの答えで足した出さない行は、取り消すとそれだけを外す（答えのあとに足した除外・変えた計画は残す）", () => {
    const rf = { excludeHidden: false, excludeColumns: [] }
    const plan: SavedPlan = { plan: { sheets: ["s"], headerRow: 0, dataRows: { start: 1, end: 2 }, skipRows: [], rowFilter: rf, amountUnit: "yen", fields: {} as never, unusedColumns: [], notes: [] }, source: "ai" }
    const before: CaseWork = { ...newWork("f"), plan }
    const x = { column: 3, values: ["未成"] }
    const answered: CaseWork = { ...before, plan: { ...plan, plan: { ...plan.plan, rowFilter: { ...rf, excludeValues: [x] } } }, reportAnswers: { "plan-ask-0": "exclude" } }
    const entry = undoEntry(before, { ...answered, plan: before.plan }, { id: "u3", proposalId: "report:plan-ask-0", kind: "approval", label: "x", at: 0, exclusions: [x] })!
    expect(entry.plan).toBeUndefined()
    // 答えのあとにチャットで別の列を除外した
    const later: CaseWork = { ...answered, plan: { ...plan, plan: { ...plan.plan, skipRows: [2], rowFilter: { ...rf, excludeColumns: [5], excludeValues: [x] } } }, undo: [entry] }
    const r = undo(later, "u3")!
    expect(r.work.plan!.plan.rowFilter).toEqual({ excludeHidden: false, excludeColumns: [5] })
    expect(r.work.plan!.plan.skipRows).toEqual([2])
    expect(r.work.reportAnswers).toEqual({})
    expect(r.planChanged).toBe(true)
    expect(r.reverted).toBe(1)
  })
  test("答えは聞き返しごとに戻す（あとでほかの聞き返しに答えても、この答えだけを戻せる）", () => {
    const before = newWork("f")
    const a1 = { ...before, reportAnswers: { tax: "ask" } }
    const e1 = undoEntry(before, a1, { id: "e1", proposalId: "report:tax", kind: "approval", label: "x", at: 0 })!
    const a2: CaseWork = { ...a1, reportAnswers: { tax: "ask", other: "keep" }, undo: [e1] }
    const r = undo(a2, "e1")!
    expect(r.kept).toBe(0)
    expect(r.work.reportAnswers).toEqual({ other: "keep" })
  })
  test("何も変えない答えも記録し、取り消せる", () => {
    const before = newWork("f")
    const entry = undoEntry(before, { ...before, reportAnswers: { "plan-ask-0": "keep" } }, { id: "u2", proposalId: "report:plan-ask-0", kind: "approval", label: "x", at: 0 })!
    expect(entry.reportAnswers).toEqual([["plan-ask-0", null, "keep"]])
    const answered: CaseWork = { ...before, reportAnswers: { "plan-ask-0": "keep" }, undo: [entry] }
    const r = undo(answered, "u2")!
    expect(r.work.reportAnswers).toEqual({})
  })
})
