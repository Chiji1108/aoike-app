import { z } from "zod"
import { RULE7_TAX_LABELS, type Rule7Tax } from "../convert/koji-selection"
import { rule7TaxSchema } from "../schemas"

export { RULE7_TAX_LABELS, rule7TaxSchema, type Rule7Tax }

/**
 * 全体ルール・顧客ルール（どちらも1つの文章。D1 の csv_settings.rules・csv_customers.rules）。AI にはそのまま渡す。
 * 職員は画面で文章ごと直し、チャットの propose_rule の案は承認すると文章の最後に「- 」の1行として足す（appendRule）。
 * 決まった処理が守ること（字数の検査・7割で載せる件数・半角カナ・氏名の空白）と AI への固定の指示（分からないことは問い合わせに回す）は
 * ここに書かない（lib/chat/turn.ts の systemPrompt）。7割の計算の税抜・税込は文章でなく事務所の設定（csv_settings.rule7_tax）
 */

/** ルールの種類（全体ルール・顧客ルール） */
export const RULE_SCOPES = ["global", "customer"] as const
export type RuleScope = (typeof RULE_SCOPES)[number]
export const ruleScopeSchema = z.enum(RULE_SCOPES)
/** どのルールか（顧客ルールは顧客ごと） */
export type RuleTarget = { scope: "global" } | { scope: "customer"; customerId: string }

/** ルールの文章と版（version は保存するたびに上がる。2つの画面で直したときに後の保存を断る） */
export type Rules = { text: string; version: number }

/** ルールの文章の字数の上限と、チャットの案で足す1行の字数の上限 */
export const MAX_RULES_TOTAL = 20_000
export const MAX_RULE_LINE_LENGTH = 1_000

/** 字数（文字の数。D1 の length() と同じ数え方で、サロゲートペアの「𠮷」も1字） */
export const charCount = (s: string) => [...s].length

/** ルールの文章（改行は LF にそろえ、前後の空白を取る。空でもよい） */
export const rulesTextSchema = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().refine((s) => charCount(s) <= MAX_RULES_TOTAL, `ルールは${MAX_RULES_TOTAL.toLocaleString("ja-JP")}字までです`))

/** チャットの案で足す1行（前後の空白を取り、改行は空白にする） */
export const ruleLineSchema = z
  .string()
  .transform((s) => s.replace(/\s*[\r\n]+\s*/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "空の行は足せません")
      .refine((s) => charCount(s) <= MAX_RULE_LINE_LENGTH, `1行は${MAX_RULE_LINE_LENGTH.toLocaleString("ja-JP")}字までです`),
  )

/** 文章の最後に「- 」の1行として足す（D1 の appendRuleOnce と同じ足し方） */
export const appendRule = (text: string, line: string) => (text ? `${text}\n- ${line}` : `- ${line}`)

/**
 * 全体ルールの初期値（事務所のやり方）。全体ルールを保存したことが無い D1 にはマイグレーション 0004 が入れ、0009・0010 が今の文に直し、
 * 0014 が1つの文章にする（テストで同じか確かめる）
 */
export const DEFAULT_GLOBAL_RULES = [
  "字数を超えたときの縮め方の順: 空白を取る → 株式会社を㈱・有限会社を㈲ → 法人格を省く → それでも長ければ職員に聞く。工事名は末尾の「に伴う〇〇工事」を残し、前の部分を縮める。",
  "完成年月は顧客の指定に従う（引渡日が多い）。",
  "工事名は場所と内容が分かるようにする。",
  "工事名の「(仮称)」と、丁寧の「ご」（「ご自宅改修」の「ご」。「ごみ処理施設」のように語の一部なら取らない）を取る。途中や末尾にある【支店名】のような補足は先頭に移す（括弧を外すかは顧客の指定に従う）。",
  "配置技術者は氏名だけにする（社員番号などの接頭辞「83：」は取る）。",
].reduce(appendRule, "")
