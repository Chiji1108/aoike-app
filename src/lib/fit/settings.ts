import { z } from "zod"
import { PROCEDURE_KINDS, type ProcedureKind } from "./types"

/**
 * FIT の設定（設定の画面で直す）。D1 の fit_settings に1行で持ち、無い項目はここの初期値を使う
 */

export type FeeTable = { acceptedUntil: string; fees: Record<ProcedureKind, number | null> }

/** 年度（4月〜翌3月。fiscalYear は始まりの年）ごとの、新規・変更認定の受付締切。届出は1年中受付 */
export type FiscalDeadline = { fiscalYear: number; deadline: string }

export type FitSettings = {
  /** 報酬表（税込・円）。acceptedUntil までに受任したものにその表を使う（古い順） */
  feeTables: FeeTable[]
  fiscalDeadlines: FiscalDeadline[]
  /** 印鑑証明の期限まで、この日数を切ったら注意 */
  sealWarnDays: number
  /** 補正の期限まで、この日数を切ったら注意 */
  correctionWarnDays: number
  /** 年度の受付締切まで、この日数を切ったら未申請の認定の手続を出す */
  deadlineWarnDays: number
  /** 受任からこの日数たっても申請していなければ出す */
  stalledAcceptedDays: number
  /** 申請からこの日数たっても認定（完了）がなければ出す */
  stalledAppliedDays: number
  /** 書類の保存期間（帳簿を閉じた年末から何年。行政書士法第9条第2項は2年） */
  retentionYears: number
}

export const DEFAULT_SETTINGS: FitSettings = {
  // 申込書の別紙1（2027-03-31 までに受任時の価格）。その他変更認定は事案ごとなので額が無い（手で入れる）
  feeTables: [{ acceptedUntil: "2027-03-31", fees: { new: 11_000, pre_change: 5_500, post_change: 5_500, change_approval: 5_500, other_change: null } }],
  // 研修資料：令和8年度の太陽光（10kW 未満）の新規・変更認定の申請期限
  fiscalDeadlines: [{ fiscalYear: 2026, deadline: "2027-01-05" }],
  sealWarnDays: 14,
  correctionWarnDays: 7,
  deadlineWarnDays: 30,
  stalledAcceptedDays: 30,
  stalledAppliedDays: 60,
  retentionYears: 2,
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形が違います")
const days = z.number().int("日数は整数で入れてください").min(1, "1日以上にしてください").max(365, "365日以内にしてください")

export const settingsSchema = z.object({
  feeTables: z
    .array(
      z.object({
        acceptedUntil: isoDate,
        fees: z.object(Object.fromEntries(PROCEDURE_KINDS.map((k) => [k, z.number().int("報酬は整数の円で入れてください").min(0, "報酬は0円以上にしてください").max(10_000_000, "報酬が大きすぎます").nullable()])) as Record<ProcedureKind, z.ZodNullable<z.ZodNumber>>),
      }),
    )
    .min(1, "報酬表を1つ以上入れてください")
    .max(20),
  fiscalDeadlines: z.array(z.object({ fiscalYear: z.number().int("年度は西暦の数字で入れてください").min(2020, "年度は西暦（2020年以降）で入れてください").max(2100, "年度が大きすぎます"), deadline: isoDate })).max(50),
  sealWarnDays: days,
  correctionWarnDays: days,
  deadlineWarnDays: days,
  stalledAcceptedDays: days,
  stalledAppliedDays: days,
  retentionYears: z.number().int("保存期間は整数の年で入れてください").min(1, "保存期間は1年以上にしてください").max(20, "保存期間は20年以内にしてください"),
})

/** 保存してある値に、無い項目の初期値を足す（あとで設定の項目を増やしても、前の行のまま読める）。報酬表・締切は日付の順にそろえる */
export function withDefaults(saved: Partial<FitSettings> | null | undefined): FitSettings {
  const s = { ...DEFAULT_SETTINGS, ...saved }
  return {
    ...s,
    feeTables: [...s.feeTables].sort((a, b) => a.acceptedUntil.localeCompare(b.acceptedUntil)),
    fiscalDeadlines: [...s.fiscalDeadlines].sort((a, b) => a.fiscalYear - b.fiscalYear),
  }
}

/** 受任日の報酬表の額。表が無い（期間の外）か、事案ごとの区分なら null */
export function feeFor(kind: ProcedureKind, acceptedOn: string, tables: readonly FeeTable[]): number | null {
  const table = tables.find((t) => acceptedOn <= t.acceptedUntil)
  return table?.fees[kind] ?? null
}

/** 日付の年度（4月始まり。始まりの年） */
export const fiscalYearOf = (iso: string) => {
  const y = Number(iso.slice(0, 4))
  return Number(iso.slice(5, 7)) >= 4 ? y : y - 1
}
