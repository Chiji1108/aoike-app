import { z } from "zod"
import type { CellEdit, Replacements } from "./convert/convert"
import { ROUNDINGS, type Rounding } from "./convert/transforms"
import { RULE7_TAXES, SELECTION_MODES, type Basis, type Rule7Tax, type SelectionMode, type TaxMode } from "./convert/koji-selection"
import { KOJI_KEIREKI, type KojiFieldId } from "./spec/koji-keireki"

/**
 * 保存・送受信する値の形のうち、いくつもの形で使うもの（案件の作業・変更案・チャットの表）。
 * ほかのモジュールに依らない（型と定義表だけ）ので、どこからでも読める
 */

export const fieldIdSchema = z.enum(KOJI_KEIREKI.fields.map((f) => f.id) as [KojiFieldId, ...KojiFieldId[]])

export const taxSchema: z.ZodType<TaxMode> = z.enum(["unknown", "included", "excluded"])

export const rule7TaxSchema: z.ZodType<Rule7Tax> = z.enum(RULE7_TAXES)

export const selectionSchema: z.ZodType<SelectionMode> = z.enum(SELECTION_MODES)

/** 金額の千円未満の扱い（切り捨て・四捨五入） */
export const roundingSchema: z.ZodType<Rounding> = z.enum(ROUNDINGS)

export const basisSchema: z.ZodType<Basis> = z.record(z.string(), z.object({ total: z.number().optional(), motouke: z.number().optional() }))

export const cellEditSchema: z.ZodType<CellEdit> = z.object({
  value: z.string(),
  by: z.enum(["staff", "customer", "confirmed", "chat", "location"]),
  status: z.enum(["ai", "warning", "error"]).optional(),
  message: z.string().optional(),
  guessed: z.literal(true).optional(),
  byAi: z.literal(true).optional(),
  ask: z.literal(true).optional(),
})

export const replacementsSchema: z.ZodType<Replacements<KojiFieldId>> = z.partialRecord(fieldIdSchema, z.record(z.string(), cellEditSchema))
