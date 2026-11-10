import { describe, expect, test } from "bun:test"
import type { CaseInput } from "../fit-store"
import {
  DuplicateCommonIdError,
  addDefect,
  addProcedure,
  createCase,
  getCasePage,
  getProcedure,
  getWeeklyReport,
  latestWeeklyRows,
  listProcedures,
  listWeeklyReports,
  saveWeeklyReport,
  updateCase,
  updateDefect,
  updateProcedure,
} from "../fit-store"
import { migratedFitDb } from "./fit-sqlite"

const caseInput = (over: Partial<CaseInput> = {}): CaseInput => ({
  commonId: null,
  name: "見本 太郎",
  kana: "ミホン タロウ",
  postalCode: "",
  address: "",
  phone: "",
  email: "",
  sitePostalCode: "",
  siteAddress: "",
  siteKana: "",
  siteAddressKind: null,
  builder: "見本住建",
  outputKw: null,
  hasBattery: false,
  sharedOwnership: false,
  note: "",
  ...over,
})

describe("FIT の案件・手続", () => {
  test("事件簿の番号は受付日の年ごとの通し番号。年が変わると1から", async () => {
    const { db } = migratedFitDb()
    const a = await createCase(db, caseInput({ commonId: "CP1" }), { kind: "new", receivedOn: "2026-11-02" })
    await createCase(db, caseInput({ commonId: "CP2" }), { kind: "new", receivedOn: "2026-12-28" })
    await addProcedure(db, a.caseId, "pre_change", "2027-01-05")
    await createCase(db, caseInput({ commonId: "CP3" }), { kind: "new", receivedOn: "2027-01-06" })
    const rows = await listProcedures(db)
    expect(rows.map((r) => [r.bookYear, r.seq])).toEqual([
      [2026, 1],
      [2026, 2],
      [2027, 1],
      [2027, 2],
    ])
    expect(rows[2]!.case.commonId).toBe("CP1")
  })

  test("同じ共通ID の案件は作れない（まだ共通ID の無い案件はいくつでも）", async () => {
    const { db } = migratedFitDb()
    await createCase(db, caseInput({ commonId: "CP1" }), { kind: "new", receivedOn: "2026-11-02" })
    await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    const other = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-03" })
    await expect(createCase(db, caseInput({ commonId: "CP1" }), { kind: "new", receivedOn: "2026-11-04" })).rejects.toBeInstanceOf(DuplicateCommonIdError)
    await expect(updateCase(db, other.caseId, { commonId: "CP1" })).rejects.toBeInstanceOf(DuplicateCommonIdError)
    // 作れなかった案件の手続も残らない（番号を使わない）
    expect((await listProcedures(db)).length).toBe(3)
  })

  test("受任したら受任日の報酬表の額を入れ、あとで直した額は動かさない", async () => {
    const { db } = migratedFitDb()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await updateProcedure(db, procedureId, { sealCertIssuedOn: "2026-10-30" })
    expect((await getProcedure(db, procedureId))!.fee).toBeNull()
    await updateProcedure(db, procedureId, { poaReceivedOn: "2026-11-05" })
    expect((await getProcedure(db, procedureId))!.fee).toBe(11_000)
    await updateProcedure(db, procedureId, { fee: 12_000 })
    await updateProcedure(db, procedureId, { appliedOn: "2026-11-10" })
    expect((await getProcedure(db, procedureId))!.fee).toBe(12_000)
  })

  test("額を入れずに申請区分を変えたら、新しい区分の額に入れ直す", async () => {
    const { db } = migratedFitDb()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await updateProcedure(db, procedureId, { poaReceivedOn: "2026-11-05" })
    await updateProcedure(db, procedureId, { kind: "pre_change" })
    expect((await getProcedure(db, procedureId))!.fee).toBe(5_500)
    // 額も一緒に入れたときはその額
    await updateProcedure(db, procedureId, { kind: "new", fee: 9_000 })
    expect((await getProcedure(db, procedureId))!.fee).toBe(9_000)
  })

  test("認定の手続は、認定通知書を保存するまで完了通知日を入れられない（届出は入れられる）", async () => {
    const { db } = migratedFitDb()
    const { caseId, procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await expect(updateProcedure(db, procedureId, { completedOn: "2026-12-02" })).rejects.toThrow("認定通知書を保存してから")
    await updateProcedure(db, procedureId, { noticeSaved: true, completedOn: "2026-12-02" })
    expect((await getProcedure(db, procedureId))!.completedOn).toBe("2026-12-02")
    const change = await addProcedure(db, caseId, "pre_change", "2027-02-01")
    await updateProcedure(db, change.id, { completedOn: "2027-02-20" })
    expect((await getProcedure(db, change.id))!.completedOn).toBe("2027-02-20")
  })

  test("その他変更認定は報酬表に額が無いので空のまま", async () => {
    const { db } = migratedFitDb()
    const { procedureId } = await createCase(db, caseInput(), { kind: "other_change", receivedOn: "2026-11-02" })
    await updateProcedure(db, procedureId, { poaReceivedOn: "2026-11-05" })
    expect((await getProcedure(db, procedureId))!.fee).toBeNull()
  })

  test("一覧と案件の画面には、済んでいない不備・すべての不備が付く", async () => {
    const { db } = migratedFitDb()
    const { caseId, procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    const d1 = await addDefect(db, procedureId, { kind: "before", content: "委任状", receivedOn: "2026-11-03", dueOn: null, requestedTo: "customer", resolvedOn: null })
    await addDefect(db, procedureId, { kind: "after", content: "割付図", receivedOn: "2026-11-12", dueOn: "2026-11-25", requestedTo: "builder", resolvedOn: null })
    await updateDefect(db, d1.id, { resolvedOn: "2026-11-05" })
    const [row] = await listProcedures(db)
    expect(row!.openDefects).toEqual([{ kind: "after", content: "割付図", dueOn: "2026-11-25" }])
    const page = await getCasePage(db, caseId)
    expect(page!.defects.map((d) => d.content)).toEqual(["委任状", "割付図"])
    expect(await getCasePage(db, "nope")).toBeUndefined()
  })
})

describe("週次の案件表の記録", () => {
  test("いちばん新しい記録と比べ、出し直すときはその1つ前の記録と比べる", async () => {
    const { db } = migratedFitDb()
    expect(await latestWeeklyRows(db)).toBeNull()
    const first = await saveWeeklyReport(db, { p1: ["a"] })
    await new Promise((r) => setTimeout(r, 5))
    const second = await saveWeeklyReport(db, { p1: ["b"], p2: ["c"] })
    expect(await latestWeeklyRows(db)).toEqual({ p1: ["b"], p2: ["c"] })
    expect((await listWeeklyReports(db)).map((r) => [r.id, r.count])).toEqual([
      [second.id, 2],
      [first.id, 1],
    ])
    expect((await getWeeklyReport(db, second.id))!.previous).toEqual({ p1: ["a"] })
    expect((await getWeeklyReport(db, first.id))!.previous).toBeNull()
  })
})
