import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { CLOSE_REASONS, DEFECT_KINDS, DEFECT_PARTIES, PROCEDURE_KINDS, SITE_ADDRESS_KINDS, SPECIAL_PAYERS } from "../lib/fit/types"
import { createdAt, updatedAt } from "./auth-schema"

/**
 * FIT 申請の D1（FIT_DB）。このアプリが FIT 案件の事件簿（行政書士法第9条の帳簿）なので、案件と手続は消さない
 * （途中で終わった手続は「取下げ」「中止」で残す）。日付は YYYY-MM-DD の文字列
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

/** 案件（1つの発電設備＝お客様＋設置場所＋共通ID） */
export const fitCases = sqliteTable(
  "fit_cases",
  {
    id: id(),
    /** COCORO POWER の共通ID（SHARP 側の主キー）。申込書に無ければあとから入れる。桁数は決め打ちせず受け取ったまま */
    commonId: text("common_id"),
    name: text("name").notNull(),
    kana: text("kana").default("").notNull(),
    /** 現住所（または仮住まい） */
    postalCode: text("postal_code").default("").notNull(),
    address: text("address").default("").notNull(),
    phone: text("phone").default("").notNull(),
    email: text("email").default("").notNull(),
    /** 設置場所 */
    sitePostalCode: text("site_postal_code").default("").notNull(),
    siteAddress: text("site_address").default("").notNull(),
    siteKana: text("site_kana").default("").notNull(),
    /** 設置場所を地番・住居表示のどちらで書いたか */
    siteAddressKind: text("site_address_kind", { enum: SITE_ADDRESS_KINDS }),
    /** 住宅会社（ビルダー） */
    builder: text("builder").default("").notNull(),
    /** 発電出力（kW） */
    outputKw: real("output_kw"),
    /** 蓄電池などの自家発電設備があるか */
    hasBattery: integer("has_battery", { mode: "boolean" }).default(false).notNull(),
    /** 建物が共有名義か（共有なら無償使用の同意書が要る） */
    sharedOwnership: integer("shared_ownership", { mode: "boolean" }).default(false).notNull(),
    note: text("note").default("").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 共通ID は案件ごとに1つ（まだ無い案件はいくつあってもよい。sqlite の一意の索引は NULL を比べない）
  (t) => [uniqueIndex("fit_cases_common_id_uq").on(t.commonId)],
)

/**
 * 手続（案件に対する1回の申請・届出）。SHARP の週次の案件表の1行。事件簿の番号（F8-0001）は受付時に付け、変えない。
 * 受任日は申込書と委任状がそろった日（遅いほう）なので持たずに求める（src/lib/fit/procedure.ts）
 */
export const fitProcedures = sqliteTable(
  "fit_procedures",
  {
    id: id(),
    caseId: text("case_id")
      .notNull()
      .references(() => fitCases.id),
    /** 事件簿の年（受付日の年）とその年の通し番号 */
    bookYear: integer("book_year").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: PROCEDURE_KINDS }).notNull(),
    /** 申込書の受付日（案件表の「青池様受付日」） */
    receivedOn: text("received_on").notNull(),
    /** 委任状の受付日 */
    poaReceivedOn: text("poa_received_on"),
    /** 変更系の告知日・お客様の回答日（告知日から7日たてば了承とみなす） */
    noticeOn: text("notice_on"),
    answeredOn: text("answered_on"),
    /** 印鑑証明の発行日（申請時点で発行から3か月以内） */
    sealCertIssuedOn: text("seal_cert_issued_on"),
    /** 報酬額（税込・円）。受任したときの報酬表の額で決め、あとで報酬表が変わっても動かさない */
    fee: integer("fee"),
    /** 特殊対応（規約第4・5条） */
    special: integer("special", { mode: "boolean" }).default(false).notNull(),
    specialAmount: integer("special_amount"),
    specialPayer: text("special_payer", { enum: SPECIAL_PAYERS }),
    specialNotifiedOn: text("special_notified_on"),
    specialAnsweredOn: text("special_answered_on"),
    /** 保留（規約第5条） */
    onHold: integer("on_hold", { mode: "boolean" }).default(false).notNull(),
    holdReason: text("hold_reason").default("").notNull(),
    /** 電子申請 */
    appliedOn: text("applied_on"),
    applicationId: text("application_id").default("").notNull(),
    /** 認定日（変更系は完了日） */
    approvedOn: text("approved_on"),
    facilityId: text("facility_id").default("").notNull(),
    businessId: text("business_id").default("").notNull(),
    /** 認定通知書を保存したか（1回しかダウンロードできない） */
    noticeSaved: integer("notice_saved", { mode: "boolean" }).default(false).notNull(),
    /** お客様への完了通知日（請求の月を決める日） */
    completedOn: text("completed_on"),
    /** 請求書（侍で作る）の発行日と番号 */
    invoicedOn: text("invoiced_on"),
    invoiceNumber: text("invoice_number").default("").notNull(),
    paidOn: text("paid_on"),
    /** 途中で終わった理由（取下げ・中止）。最後まで進んだものは持たない */
    closeReason: text("close_reason", { enum: CLOSE_REASONS }),
    note: text("note").default("").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("fit_procedures_number_uq").on(t.bookYear, t.seq), index("fit_procedures_case_idx").on(t.caseId)],
)

/** 不備・補正（手続ごとにいくつでも） */
export const fitDefects = sqliteTable(
  "fit_defects",
  {
    id: id(),
    procedureId: text("procedure_id")
      .notNull()
      .references(() => fitProcedures.id),
    kind: text("kind", { enum: DEFECT_KINDS }).notNull(),
    /** 案件表の「不備内容」に出す */
    content: text("content").notNull(),
    /** 連絡を受けた日と期限（補正の期限は通知に書かれた日） */
    receivedOn: text("received_on"),
    dueOn: text("due_on"),
    requestedTo: text("requested_to", { enum: DEFECT_PARTIES }),
    resolvedOn: text("resolved_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("fit_defects_procedure_idx").on(t.procedureId)],
)

/**
 * SHARP への週次の案件表を出した記録。そのときの各行（手続 id → 列の値）を持ち、次に出すときに「前回から変わったセル」に印を付ける
 */
export const fitWeeklyReports = sqliteTable("fit_weekly_reports", {
  id: id(),
  /** 手続 id → 案件表の列の値（JSON） */
  rows: text("rows", { mode: "json" }).$type<Record<string, (string | null)[]>>().notNull(),
  createdAt: createdAt(),
})

export type FitCase = typeof fitCases.$inferSelect
export type FitProcedure = typeof fitProcedures.$inferSelect
export type FitDefect = typeof fitDefects.$inferSelect
