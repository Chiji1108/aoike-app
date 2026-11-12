import { describe, expect, test } from "vitest"
import type { CaseInput } from "../fit-store"
import {
  DuplicateCommonIdError,
  addFile,
  emptyTrash,
  restoreFile,
  trashFile,
  getFileRow,
  listFiles,
  purgeFiles,
  purgeableFiles,
  recordDownload,
  type Bucket,
  addDefect,
  addProcedure,
  createCase,
  getCasePage,
  getEquipment,
  saveEquipment,
  getProcedure,
  getSettings,
  saveSettings,
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

  test("受付日は番号の年の中でだけ直せる", async () => {
    const { db } = migratedFitDb()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-12-28" })
    await updateProcedure(db, procedureId, { receivedOn: "2026-12-25" })
    expect((await getProcedure(db, procedureId))!.receivedOn).toBe("2026-12-25")
    await expect(updateProcedure(db, procedureId, { receivedOn: "2027-01-04" })).rejects.toThrow("番号の年（2026年）")
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

describe("設定", () => {
  test("保存していなければ初期値。保存し直せて、報酬は保存した報酬表から入る", async () => {
    const { db } = migratedFitDb()
    const initial = await getSettings(db)
    expect(initial.sealWarnDays).toBe(14)
    const next = { ...initial, feeTables: [{ acceptedUntil: "2027-03-31", fees: { ...initial.feeTables[0]!.fees, new: 12_100 } }] }
    await saveSettings(db, next)
    await saveSettings(db, { ...next, sealWarnDays: 10 })
    expect((await getSettings(db)).sealWarnDays).toBe(10)
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await updateProcedure(db, procedureId, { poaReceivedOn: "2026-11-05" })
    expect((await getProcedure(db, procedureId))!.fee).toBe(12_100)
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

/** R2 の代わり */
function memoryBucket() {
  const objects = new Map<string, number>()
  const bucket: Bucket & { objects: typeof objects; failPut?: boolean } = {
    objects,
    async put(key, value) {
      if (bucket.failPut) return null
      const size = typeof value === "string" ? value.length : value instanceof Uint8Array ? value.byteLength : value instanceof ArrayBuffer ? value.byteLength : 0
      objects.set(key, size)
      return { size }
    },
    async delete(keys) {
      for (const k of keys) objects.delete(k)
    },
  }
  return bucket
}

const doc = (over: Partial<Parameters<typeof addFile>[3]> = {}) => ({ docType: "poa" as const, name: "委任状.pdf", contentType: "application/pdf", body: new Uint8Array(10), uploadedBy: "u1", ...over })

describe("書類", () => {
  test("同じ種類を置き直すと版が上がり、前の版も残る。ダウンロードを記録する", async () => {
    const { db } = migratedFitDb()
    const bucket = memoryBucket()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    const v1 = await addFile(db, bucket, procedureId, doc())
    const v2 = await addFile(db, bucket, procedureId, doc({ body: new Uint8Array(20) }))
    await addFile(db, bucket, procedureId, doc({ docType: "seal_cert", name: "印鑑証明.jpg" }))
    expect([v1!.version, v2!.version]).toEqual([1, 2])
    await recordDownload(db, v1!.id, "u1")
    await recordDownload(db, v1!.id, "u2")
    const files = await listFiles(db, [procedureId])
    expect(files.map((f) => [f.docType, f.version, f.size, f.downloads])).toEqual([
      ["poa", 2, 20, 0],
      ["poa", 1, 10, 2],
      ["seal_cert", 1, 10, 0],
    ])
    expect(files[1]!.lastDownloadAt).toBeGreaterThan(0)
    expect(bucket.objects.size).toBe(3)
    expect(await addFile(db, bucket, "nope", doc())).toBeUndefined()
  })

  test("認定通知書を置くと「認定通知書を保存した」になる", async () => {
    const { db } = migratedFitDb()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await addFile(db, memoryBucket(), procedureId, doc({ docType: "approval_notice", name: "認定通知書.pdf" }))
    expect((await getProcedure(db, procedureId))!.noticeSaved).toBe(true)
  })

  test("R2 に置けなければ記録しない", async () => {
    const { db } = migratedFitDb()
    const bucket = memoryBucket()
    bucket.failPut = true
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await expect(addFile(db, bucket, procedureId, doc())).rejects.toThrow("書類を置けませんでした")
    expect(await listFiles(db, [procedureId])).toEqual([])
  })

  test("保存期間：終わった手続で、帳簿を閉じた年末から2年たった書類だけ消せる。消しても記録は残る", async () => {
    const { db } = migratedFitDb()
    const bucket = memoryBucket()
    const done = await createCase(db, caseInput({ commonId: "CP1" }), { kind: "new", receivedOn: "2026-11-02" })
    const open = await createCase(db, caseInput({ commonId: "CP2" }), { kind: "new", receivedOn: "2026-11-03" })
    await updateProcedure(db, done.procedureId, { closeReason: "cancelled" })
    const f1 = await addFile(db, bucket, done.procedureId, doc())
    await addFile(db, bucket, open.procedureId, doc())
    expect(await purgeableFiles(db, 2, "2028-12-31")).toEqual([])
    const listed = await purgeableFiles(db, 2, "2029-01-01")
    expect(listed.map((r) => r.file.id)).toEqual([f1!.id])
    // 期間が過ぎていないもの（終わっていない手続の書類）は、id を渡しても消さない
    const all = await listFiles(db, [done.procedureId, open.procedureId])
    expect(await purgeFiles(db, bucket, all.map((f) => f.id), 2, "2029-01-01")).toBe(1)
    expect(bucket.objects.size).toBe(1)
    expect((await getFileRow(db, f1!.id))!.purgedAt).toBeInstanceOf(Date)
    expect(await purgeableFiles(db, 2, "2029-01-01")).toEqual([])
  })
})

test("設備はまとめて入れ替える（並びを保つ）", async () => {
  const { db } = migratedFitDb()
  const { caseId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
  const items = [
    { kind: "panel" as const, maker: "A", model: "P1", watts: 265, count: 12 },
    { kind: "pcs" as const, maker: "A", model: "C1", watts: 3000, count: 1 },
  ]
  await saveEquipment(db, caseId, items)
  await saveEquipment(db, caseId, [...items].reverse())
  expect((await getEquipment(db, caseId)).map((e) => e.model)).toEqual(["C1", "P1"])
  // 出力も一緒に入れる（ほかの項目は変えない）
  expect(await saveEquipment(db, caseId, items, true)).toBe(3.0)
  const page = await getCasePage(db, caseId)
  expect([page!.fitCase.outputKw, page!.fitCase.name]).toEqual([3.0, "見本 太郎"])
  await saveEquipment(db, caseId, [])
  expect(await getEquipment(db, caseId)).toEqual([])
  await expect(saveEquipment(db, caseId, [], true)).rejects.toThrow("出力を求められます")
  await expect(saveEquipment(db, "nope", items)).rejects.toThrow("案件が見つかりません")
})

describe("書類のゴミ箱", () => {
  test("ゴミ箱に入れると一覧で印が付き、戻せる。30日たったら R2 から消え、戻せない", async () => {
    const { db } = migratedFitDb()
    const bucket = memoryBucket()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    const f = await addFile(db, bucket, procedureId, doc())
    await trashFile(db, f!.id, "u1")
    const [trashed] = await listFiles(db, [procedureId])
    expect(trashed!.deletedAt).toBeGreaterThan(0)
    expect((await getFileRow(db, f!.id))!.deletedBy).toBe("u1")
    await restoreFile(db, f!.id)
    expect((await listFiles(db, [procedureId]))[0]!.deletedAt).toBeNull()

    await trashFile(db, f!.id, "u1")
    const deletedAt = (await getFileRow(db, f!.id))!.deletedAt!.getTime()
    expect(await emptyTrash(db, bucket, deletedAt + 29 * 86_400_000)).toBe(0)
    expect(bucket.objects.size).toBe(1)
    expect(await emptyTrash(db, bucket, deletedAt + 31 * 86_400_000)).toBe(1)
    expect(bucket.objects.size).toBe(0)
    expect((await getFileRow(db, f!.id))!.purgedAt).toBeInstanceOf(Date)
    await expect(restoreFile(db, f!.id)).rejects.toThrow("戻せません")
  })

  test("認定通知書をゴミ箱に入れると、ほかに残っていなければ「保存した」を外し、戻すと付け直す", async () => {
    const { db } = migratedFitDb()
    const bucket = memoryBucket()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    const n1 = await addFile(db, bucket, procedureId, doc({ docType: "approval_notice", name: "a.pdf" }))
    const n2 = await addFile(db, bucket, procedureId, doc({ docType: "approval_notice", name: "b.pdf" }))
    await trashFile(db, n2!.id, "u1")
    expect((await getProcedure(db, procedureId))!.noticeSaved).toBe(true)
    await trashFile(db, n1!.id, "u1")
    expect((await getProcedure(db, procedureId))!.noticeSaved).toBe(false)
    await restoreFile(db, n1!.id)
    expect((await getProcedure(db, procedureId))!.noticeSaved).toBe(true)
    // 完了通知したら、最後の認定通知書は消せない（ほかに残っていれば消せる）
    await updateProcedure(db, procedureId, { completedOn: "2026-12-02" })
    await expect(trashFile(db, n1!.id, "u1")).rejects.toThrow("最後の1つを消せません")
    await restoreFile(db, n2!.id)
    await trashFile(db, n1!.id, "u1")
    expect((await getProcedure(db, procedureId))!.noticeSaved).toBe(true)
  })

  test("ゴミ箱の書類は保存期間の一覧に出さない", async () => {
    const { db } = migratedFitDb()
    const bucket = memoryBucket()
    const { procedureId } = await createCase(db, caseInput(), { kind: "new", receivedOn: "2026-11-02" })
    await updateProcedure(db, procedureId, { closeReason: "cancelled" })
    const f = await addFile(db, bucket, procedureId, doc())
    await trashFile(db, f!.id, "u1")
    expect(await purgeableFiles(db, 2, "2029-01-01")).toEqual([])
  })
})
