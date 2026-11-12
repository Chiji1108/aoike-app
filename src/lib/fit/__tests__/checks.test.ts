import { describe, expect, test } from "vitest"
import { autoChecks, outputKwOf, type CheckSource, type Equipment } from "../checks"

const panel = (watts: number, count: number): Equipment => ({ kind: "panel", maker: "", model: "P", watts, count })
const pcs = (watts: number, count: number): Equipment => ({ kind: "pcs", maker: "", model: "C", watts, count })

describe("出力の計算", () => {
  test("パネルとパワコンの合計の小さいほうを kW にし、小数第2位で切り捨てる（研修資料の例）", () => {
    expect(outputKwOf([panel(265, 12), pcs(3000, 1)])).toBe(3.0)
    expect(outputKwOf([panel(400, 12), pcs(5500, 1)])).toBe(4.8)
    expect(outputKwOf([panel(415, 13), pcs(5900, 1)])).toBe(5.3)
    // 型式の違うパネル・パワコンは合計する
    expect(outputKwOf([panel(300, 10), panel(250, 4), pcs(2000, 2)])).toBe(4.0)
  })
  test("どちらかが無ければ求めない", () => {
    expect(outputKwOf([panel(265, 12)])).toBeNull()
    expect(outputKwOf([])).toBeNull()
  })
})

const src = (over: Partial<CheckSource> = {}): CheckSource => ({
  kind: "new",
  sealCertIssuedOn: null,
  appliedOn: null,
  approvedOn: null,
  noticeSaved: false,
  case: { commonId: "CP00000001", outputKw: 3.0, sharedOwnership: false },
  equipment: [panel(265, 12), pcs(3000, 1)],
  docTypes: new Set(),
  ...over,
})

const states = (p: CheckSource, today = "2026-11-10") => Object.fromEntries(autoChecks(p, today).map((a) => [a.id, a.state]))

describe("自動の整合性チェック", () => {
  test("名称・出力・印鑑証明", () => {
    expect(states(src())).toEqual({ facilityName: "ok", outputCalc: "ok", seal: "na" })
    expect(states(src({ case: { ...src().case, commonId: "12345", outputKw: 3.5 } }))).toMatchObject({ facilityName: "ng", outputCalc: "ng" })
    expect(states(src({ case: { ...src().case, commonId: null } })).facilityName).toBe("na")
  })
  test("印鑑証明は申請日（未申請なら今日）に発行から3か月以内", () => {
    expect(states(src({ sealCertIssuedOn: "2026-08-10" }), "2026-11-10").seal).toBe("ok")
    expect(states(src({ sealCertIssuedOn: "2026-08-10" }), "2026-11-11").seal).toBe("ng")
    expect(states(src({ sealCertIssuedOn: "2026-08-10", appliedOn: "2026-11-09" }), "2027-01-01").seal).toBe("ok")
  })
  test("共有名義なら同意書、認定されたら認定通知書", () => {
    const shared = src({ case: { ...src().case, sharedOwnership: true } })
    expect(states(shared).consent).toBe("ng")
    expect(states({ ...shared, docTypes: new Set(["consent"]) }).consent).toBe("ok")
    expect(states(src({ approvedOn: "2026-12-01" })).notice).toBe("ng")
    expect(states(src({ approvedOn: "2026-12-01", noticeSaved: true })).notice).toBe("ok")
  })
})
