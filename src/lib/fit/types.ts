/**
 * FIT 申請（SHARP から受託する住宅用太陽光 10kW 未満の事業計画認定申請の代行）の決まった値と、その表示名。
 * 型と定義表だけなので、スキーマ・サーバー・画面のどこからでも読める
 */

/** 申請区分（申込書の報酬表の区分） */
export const PROCEDURE_KINDS = ["new", "pre_change", "post_change", "change_approval", "other_change"] as const
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number]

export const PROCEDURE_KIND_LABELS: Record<ProcedureKind, string> = {
  new: "新規認定",
  pre_change: "事前変更届",
  post_change: "事後変更届",
  change_approval: "変更認定",
  other_change: "その他変更認定",
}

/** 変更系（申請前に、どの区分で受任するかをお客様に告知する区分。申込書の報酬表） */
export const NOTICE_KINDS: ReadonlySet<ProcedureKind> = new Set(["pre_change", "post_change", "change_approval"])

/** 認定の手続（認定通知書が届く。届出は届かない）。認定通知書を保存してからでないと完了通知に進めない */
export const APPROVAL_KINDS: ReadonlySet<ProcedureKind> = new Set(["new", "change_approval", "other_change"])

/** 設置場所の書き方（地番で申請したものは、住居表示が決まったら事前変更届の候補） */
export const SITE_ADDRESS_KINDS = ["lot", "residence"] as const
export type SiteAddressKind = (typeof SITE_ADDRESS_KINDS)[number]
export const SITE_ADDRESS_KIND_LABELS: Record<SiteAddressKind, string> = { lot: "地番", residence: "住居表示" }

/** 特殊対応の報酬の負担者（規約第4・5条） */
export const SPECIAL_PAYERS = ["sharp", "customer"] as const
export type SpecialPayer = (typeof SPECIAL_PAYERS)[number]
export const SPECIAL_PAYER_LABELS: Record<SpecialPayer, string> = { sharp: "SHARP", customer: "お客様" }

/** 途中で終わった手続の理由（最後まで進んだもの＝入金まで済んだものは「完了」で、理由は持たない） */
export const CLOSE_REASONS = ["withdrawn", "cancelled"] as const
export type CloseReason = (typeof CLOSE_REASONS)[number]
export const CLOSE_REASON_LABELS: Record<CloseReason, string> = { withdrawn: "取下げ", cancelled: "中止" }

/** 不備・補正の種類 */
export const DEFECT_KINDS = ["before", "after"] as const
export type DefectKind = (typeof DEFECT_KINDS)[number]
export const DEFECT_KIND_LABELS: Record<DefectKind, string> = { before: "申請前の書類不足", after: "申請後の補正" }

/** 不備・補正の対応を頼んだ相手 */
export const DEFECT_PARTIES = ["customer", "sharp", "builder"] as const
export type DefectParty = (typeof DEFECT_PARTIES)[number]
export const DEFECT_PARTY_LABELS: Record<DefectParty, string> = { customer: "お客様", sharp: "SHARP", builder: "ビルダー" }
