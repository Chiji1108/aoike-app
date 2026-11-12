import { GYOSHU } from "./code-sets"

/**
 * 工事名の末尾の業種の言葉（顧客の頼み: 工事名は「〜に伴う管工事」の形で、その工事の業種が分かるようにする）。
 * 業種の工事の名は建設業法の業種の名に「工事」（管 → 管工事、とび・土工・コンクリート → とび・土工・コンクリート工事）。
 * 土木一式・建築一式（1・2）は工事そのものが新築・造成などで「〜に伴う」が合わず、その他（30）は業種の名にならないので付けない
 */
const NO_WORK_NAME = new Set(["1", "2", "30"])
const named = GYOSHU.filter((g) => !NO_WORK_NAME.has(g.code))

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** 前に付けた業種の言葉（業種を選び直したとき・手直しで付いたまま書いたときに外す） */
const ADDED_RE = new RegExp(`に伴う(?:${named.map((g) => escapeRe(g.label)).join("|")})工事$`)

/** 業種の言葉（「に伴う〇〇工事」）で終わるか */
export const endsWithGyoshuWords = (name: string) => ADDED_RE.test(name)

/** 業種の工事の名の一覧（知っている語に入れる） */
export const GYOSHU_WORK_LABELS: readonly string[] = named.map((g) => `${g.label}工事`)


/**
 * 工事名の末尾に業種の言葉を付ける（「〇〇ビル新築工事」+ 管 → 「〇〇ビル新築に伴う管工事」、「〜設置」→「〜設置に伴う電気工事」）。
 * code は決まった業種コード（推定・エラー・空なら undefined）。edited は手直しで入れた値か（画面の付いた形を写して直した値かもしれない）
 * - 前に付けた「に伴う〇〇工事」は外してから付ける（何度当てても同じ。業種を選び直すと付け替わる）
 * - もうその業種の工事の名で終わる名前（「〇〇ビル管工事」「〇〇内装工事」〔内装仕上の別名〕）はそのまま
 * - 末尾の「工事」は取ってからつなぐ（「新築工事に伴う」にしない）
 * - 付けない行（一式・その他・業種が決まっていない）は、手直しの値に付いたままの言葉だけ「工事」に戻す
 *   （「〇〇新築に伴う管工事」→「〇〇新築工事」）。元データの値は顧客の書いたまま
 * - 空の工事名はそのまま
 */
export function withGyoshuWorkName(name: string, code: string | undefined, edited = false): string {
  const g = code === undefined ? undefined : named.find((x) => x.code === code)
  if (!g) return edited ? name.replace(ADDED_RE, "工事") : name
  if (name === "") return name
  const base = name.replace(ADDED_RE, "")
  if ([g.label, ...g.aliases].some((w) => base.endsWith(`${w}工事`))) return base
  const head = base.replace(/工事$/, "")
  return head === "" ? `${g.label}工事` : `${head}に伴う${g.label}工事`
}
