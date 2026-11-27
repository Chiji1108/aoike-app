import type { ChatChange } from "../chat/proposals"
import { askReason, type Outcome, type Site } from "./sites"

/**
 * 調べた結果を変更案の項目にする。見つかった現場は工事場所の項目（同じ現場の行をまとめて1件）、見つからなかった・調べられなかった・
 * 調べなかった現場は、行ごとに都道府県を顧客への問い合わせにする（データに無いものとして聞く）。結果の無い現場（止めた回）は出さない
 */
export function outcomeChanges(sites: readonly Site[], outcomes: ReadonlyMap<string, Outcome>): ChatChange[] {
  return sites.flatMap((s): ChatChange[] => {
    const o = outcomes.get(s.key)
    if (!o) return []
    if (o.kind === "found") {
      const { kind: _, ...found } = o
      return [{ kind: "location", site: { key: s.key, workName: s.workName, client: s.client }, rowKeys: s.rowKeys, ...found }]
    }
    const reason = askReason(o)
    return s.rowKeys.map((rowKey) => ({ kind: "ask", rowKey, field: "prefecture", reason }))
  })
}
