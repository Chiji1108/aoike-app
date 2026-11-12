import { describe, expect, test } from "vitest"
import { editKey, type CellEdits } from "../../convert/convert"
import { finalizeAll as finalizeWithLetters, kojiRow } from "../../convert/__tests__/helpers"
import { withGyoshuWorkName } from "../work-name"

describe("工事名の業種の言葉", () => {
  test("末尾の「工事」を取って「に伴う〇〇工事」を付ける。工事で終わらない名前はそのまま後ろに付ける", () => {
    expect(withGyoshuWorkName("架空ビル新築工事", "9")).toBe("架空ビル新築に伴う管工事")
    expect(withGyoshuWorkName("架空倉庫照明設置", "8")).toBe("架空倉庫照明設置に伴う電気工事")
    expect(withGyoshuWorkName("架空店舗改装", "5")).toBe("架空店舗改装に伴うとび・土工・コンクリート工事")
    expect(withGyoshuWorkName("工事", "19")).toBe("内装仕上工事")
  })

  test("もうその業種の工事の名で終わる名前（別名を含む）はそのまま", () => {
    expect(withGyoshuWorkName("架空ビル管工事", "9")).toBe("架空ビル管工事")
    expect(withGyoshuWorkName("架空ビル配管工事", "9")).toBe("架空ビル配管工事")
    expect(withGyoshuWorkName("架空ビル内装工事", "19")).toBe("架空ビル内装工事")
    // 別の業種の工事の名で終わるときは付ける
    expect(withGyoshuWorkName("架空ビル電気工事", "22")).toBe("架空ビル電気に伴う電気通信工事")
  })

  test("何度当てても同じ。業種を選び直すと付け替わり、付けない行では手直しの値に付いたままの言葉だけ「工事」に戻す", () => {
    const once = withGyoshuWorkName("架空ビル新築工事", "9")
    expect(withGyoshuWorkName(once, "9")).toBe(once)
    expect(withGyoshuWorkName(once, "8")).toBe("架空ビル新築に伴う電気工事")
    expect(withGyoshuWorkName(once, "2", true)).toBe("架空ビル新築工事")
    expect(withGyoshuWorkName(once, undefined, true)).toBe("架空ビル新築工事")
    // 元データの値は顧客の書いたまま（一式の行の「〜に伴う電気工事」を書き換えない）
    expect(withGyoshuWorkName(once, "2")).toBe(once)
    // 顧客が先に「に伴う」の形で書いた名前も同じ形になる
    expect(withGyoshuWorkName("架空ビル新築工事に伴う管工事", "9")).toBe("架空ビル新築に伴う管工事")
  })

  test("土木一式・建築一式・その他・コードでない値・空の工事名には付けない", () => {
    for (const code of ["1", "2", "30", "", "31", "管", undefined]) expect(withGyoshuWorkName("架空ビル新築工事", code)).toBe("架空ビル新築工事")
    expect(withGyoshuWorkName("", "9")).toBe("")
  })
})

describe("表の工事名（applyEdits の shapeRules）", () => {
  const finalizeAll = (...args: Parameters<typeof finalizeWithLetters>) => finalizeWithLetters(...args).rows
  const base = { motoukeShitauke: "1", prefecture: "東京都", amount: "1000", workName: "架空ビル新築工事" }

  test("業種が決まった行は付け、変換の印と理由を残す。推定・エラーの業種の行には付けない", () => {
    const decided = kojiRow({ ...base, gyoshu: "9" }, 1)
    const guessed = kojiRow({ ...base, gyoshu: "9" }, 2)
    guessed.cells.gyoshu = { ...guessed.cells.gyoshu, status: "warning", guessed: true }
    const invalid = kojiRow({ ...base, gyoshu: "99" }, 3)
    invalid.cells.gyoshu = { ...invalid.cells.gyoshu, status: "error" }
    const [a, b, c] = finalizeAll([decided, guessed, invalid])
    expect(a!.cells.workName).toMatchObject({ value: "架空ビル新築に伴う管工事", status: "changed", message: "業種の言葉を付けた" })
    expect(b!.cells.workName.value).toBe("架空ビル新築工事")
    expect(c!.cells.workName.value).toBe("架空ビル新築工事")
  })

  test("職員の手直しの値（付いた形のまま・付けずに書いた値）にも同じ形で付き、業種の手直しで付け替わる", () => {
    const row = kojiRow({ ...base, gyoshu: "9" }, 1)
    const withSuffix: CellEdits = new Map([[editKey("s!1", "workName"), { value: "架空ビル改修に伴う管工事", by: "staff" }]])
    expect(finalizeAll([row], { edits: withSuffix })[0]!.cells.workName.value).toBe("架空ビル改修に伴う管工事")
    const plain: CellEdits = new Map([[editKey("s!1", "workName"), { value: "架空ビル改修工事", by: "staff" }]])
    expect(finalizeAll([row], { edits: plain })[0]!.cells.workName).toMatchObject({ value: "架空ビル改修に伴う管工事", status: "changed" })
    const regyoshu: CellEdits = new Map([...withSuffix, [editKey("s!1", "gyoshu"), { value: "8", by: "staff" }]])
    expect(finalizeAll([row], { edits: regyoshu })[0]!.cells.workName.value).toBe("架空ビル改修に伴う電気工事")
    // 業種が推定に変わったら、手直しの値に付いたままの言葉を外す
    const unsure: CellEdits = new Map([...withSuffix, [editKey("s!1", "gyoshu"), { value: "8", by: "chat", status: "warning", guessed: true }]])
    expect(finalizeAll([row], { edits: unsure })[0]!.cells.workName).toMatchObject({ value: "架空ビル改修工事", message: expect.stringContaining("業種の言葉を外した") })
  })

  test("付けて建設業.NET の字数（51字）を超えたら、字数の上限のエラーにする（職員が縮める）", () => {
    const row = kojiRow({ ...base, gyoshu: "9", workName: `${"架".repeat(46)}工事` }, 1)
    const cell = finalizeAll([row])[0]!.cells.workName
    expect(cell.value).toBe(`${"架".repeat(46)}に伴う管工事`)
    expect(cell).toMatchObject({ status: "error", message: expect.stringContaining("字数が上限") })
  })
})
