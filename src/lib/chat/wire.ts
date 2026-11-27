import { z } from "zod"
import type { CellResult, RowResult } from "../convert/convert"
import { basisSchema, cellEditSchema, fieldIdSchema, replacementsSchema, roundingSchema, rule7TaxSchema, selectionSchema, taxSchema } from "../schemas"
import type { CaseTable } from "../cases/view"
import { addedRowSchema, MAX_ADDED_ROWS } from "../cases/added"
import { inquiryTextSchema } from "../inquiry/text"
import type { KojiFieldId } from "../spec/koji-keireki"

/** 画面からチャットのサーバーへ送る案件の表（CaseTable の Map を組の配列にしたもの） */
export type CaseTableWire = Omit<CaseTable, "rows" | "edits" | "manual" | "dismissed"> & {
  rows: RowResult<KojiFieldId>[]
  edits: [string, z.infer<typeof cellEditSchema>][]
  manual: [string, boolean][]
  dismissed: string[]
}

export const toWire = (t: CaseTable): CaseTableWire => ({ ...t, rows: [...t.rows], edits: [...t.edits], manual: [...t.manual], dismissed: [...t.dismissed] })
export const fromWire = (w: CaseTableWire): CaseTable => ({ ...w, edits: new Map(w.edits), manual: new Map(w.manual), dismissed: new Set(w.dismissed) })

const cellResult: z.ZodType<CellResult> = z.object({
  value: z.string(),
  status: z.enum(["ok", "changed", "ai", "warning", "error"]),
  source: z.string(),
  original: z.string(),
  message: z.string().optional(),
  guessed: z.literal(true).optional(),
  byAi: z.literal(true).optional(),
  stored: z.string().optional(),
  withheld: z.literal(true).optional(),
  by: z.enum(["staff", "customer", "confirmed", "chat", "location"]).optional(),
  ask: z.literal(true).optional(),
})

const row: z.ZodType<RowResult<KojiFieldId>> = z.object({
  key: z.string(),
  sheet: z.string(),
  row: z.number().int(),
  excluded: z.string().optional(),
  cells: z.record(fieldIdSchema, cellResult),
})

export const caseTableWireSchema: z.ZodType<CaseTableWire> = z.object({
  rows: z.array(row).max(20_000),
  added: z.array(addedRowSchema).max(MAX_ADDED_ROWS),
  edits: z.array(z.tuple([z.string(), cellEditSchema])),
  replacements: replacementsSchema,
  manual: z.array(z.tuple([z.string(), z.boolean()])),
  tax: taxSchema,
  basis: basisSchema,
  rule7Tax: rule7TaxSchema,
  selection: selectionSchema,
  /** 「答える」の載せる工事に答えたか */
  selectionAnswered: z.boolean(),
  /** 金額の千円未満の扱い */
  rounding: roundingSchema,
  /** 外した問い合わせと問い合わせのメールの件名・前置き */
  dismissed: z.array(z.string().max(300)).max(50_000),
  inquiryText: inquiryTextSchema,
})
