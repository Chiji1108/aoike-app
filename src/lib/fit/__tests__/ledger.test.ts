import { describe, expect, test } from "vitest"
import { billingMonths, billingRows, billingTotal, bookRows, bookYears, type LedgerSource } from "../ledger"

const src = (over: Partial<LedgerSource> = {}): LedgerSource => ({
  id: "p1",
  caseId: "c1",
  bookYear: 2026,
  seq: 1,
  kind: "new",
  receivedOn: "2026-11-02",
  poaReceivedOn: "2026-11-05",
  appliedOn: null,
  approvedOn: null,
  completedOn: null,
  invoicedOn: null,
  invoiceNumber: "",
  paidOn: null,
  onHold: false,
  closeReason: null,
  fee: 11_000,
  special: false,
  specialAmount: null,
  specialPayer: null,
  case: { name: "見本 太郎", address: "東京都見本区1-1" },
  openDefects: [],
  ...over,
})

describe("請求", () => {
  test("完了通知日の月で入れる（月末締め）。取下げ・中止は入れない。SHARP 負担の特殊対応は足す", () => {
    const rows = [
      src({ id: "a", seq: 1, completedOn: "2026-11-30" }),
      src({ id: "b", seq: 2, completedOn: "2026-12-01" }),
      src({ id: "c", seq: 3, completedOn: "2026-11-05", kind: "pre_change", fee: 5_500, special: true, specialAmount: 3_300, specialPayer: "sharp" }),
      src({ id: "d", seq: 4, completedOn: "2026-11-06", special: true, specialAmount: 2_000, specialPayer: "customer" }),
      src({ id: "e", seq: 5, completedOn: "2026-11-07", closeReason: "cancelled" }),
    ]
    const nov = billingRows(rows, "2026-11")
    expect(nov.map((r) => [r.id, r.special])).toEqual([
      ["c", 3_300],
      ["d", 0],
      ["a", 0],
    ])
    expect(billingTotal(nov)).toBe(5_500 + 3_300 + 11_000 + 11_000)
    expect(billingMonths(rows)).toEqual(["2026-12", "2026-11"])
    // SHARP 負担なのに額が空なら知らせる
    expect(billingRows([src({ completedOn: "2026-11-01", special: true, specialPayer: "sharp" })], "2026-11")[0]!.specialMissing).toBe(true)
  })
})

describe("事件簿", () => {
  test("その年の手続を番号の順に。事件の名称・依頼者・結果", () => {
    const rows = [
      src({ id: "b", seq: 2, kind: "pre_change", closeReason: "withdrawn" }),
      src({ id: "a", seq: 1, paidOn: "2027-01-20" }),
      src({ id: "x", bookYear: 2027, seq: 1 }),
      src({ id: "c", seq: 3, appliedOn: "2026-11-10" }),
    ]
    const book = bookRows(rows, 2026)
    expect(book.map((r) => [r.number, r.title, r.result])).toEqual([
      ["F8-0001", "再エネ事業計画（太陽光10kW未満）新規認定", "完了"],
      ["F8-0002", "再エネ事業計画（太陽光10kW未満）事前変更届", "取下げ"],
      ["F8-0003", "再エネ事業計画（太陽光10kW未満）新規認定", "申請中"],
    ])
    expect(book[0]!.acceptedOn).toBe("2026-11-05")
    expect(bookYears(rows, 2028)).toEqual([2028, 2027, 2026])
  })
})
