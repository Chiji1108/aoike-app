import type { FitCase } from "@/db/fit-schema"
import { looksLikeCommonId } from "@/lib/fit/procedure"
import { SITE_ADDRESS_KIND_LABELS, type SiteAddressKind } from "@/lib/fit/types"
import { CheckField, SelectField, TextField, TextareaField, numberOrNull, optionsOf } from "./fields"

/** 案件の欄（新しい申込の受付と、案件の編集で同じものを使う） */
export type CaseValues = {
  commonId: string
  name: string
  kana: string
  postalCode: string
  address: string
  phone: string
  email: string
  sitePostalCode: string
  siteAddress: string
  siteKana: string
  siteAddressKind: SiteAddressKind | ""
  builder: string
  outputKw: string
  hasBattery: boolean
  sharedOwnership: boolean
  note: string
}

export function caseValues(c?: FitCase): CaseValues {
  return {
    commonId: c?.commonId ?? "",
    name: c?.name ?? "",
    kana: c?.kana ?? "",
    postalCode: c?.postalCode ?? "",
    address: c?.address ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    sitePostalCode: c?.sitePostalCode ?? "",
    siteAddress: c?.siteAddress ?? "",
    siteKana: c?.siteKana ?? "",
    siteAddressKind: c?.siteAddressKind ?? "",
    builder: c?.builder ?? "",
    outputKw: c?.outputKw == null ? "" : String(c.outputKw),
    hasBattery: c?.hasBattery ?? false,
    sharedOwnership: c?.sharedOwnership ?? false,
    note: c?.note ?? "",
  }
}

/** 保存する形（サーバーで空の共通ID は「まだ無い」にする） */
export function caseInput(v: CaseValues) {
  return { ...v, siteAddressKind: v.siteAddressKind || null, outputKw: numberOrNull(v.outputKw) }
}

export function CaseFields({ values, set }: { values: CaseValues; set: <K extends keyof CaseValues>(key: K, value: CaseValues[K]) => void }) {
  const commonId = values.commonId.trim()
  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="COCORO POWER 共通ID"
          value={values.commonId}
          onChange={(v) => set("commonId", v)}
          placeholder="CP…"
          testId="fit-common-id"
          hint={commonId && !looksLikeCommonId(commonId) ? <span className="text-amber-700 dark:text-amber-400">「CP＋数字」の形ではありません（このまま保存できます）</span> : "申込書の「お客様番号」。まだ無ければ空のまま"}
        />
        <TextField label="ビルダー（住宅会社）" value={values.builder} onChange={(v) => set("builder", v)} testId="fit-builder" />
        <TextField label="お客様の氏名" value={values.name} onChange={(v) => set("name", v)} testId="fit-name" />
        <TextField label="フリガナ" value={values.kana} onChange={(v) => set("kana", v)} testId="fit-kana" />
        <TextField label="電話" type="tel" value={values.phone} onChange={(v) => set("phone", v)} />
        <TextField label="メール" type="email" value={values.email} onChange={(v) => set("email", v)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <TextField label="現住所の郵便番号" value={values.postalCode} onChange={(v) => set("postalCode", v)} />
        <TextField label="現住所（または仮住まい）" value={values.address} onChange={(v) => set("address", v)} hint="設置場所と違えば、あとで事後変更届になりやすい" />
        <TextField label="設置場所の郵便番号" value={values.sitePostalCode} onChange={(v) => set("sitePostalCode", v)} />
        <TextField label="設置場所" value={values.siteAddress} onChange={(v) => set("siteAddress", v)} testId="fit-site-address" />
        <SelectField label="設置場所の書き方" value={values.siteAddressKind} onChange={(v) => set("siteAddressKind", v)} options={optionsOf(SITE_ADDRESS_KIND_LABELS)} empty="—" testId="fit-site-kind" />
        <TextField label="設置場所のフリガナ" value={values.siteKana} onChange={(v) => set("siteKana", v)} hint={values.siteAddressKind === "lot" ? "地番で申請したら、住居表示が決まったときに事前変更届" : undefined} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <TextField label="発電出力（kW）" type="number" value={values.outputKw} onChange={(v) => set("outputKw", v)} />
        <CheckField label="蓄電池などあり" checked={values.hasBattery} onChange={(v) => set("hasBattery", v)} />
        <CheckField label="建物が共有名義" checked={values.sharedOwnership} onChange={(v) => set("sharedOwnership", v)} />
      </section>

      <TextareaField label="備考" value={values.note} onChange={(v) => set("note", v)} />
    </div>
  )
}
