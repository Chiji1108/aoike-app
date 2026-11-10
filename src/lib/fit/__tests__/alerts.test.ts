import { describe, expect, test } from "bun:test"
import { addMonths, daysBetween } from "../../period"
import { addressPending, alertsOf, sealExpiryOf, sortAlerts, type AlertSource } from "../alerts"
import { DEFAULT_SETTINGS } from "../settings"

const src = (over: Partial<AlertSource> = {}): AlertSource => ({
  id: "p1",
  caseId: "c1",
  bookYear: 2026,
  seq: 1,
  kind: "new",
  receivedOn: "2026-11-02",
  poaReceivedOn: null,
  noticeOn: null,
  answeredOn: null,
  sealCertIssuedOn: null,
  onHold: false,
  appliedOn: null,
  approvedOn: null,
  noticeSaved: false,
  paidOn: null,
  closeReason: null,
  case: { name: "見本 太郎" },
  openDefects: [],
  ...over,
})

const kinds = (p: AlertSource, today: string) => alertsOf(p, DEFAULT_SETTINGS, today).map((a) => `${a.kind}:${a.level}`)

describe("日付", () => {
  test("か月後は同じ日、無ければ月末", () => {
    expect(addMonths("2026-10-30", 3)).toBe("2027-01-30")
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28")
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29")
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3)
    expect(daysBetween("2027-01-02", "2026-12-30")).toBe(-3)
  })
  test("印鑑証明は発行から3か月の日まで", () => {
    expect(sealExpiryOf("2026-10-30")).toBe("2027-01-30")
  })
})

describe("期限と注意", () => {
  test("印鑑証明：14日を切ったら注意、過ぎたら警告。申請したら出さない", () => {
    // 年度の締切が出ない届出で見る
    const p = src({ kind: "post_change", sealCertIssuedOn: "2026-10-30" })
    expect(kinds(p, "2027-01-15")).toEqual([])
    expect(kinds(p, "2027-01-16")).toEqual(["seal:warn"])
    expect(kinds(p, "2027-01-30")).toEqual(["seal:warn"])
    expect(kinds(p, "2027-01-31")).toEqual(["seal:danger"])
    expect(kinds({ ...p, appliedOn: "2027-01-10" }, "2027-01-31")).toEqual([])
  })

  test("補正：申請後の補正だけ、期限が近い・過ぎたら出す", () => {
    const p = src({
      appliedOn: "2026-11-10",
      openDefects: [
        { kind: "after", content: "割付図", dueOn: "2026-11-25" },
        { kind: "before", content: "委任状", dueOn: "2026-11-20" },
      ],
    })
    expect(kinds(p, "2026-11-17")).toEqual([])
    expect(kinds(p, "2026-11-18")).toEqual(["correction:warn"])
    expect(alertsOf(p, DEFAULT_SETTINGS, "2026-11-26")[0]!.text).toContain("1日過ぎた")
  })

  test("年度の締切：未申請の認定の手続だけ。届出は出さない", () => {
    expect(kinds(src(), "2026-12-05")).toEqual([])
    expect(kinds(src(), "2026-12-06")).toEqual(["deadline:warn"])
    expect(kinds(src(), "2027-01-06")).toEqual(["deadline:danger"])
    // 次の年度（締切が設定に無い）は出さない
    expect(kinds(src(), "2027-04-01")).toEqual([])
    expect(kinds(src({ kind: "pre_change" }), "2026-12-20")).toEqual([])
  })

  test("告知：7日たったら了承とみなせる", () => {
    const p = src({ kind: "pre_change", noticeOn: "2026-11-02" })
    expect(alertsOf(p, DEFAULT_SETTINGS, "2026-11-05")[0]!.text).toContain("回答待ち")
    expect(alertsOf(p, DEFAULT_SETTINGS, "2026-11-09")[0]!.text).toContain("了承とみなして")
    expect(kinds({ ...p, answeredOn: "2026-11-04" }, "2026-11-09")).toEqual([])
  })

  test("動いていない：受任から30日・申請から60日。保留中は出さない", () => {
    const accepted = src({ kind: "post_change", poaReceivedOn: "2026-11-02" })
    expect(kinds(accepted, "2026-12-01")).toEqual([])
    expect(kinds(accepted, "2026-12-02")).toEqual(["stalled:info"])
    expect(kinds({ ...accepted, onHold: true }, "2026-12-02")).toEqual([])
    const applied = src({ kind: "post_change", poaReceivedOn: "2026-11-02", appliedOn: "2026-11-10" })
    expect(kinds(applied, "2027-01-09")).toEqual(["stalled:info"])
  })

  test("認定通知書を保存していない認定は注意。終わった手続は何も出さない", () => {
    const p = src({ poaReceivedOn: "2026-11-02", appliedOn: "2026-11-10", approvedOn: "2026-12-01" })
    expect(kinds(p, "2026-12-02")).toEqual(["noticeUnsaved:warn"])
    expect(kinds({ ...p, noticeSaved: true }, "2026-12-02")).toEqual([])
    expect(kinds({ ...src({ sealCertIssuedOn: "2026-01-01" }), closeReason: "cancelled" }, "2026-12-02")).toEqual([])
  })

  test("急ぐ順に並べる", () => {
    const a = alertsOf(src({ id: "a", sealCertIssuedOn: "2026-10-30" }), DEFAULT_SETTINGS, "2027-01-31")
    const b = alertsOf(src({ id: "b", appliedOn: "2026-11-10", approvedOn: "2026-12-01" }), DEFAULT_SETTINGS, "2027-01-31")
    const c = alertsOf(src({ id: "c", kind: "post_change", sealCertIssuedOn: "2026-11-05" }), DEFAULT_SETTINGS, "2027-01-31")
    // 過ぎたもの（締切 1/5 → 印鑑証明 1/30）→ 近いもの（印鑑証明 2/5）→ 期限の無いもの
    expect(sortAlerts([...b, ...c, ...a]).map((x) => `${x.procedureId}:${x.kind}`)).toEqual(["a:deadline", "a:seal", "c:seal", "b:noticeUnsaved"])
  })
})

test("住所確定待ち：地番で認定された新規で、事前変更届がまだ無い案件", () => {
  const lot = { name: "見本", siteAddressKind: "lot" as const }
  const rows = [
    src({ id: "n1", caseId: "c1", approvedOn: "2026-12-01", case: lot }),
    src({ id: "n2", caseId: "c2", approvedOn: "2026-12-01", case: lot }),
    src({ id: "pc", caseId: "c2", kind: "pre_change", case: lot }),
    src({ id: "n3", caseId: "c3", case: lot }),
    src({ id: "n4", caseId: "c4", approvedOn: "2026-12-01", case: { name: "見本", siteAddressKind: "residence" } }),
  ]
  expect(addressPending(rows).map((r) => r.id)).toEqual(["n1"])
})
