import type { addressCache } from "@/lib/convert/address"
import { addressKey } from "@/lib/convert/address"
import { convertRows, resolveRows, type RowResult } from "@/lib/convert/convert"
import { addressInputs } from "@/lib/convert/pipeline"
import { collectSourceRows, sourceKey } from "@/lib/convert/sources"
import type { SheetGrid } from "@/lib/convert/plan"
import type { Rounding } from "@/lib/convert/transforms"
import { personLetters } from "@/lib/convert/persons"
import type { Inclusion } from "@/lib/convert/koji-selection"
import { editRows, orderAndFinalize, selectRows } from "@/lib/cases/view"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"
import type { CaseState } from "./create-case-store"

const SPEC = KOJI_KEIREKI
const NO_LETTERS = personLetters([])
const NO_INCLUSION: ReadonlyMap<string, Inclusion> = new Map()
const NO_ROWS: RowResult<KojiFieldId>[] = []

/** 入力（引数）が前と同じ参照なら前の結果を返す（今の useMemo と同じ。1つだけ覚える） */
export function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; out: R } | null = null
  return (...args) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => Object.is(a, args[i]))) return last.out
    const out = fn(...args)
    last = { args, out }
    return out
  }
}

/**
 * 案件の表（変換の鎖）を作る派生を、ストアごとに作る（変換し直す間の前の行を覚えるので、ストアの間で取り合わない）。
 * 各段は入力の参照で1つだけ覚える（前の useMemo と同じ依存）。同じ状態なら同じ結果（同じ参照）を返すので、描画の selector でも action でも読める。
 * 住所は addresses（ストアごとの住所のキャッシュ）が今の値をすべて見せられるまで null（表を作らない）
 */
export function createTableDerive(addresses: ReturnType<typeof addressCache>) {
  const sourcesOf = memoLast((source: CaseState["runtime"]["source"], plan: TablePlan | null) => (source && plan ? collectSourceRows(source.sheets, plan) : null))
  const addressValuesOf = memoLast((sources: Sources | null, plan: TablePlan | null) => (sources && plan ? addressInputs(SPEC, sources.rows, plan) : null))
  const addressSigOf = memoLast((values: string[] | null) => (values ? [...new Set(values.map(addressKey))].sort().join("\n") : null))
  // 住所の値の集まり（sig）か引いた住所が変わったときだけ見直す
  const addressesOf = memoLast((_sig: string | null, _book: CaseState["runtime"]["addressBook"], values: string[] | null) => (values ? (addresses.covering(values) ?? null) : null))
  const ctxOf = memoLast((book: ReturnType<typeof addressesOf>, rounding: Rounding) => (book ? { rounding, addresses: book } : null))
  const draftsOf = memoLast((sources: Sources | null, plan: TablePlan | null, ctx: ReturnType<typeof ctxOf>) => (sources && plan && ctx ? convertRows(SPEC, sources.rows, plan, ctx) : []))
  const freshRowsOf = memoLast(
    (sourceFileId: string | null, converted: boolean, sources: Sources | null, ctx: ReturnType<typeof ctxOf>, drafts: ReturnType<typeof draftsOf>, aiCache: CaseState["work"]["aiCache"]) => {
      if (!sourceFileId) return NO_ROWS
      return converted && sources && ctx ? resolveRows(drafts, aiCache) : null
    },
  )
  /** 変換し直している間は、前の変換の行を見せたままにする（表が消えない。触れないように覆う） */
  let lastRows: RowResult<KojiFieldId>[] | null = null
  const unmarkedOf = memoLast((sources: Sources | null, ctx: ReturnType<typeof ctxOf>, drafts: ReturnType<typeof draftsOf>) =>
    sources && ctx ? sources.rows.length - new Set(drafts.map((d) => sourceKey(d))).size : 0,
  )
  const roundingTotalsOf = memoLast((sources: Sources | null, plan: TablePlan | null, book: ReturnType<typeof addressesOf>) => {
    if (!sources || !plan || !book) return null
    const total = (r: Rounding) =>
      convertRows(SPEC, sources.rows, plan, { rounding: r, addresses: book }).reduce((s, d) => {
        const c = d.cells.amount
        return s + (!d.excluded && c.kind === "done" && /^\d+$/.test(c.cell.value) ? Number(c.cell.value) : 0)
      }, 0)
    return { floor: total("floor"), round: total("round") }
  })
  const editedOf = memoLast((rows: RowResult<KojiFieldId>[] | null, w: Pick<CaseState["work"], "added" | "edits" | "replacements" | "rounding">) =>
    rows ? editRows({ rows, ...w }) : null,
  )
  const selectedOf = memoLast((edited: ReturnType<typeof editedOf>, w: Pick<CaseState["work"], "manual" | "tax" | "basis" | "rule7Tax" | "selection">) =>
    edited ? selectRows(w, edited) : null,
  )
  const viewOf = memoLast((rows: RowResult<KojiFieldId>[] | null, added: CaseState["work"]["added"], edited: ReturnType<typeof editedOf>, selected: ReturnType<typeof selectedOf>, replacements: CaseState["work"]["replacements"]) =>
    rows && edited && selected ? orderAndFinalize({ rows, added, replacements }, edited, selected) : null,
  )
  // editRows・selectRows に渡す項目は、作業の参照ではなく項目ごとに比べる（関係ない作業の変更で作り直さない）
  const editInput = memoLast((added: CaseState["work"]["added"], edits: CaseState["work"]["edits"], replacements: CaseState["work"]["replacements"], rounding: Rounding) => ({ added, edits, replacements, rounding }))
  const selectInput = memoLast(
    (manual: CaseState["work"]["manual"], tax: CaseState["work"]["tax"], basis: CaseState["work"]["basis"], rule7Tax: CaseState["work"]["rule7Tax"], selection: CaseState["work"]["selection"]) => ({ manual, tax, basis, rule7Tax, selection }),
  )

  let last: { state: CaseState; out: TableDerived } | null = null
  return function table(s: CaseState): TableDerived {
    if (last?.state === s) return last.out
    const w = s.work
    const rt = s.runtime
    const shownPlan = w.plan ?? rt.planDraft
    const plan = shownPlan?.plan ?? null
    const source = rt.source
    const grid = source && plan ? (source.sheets.find((g) => g.name === plan.sheets[0]) ?? null) : null
    const sources = sourcesOf(source, plan)
    const addressValues = addressValuesOf(sources, plan)
    const addressSig = addressSigOf(addressValues)
    const book = addressesOf(addressSig, rt.addressBook, addressValues)
    const ctx = ctxOf(book, w.rounding)
    const drafts = draftsOf(sources, plan, ctx)
    const freshRows = freshRowsOf(w.sourceFileId, w.converted, sources, ctx, drafts, w.aiCache)
    if (freshRows) lastRows = freshRows
    else if (!w.plan || !w.sourceFileId) lastRows = null
    const rows = freshRows ?? lastRows
    const reconverting = !freshRows && !!rows
    const edited = editedOf(rows, editInput(w.added, w.edits, w.replacements, w.rounding))
    const selected = selectedOf(edited, selectInput(w.manual, w.tax, w.basis, w.rule7Tax, w.selection))
    const view = viewOf(rows, w.added, edited, selected, w.replacements)
    const out: TableDerived = {
      shownPlan,
      plan,
      grid,
      sources,
      addressValues,
      addressSig,
      addresses: book,
      rows,
      reconverting,
      hasTable: (w.converted || w.added.length > 0 || reconverting) && !!rows,
      unmarked: unmarkedOf(sources, ctx, drafts),
      roundingTotals: roundingTotalsOf(sources, plan, book),
      edited,
      selected,
      view,
      shown: view?.shown ?? null,
      inclusion: view?.inclusion ?? NO_INCLUSION,
      letters: view?.letters ?? NO_LETTERS,
      output: view?.output ?? null,
      currentSource: source && plan && source.fileId === w.sourceFileId ? source : null,
    }
    // 中身が前と同じ参照なら前の結果を返す（selector が描画ごとに新しいものを返さない）
    const same = last && (Object.keys(out) as (keyof TableDerived)[]).every((k) => Object.is(out[k], last!.out[k]))
    last = { state: s, out: same ? last!.out : out }
    return last.out
  }
}

type TablePlan = NonNullable<CaseState["work"]["plan"]>["plan"]
type Sources = ReturnType<typeof collectSourceRows>

export type TableDerived = {
  /** 見せる計画（決まった計画、無ければ AI を待つ間の推定） */
  shownPlan: CaseState["runtime"]["planDraft"]
  plan: TablePlan | null
  /** 計画の元のシート */
  grid: SheetGrid | null
  sources: Sources | null
  /** 計画が住所として読む列の値（変換の前に引く） */
  addressValues: string[] | null
  /** 住所の値の集まり（変わったときだけ新しい値を引く） */
  addressSig: string | null
  /** 引いた住所（今の住所をすべて引き終わるまで null） */
  addresses: CaseState["runtime"]["addressBook"] | null
  /** 変換した行（手直し・置換の前）。変換し直している間は前の行 */
  rows: RowResult<KojiFieldId>[] | null
  reconverting: boolean
  /** 表を見せるか（変換した、または足した行がある） */
  hasTable: boolean
  /** ○ の列で業種を決める計画のとき、どの列にも記号が無く出力しない元の行の数 */
  unmarked: number
  roundingTotals: { floor: number; round: number } | null
  edited: ReturnType<typeof editRows> | null
  selected: ReturnType<typeof selectRows> | null
  view: ReturnType<typeof orderAndFinalize> | null
  shown: NonNullable<ReturnType<typeof orderAndFinalize>>["shown"] | null
  inclusion: ReadonlyMap<string, Inclusion>
  letters: ReturnType<typeof personLetters>
  output: NonNullable<ReturnType<typeof orderAndFinalize>>["output"] | null
  /** 今の変換の元（読み終えたもの） */
  currentSource: CaseState["runtime"]["source"]
}
