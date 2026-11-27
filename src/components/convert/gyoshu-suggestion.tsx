import { useCallback, useMemo, useRef, useState } from "react"
import { MAX_ITEMS_PER_REQUEST, parseAiResponse, type AiBatchRequest } from "@/lib/convert/ai-tasks"
import type { CellEdit, RowResult } from "@/lib/convert/convert"
import { GYOSHU_BASES, GYOSHU_BASIS_LABELS, gyoshuTrend, suggestionEdits, suggestionInput, trendText, type GyoshuBasis, type GyoshuSuggestion } from "@/lib/convert/gyoshu-guess"
import { errorMessage } from "@/lib/errors"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { runAiBatch } from "@/server/ai"

type Row = RowResult<KojiFieldId>

/**
 * 「AI で案を出す」（業種）。チャットの指示（表を全部送るコード実行の1回）ではなく、対象の行だけを値ごとの判断（runAiBatch の suggestGyoshu）で頼む:
 * 送るのは対象の行の工事名・注文者（画面の値。個人名は記号のまま）・元の業種の記載と、決まった処理で数えたほかの工事の業種の傾向だけなので安く、
 * 答えは固定の形（業種コード・根拠の種類・根拠）で受け取り、コード表で確かめる。案は業種の一覧の「案」に出すだけで（案件の作業の gyoshuPlans）、決めるのは一覧
 */

/** 最後に頼んだ結果（保存しない。案そのものは案件の作業に残る）。failed は呼び出しに失敗した行（もう一度頼める） */
export type FixRun = { asked: number; proposed: number; undecided: number; byBasis: Partial<Record<GyoshuBasis, number>>; failed: string[]; error?: string }

export function useGyoshuSuggestion({
  caseId,
  onPlans,
  onCaseCost,
}: {
  caseId: string
  /** 案を一覧に足す。sourceFileId は頼み始めたときの変換の元（受け取るまでに元が変わっていたら捨てる） */
  onPlans: (sourceFileId: string | null, plans: { rowKey: string; edit: CellEdit }[]) => void
  onCaseCost: (usd: number) => void
}) {
  const [running, setRunning] = useState<number | null>(null)
  const [last, setLast] = useState<FixRun | null>(null)
  const busy = useRef(false)
  /** 最新の props の関数（頼んでいる間に変わっても、今のものに渡す） */
  const live = useRef({ onPlans, onCaseCost })
  live.current = { onPlans, onCaseCost }

  /**
   * keys の行（表の行）に業種の案を出す。rows は今の表（shown。傾向はこの表のほかの行から数える）。
   * 100行ずつの呼び出しは並べて呼び、成功した分は一覧の案にする（失敗した分の行は failed に残し、もう一度頼める。払った結果を捨てない）
   */
  const run = useCallback(async (rows: readonly Row[], keys: readonly string[], sourceFileId: string | null) => {
    const { onPlans, onCaseCost } = live.current
    if (busy.current || !keys.length) return
    busy.current = true
    const targets = new Set(keys)
    const asked = rows.filter((r) => targets.has(r.key))
    setRunning(asked.length)
    setLast(null)
    try {
      const trend = gyoshuTrend(rows, targets)
      const instruction = trendText(trend)
      const byId = new Map(asked.map((r, i) => [i, r]))
      const chunks = Array.from({ length: Math.ceil(asked.length / MAX_ITEMS_PER_REQUEST) }, (_, c): AiBatchRequest => ({
        task: "suggestGyoshu",
        instruction,
        items: asked.slice(c * MAX_ITEMS_PER_REQUEST, (c + 1) * MAX_ITEMS_PER_REQUEST).map((r, i) => ({ id: c * MAX_ITEMS_PER_REQUEST + i, input: suggestionInput(r).slice(0, 500) })),
      }))
      const settled = await Promise.allSettled(
        chunks.map(async (req) => {
          const res = await runAiBatch({ data: { caseId, ...req } })
          onCaseCost(res.usd)
          if (!res.ok) throw new Error(res.message)
          const parsed = parseAiResponse("suggestGyoshu", req, res.json)
          if (!parsed.ok) throw new Error(parsed.message)
          return parsed.results
        }),
      )
      const results = new Map<number, GyoshuSuggestion>()
      const failed: string[] = []
      const errors = new Set<string>()
      settled.forEach((s, c) => {
        if (s.status === "fulfilled") for (const [id, r] of s.value) results.set(id, r)
        else {
          errors.add(errorMessage(s.reason, "AI の案を出せませんでした"))
          for (const it of chunks[c]!.items) failed.push(byId.get(it.id)!.key)
        }
      })
      const answered = new Map([...byId].filter(([, r]) => !failed.includes(r.key)))
      const { edits, undecided } = suggestionEdits(answered, results, trend)
      const byBasis: FixRun["byBasis"] = {}
      for (const e of edits) byBasis[e.basis] = (byBasis[e.basis] ?? 0) + 1
      if (edits.length) onPlans(sourceFileId, edits.map((e) => ({ rowKey: e.rowKey, edit: e.edit })))
      setLast({ asked: asked.length, proposed: edits.length, undecided, byBasis, failed, ...(errors.size ? { error: [...errors].join(" / ") } : {}) })
    } catch (e) {
      setLast({ asked: asked.length, proposed: 0, undecided: 0, byBasis: {}, failed: asked.map((r) => r.key), error: errorMessage(e, "AI の案を出せませんでした") })
    } finally {
      busy.current = false
      setRunning(null)
    }
  }, [caseId])
  // 読む部品（業種のタブ）が、頼んだ状態が変わったときだけ描き直るよう、同じ状態なら同じものを返す
  return useMemo(() => ({ run, running, last }), [run, running, last])
}
export type GyoshuSuggestionState = ReturnType<typeof useGyoshuSuggestion>

/** 結果の言葉（業種の一覧に出す） */
export function summaryText(r: FixRun) {
  const by = GYOSHU_BASES.filter((b) => r.byBasis[b]).map((b) => `${GYOSHU_BASIS_LABELS[b]} ${r.byBasis[b]}`)
  const head = r.proposed ? `${r.asked} 行のうち ${r.proposed} 行に案を出しました（${by.join("・")}）。` : r.failed.length === r.asked ? "" : `${r.asked - r.failed.length} 行に案を出せませんでした。`
  const rest = r.undecided ? `決められなかった ${r.undecided} 行は、右の欄で業種を選んでください。` : ""
  const trend = r.byBasis.trend || r.byBasis.workName ? "推定の行は根拠を見て決めてください。" : ""
  return `${head}${trend}${rest}`
}
