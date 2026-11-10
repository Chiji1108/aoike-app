import { describe, expect, test } from "bun:test"
import { todayIso } from "../../period"
import { acceptedOnOf, bookNumber, feeFor, looksLikeCommonId, procedureStatus, type StatusInput } from "../procedure"
import { compareWeekly, isUpdated, weeklyValues, type WeeklySource } from "../weekly"

const base: StatusInput = {
  receivedOn: "2026-11-02",
  poaReceivedOn: null,
  appliedOn: null,
  approvedOn: null,
  completedOn: null,
  invoicedOn: null,
  paidOn: null,
  onHold: false,
  closeReason: null,
  openCorrection: false,
}

describe("事件簿の番号", () => {
  test("F＋令和の年−4桁の通し番号", () => {
    expect(bookNumber(2026, 1)).toBe("F8-0001")
    expect(bookNumber(2027, 123)).toBe("F9-0123")
    expect(bookNumber(2028, 10000)).toBe("F10-10000")
  })
})

describe("受任日", () => {
  test("申込書と委任状の遅いほう。委任状が無ければまだ受任していない", () => {
    expect(acceptedOnOf({ receivedOn: "2026-11-02", poaReceivedOn: null })).toBeNull()
    expect(acceptedOnOf({ receivedOn: "2026-11-02", poaReceivedOn: "2026-11-05" })).toBe("2026-11-05")
    // 委任状が先に届いたときは申込書の日
    expect(acceptedOnOf({ receivedOn: "2026-11-02", poaReceivedOn: "2026-10-30" })).toBe("2026-11-02")
  })
})

describe("報酬表", () => {
  test("2027-03-31 までの受任は新規 11,000円・変更系 5,500円。その他変更認定は事案ごと", () => {
    expect(feeFor("new", "2026-11-05")).toBe(11_000)
    expect(feeFor("pre_change", "2027-03-31")).toBe(5_500)
    expect(feeFor("change_approval", "2026-12-01")).toBe(5_500)
    expect(feeFor("other_change", "2026-12-01")).toBeNull()
  })
  test("報酬表の期間の外は額を決めない（手で入れる）", () => {
    expect(feeFor("new", "2027-04-01")).toBeNull()
  })
})

describe("状況", () => {
  test("日付が進むたびに変わる", () => {
    expect(procedureStatus(base)).toBe("received")
    const accepted = { ...base, poaReceivedOn: "2026-11-05" }
    expect(procedureStatus(accepted)).toBe("preparing")
    const applied = { ...accepted, appliedOn: "2026-11-10" }
    expect(procedureStatus(applied)).toBe("applied")
    const approved = { ...applied, approvedOn: "2026-12-01" }
    expect(procedureStatus(approved)).toBe("approved")
    const notified = { ...approved, completedOn: "2026-12-02" }
    expect(procedureStatus(notified)).toBe("notified")
    const invoiced = { ...notified, invoicedOn: "2026-12-31" }
    expect(procedureStatus(invoiced)).toBe("invoiced")
    expect(procedureStatus({ ...invoiced, paidOn: "2027-01-20" })).toBe("closed")
  })
  test("申請後の補正が済んでいなければ補正中。申請前の不備では補正中にしない", () => {
    const applied = { ...base, poaReceivedOn: "2026-11-05", appliedOn: "2026-11-10" }
    expect(procedureStatus({ ...applied, openCorrection: true })).toBe("correcting")
    expect(procedureStatus({ ...base, poaReceivedOn: "2026-11-05", openCorrection: true })).toBe("preparing")
  })
  test("保留は進み具合より先に、取下げ・中止はいつでも終了", () => {
    expect(procedureStatus({ ...base, poaReceivedOn: "2026-11-05", appliedOn: "2026-11-10", onHold: true })).toBe("on_hold")
    expect(procedureStatus({ ...base, appliedOn: "2026-11-10", closeReason: "withdrawn", onHold: true })).toBe("closed")
  })
})

describe("共通ID の形", () => {
  test("CP＋数字だけを正しい形とみる（桁数は決め打ちしない）", () => {
    expect(looksLikeCommonId("CP0000510")).toBe(true)
    expect(looksLikeCommonId("CP00005101")).toBe(true)
    expect(looksLikeCommonId("cp00005101")).toBe(false)
    expect(looksLikeCommonId("CP-0001")).toBe(false)
  })
})

test("今日は日本時間で決める", () => {
  expect(todayIso(new Date("2026-11-10T15:30:00Z"))).toBe("2026-11-11")
  expect(todayIso(new Date("2026-11-10T14:59:00Z"))).toBe("2026-11-10")
})

const source = (over: Partial<WeeklySource> = {}): WeeklySource => ({
  id: "p1",
  kind: "new",
  bookYear: 2026,
  seq: 1,
  receivedOn: "2026-11-02",
  poaReceivedOn: "2026-11-05",
  appliedOn: null,
  applicationId: "",
  approvedOn: null,
  facilityId: "",
  completedOn: null,
  invoicedOn: null,
  case: { commonId: "CP00000001", name: "見本 太郎", builder: "見本住建" },
  openDefects: [],
  ...over,
})

describe("週次の案件表", () => {
  test("SHARP の資料の14列の順。空は null、不備はつなげる", () => {
    expect(weeklyValues(source({ openDefects: ["委任状", "印鑑証明"] }))).toEqual([
      "新規認定",
      "CP00000001",
      "見本 太郎",
      "見本住建",
      "F8-0001",
      "2026-11-02",
      "2026-11-05",
      "委任状、印鑑証明",
      null,
      null,
      null,
      null,
      null,
      null,
    ])
  })

  test("前回と比べて、足した行と変わったセルに印を付ける", () => {
    const before = weeklyValues(source())
    const after = weeklyValues(source({ appliedOn: "2026-11-10", applicationId: "A-1" }))
    const rows = compareWeekly(
      [
        { id: "p1", values: after },
        { id: "p2", values: weeklyValues(source({ id: "p2", seq: 2 })) },
        { id: "p3", values: before },
      ],
      { p1: before, p3: before },
    )
    expect(rows[0]!.added).toBe(false)
    expect(rows[0]!.changed.flatMap((c, i) => (c ? [i] : []))).toEqual([8, 9])
    expect(rows[1]!.added).toBe(true)
    expect(rows[2]!.changed.some(Boolean)).toBe(false)
    expect(rows.filter(isUpdated).map((r) => r.id)).toEqual(["p1", "p2"])
  })

  test("初めて出すときは全部の行が足した行", () => {
    const rows = compareWeekly([{ id: "p1", values: weeklyValues(source()) }], null)
    expect(rows[0]!.added).toBe(true)
  })
})
