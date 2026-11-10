import { sealExpiryOf } from "./alerts"
import { formatDate, looksLikeCommonId } from "./procedure"
import type { DocType } from "./documents"
import { APPROVAL_KINDS, type ProcedureKind } from "./types"

/**
 * 整合性チェック（研修資料の注意点。要件メモ7章）。アプリのデータで分かるものは自動で、書類を見比べるものは職員が印を付ける
 */

/** 設備（パネル・パワコン）。出力はパネルの合計とパワコンの合計の小さいほう */
export const EQUIPMENT_KINDS = ["panel", "pcs"] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]
export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = { panel: "パネル", pcs: "パワコン" }

export type Equipment = { kind: EquipmentKind; maker: string; model: string; watts: number; count: number }

const total = (items: readonly Equipment[], kind: EquipmentKind) => items.filter((e) => e.kind === kind).reduce((a, e) => a + e.watts * e.count, 0)

/**
 * 発電出力（kW）：パネル1枚の W × 枚数の合計と、パワコンの W × 台数の合計の小さいほうを kW にし、小数第2位で切り捨てる
 * （研修資料：265W×12枚＝3,180W、3,000W×1台＝3,000W → 3.0kW）。どちらかが無ければ求めない
 */
export function outputKwOf(items: readonly Equipment[]): number | null {
  const panel = total(items, "panel")
  const pcs = total(items, "pcs")
  if (panel <= 0 || pcs <= 0) return null
  return Math.floor(Math.min(panel, pcs) / 100) / 10
}

export const equipmentTotals = (items: readonly Equipment[]) => ({ panel: total(items, "panel"), pcs: total(items, "pcs") })

/** 職員が書類を見比べて印を付けるもの */
export const MANUAL_CHECKS = ["names", "site", "output", "battery", "noEmail"] as const
export type ManualCheck = (typeof MANUAL_CHECKS)[number]

export const MANUAL_CHECK_LABELS: Record<ManualCheck, { label: string; hint: string }> = {
  names: { label: "名義が一致", hint: "建築主（確認済証・請負契約・割付図）＝売電契約者（接続契約）＝申請者（申込書・印鑑証明）" },
  site: { label: "設置場所が一致", hint: "確認済証の地番・請負契約・接続契約。地番と住居表示の違いに注意" },
  output: { label: "出力が一致", hint: "割付図・接続契約の出力と、申請に入れる出力" },
  battery: { label: "自家発電設備（蓄電池など）の情報が一致", hint: "蓄電池の有無・押し上げ効果" },
  noEmail: { label: "「事業者のメールアドレスなし」にチェックした", hint: "委任状と印鑑証明で申請するやり方。チェックしないと事業者に承認のメールが行く" },
}

/** 自動のチェックの結果。ok：問題なし、ng：直す、na：まだ分からない（データが無い） */
export type AutoResult = { id: string; label: string; state: "ok" | "ng" | "na"; detail: string }

export type CheckSource = {
  kind: ProcedureKind
  sealCertIssuedOn: string | null
  appliedOn: string | null
  approvedOn: string | null
  noticeSaved: boolean
  case: { commonId: string | null; outputKw: number | null; hasBattery: boolean; sharedOwnership: boolean }
  equipment: readonly Equipment[]
  /** 置いた書類の種類 */
  docTypes: ReadonlySet<DocType>
}

export function autoChecks(p: CheckSource, today: string): AutoResult[] {
  const out: AutoResult[] = []
  const commonId = p.case.commonId

  // 発電設備の名称は「CP＋共通ID」（SHARP の資料）。共通ID がその形なら、そのまま名称に入れる
  out.push(
    !commonId
      ? { id: "facilityName", label: "発電設備の名称", state: "na", detail: "共通ID がまだ無い" }
      : looksLikeCommonId(commonId)
        ? { id: "facilityName", label: "発電設備の名称", state: "ok", detail: `「${commonId}」と入れる` }
        : { id: "facilityName", label: "発電設備の名称", state: "ng", detail: `共通ID「${commonId}」が「CP＋数字」の形ではない` },
  )

  // 出力：パネル・パワコンから求めた出力と、案件の出力
  const computed = outputKwOf(p.equipment)
  out.push(
    computed === null
      ? { id: "outputCalc", label: "出力の計算", state: "na", detail: "パネルとパワコンを入れると求める" }
      : p.case.outputKw === null
        ? { id: "outputCalc", label: "出力の計算", state: "ng", detail: `求めた出力は ${computed.toFixed(1)}kW。案件の出力が空` }
        : p.case.outputKw === computed
          ? { id: "outputCalc", label: "出力の計算", state: "ok", detail: `${computed.toFixed(1)}kW（パネルとパワコンの小さいほう）` }
          : { id: "outputCalc", label: "出力の計算", state: "ng", detail: `求めた出力 ${computed.toFixed(1)}kW と案件の出力 ${p.case.outputKw}kW が違う` },
  )

  // 共有名義なら無償使用の同意書
  if (p.case.sharedOwnership) {
    out.push(
      p.docTypes.has("consent")
        ? { id: "consent", label: "共有名義の同意書", state: "ok", detail: "置いた" }
        : { id: "consent", label: "共有名義の同意書", state: "ng", detail: "共有名義なので無償使用の同意書が要る" },
    )
  }

  // 印鑑証明：申請する日（申請していれば申請日）に発行から3か月以内
  if (!p.sealCertIssuedOn) out.push({ id: "seal", label: "印鑑証明の期限", state: "na", detail: "発行日がまだ無い" })
  else {
    const expiry = sealExpiryOf(p.sealCertIssuedOn)
    const on = p.appliedOn ?? today
    out.push(
      on <= expiry
        ? { id: "seal", label: "印鑑証明の期限", state: "ok", detail: `${formatDate(expiry)} まで${p.appliedOn ? "（申請日に有効）" : ""}` }
        : { id: "seal", label: "印鑑証明の期限", state: "ng", detail: `${formatDate(expiry)} で切れた${p.appliedOn ? "（申請日に切れていた）" : "。取り直しが要る"}` },
    )
  }

  // 認定通知書を保存したか（認定の手続のみ）
  if (APPROVAL_KINDS.has(p.kind) && p.approvedOn) {
    out.push(p.noticeSaved ? { id: "notice", label: "認定通知書", state: "ok", detail: "保存した" } : { id: "notice", label: "認定通知書", state: "ng", detail: "まだ保存していない（ダウンロードは1回だけ）" })
  }
  return out
}
