/**
 * 一度きりの片付け（リリース前）: R2 の会話（cases/<caseId>/chat.json）から、消した機能の部分を取り除く。
 * - 画面の会話（ui）: 「去年のやり方で直す」の印の部品（data-carryover）と、振り返りの道具（get_review・propose_review）の部品
 * - AI の履歴（session.model）: 振り返りの道具の tool-call と、対になる tool-result
 * - 「去年のコードを添えた」印（返事の metadata.carryover・会話の session.carryover。今の形では読むときに捨てるもの）
 * 部品を取り除いて空になったメッセージも取り除く。何度当てても同じ結果（取り除くものが無ければ書かない）。
 *
 *   pnpm exec tsx scripts/tidy-chat-r2.ts --local [--dry-run]
 *   pnpm exec tsx scripts/tidy-chat-r2.ts --remote [--dry-run]
 *
 * 案件の一覧は D1（CSV_DB の csv_cases）から読む。指示を処理している間の会話は書き換えない（turn の印が立っていれば飛ばして数える）
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BUCKET = "aoike-kensetsu-csv-files"
const REMOVED_TOOLS = new Set(["get_review", "propose_review"])
const REMOVED_UI_PARTS = new Set(["data-carryover", ...[...REMOVED_TOOLS].map((t) => `tool-${t}`)])

const args = process.argv.slice(2)
const where = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null
if (!where) throw new Error("--local か --remote を指定")
const dryRun = args.includes("--dry-run")

type Part = { type: string; toolCallId?: string; toolName?: string }
type Message = { role: string; parts?: Part[]; content?: string | Part[]; metadata?: { carryover?: unknown } }
type Doc = { ui: Message[]; session: { model: Message[]; carryover?: unknown } | null; turn: unknown }

/** 画面の会話から取り除く。取り除いた部品と印の数を返す */
function tidyUi(ui: Message[]): { ui: Message[]; removed: number } {
  let removed = 0
  const next = ui.flatMap((m0) => {
    let m = m0
    if (m.metadata && "carryover" in m.metadata) {
      const { carryover: _, ...metadata } = m.metadata
      m = { ...m, metadata }
      removed++
    }
    if (!m.parts) return [m]
    const parts = m.parts.filter((p) => !REMOVED_UI_PARTS.has(p.type))
    removed += m.parts.length - parts.length
    if (parts.length === m.parts.length) return [m]
    return parts.length ? [{ ...m, parts }] : []
  })
  return { ui: next, removed }
}

/** AI の履歴から振り返りの道具の tool-call と、対になる tool-result を取り除く。取り除いた部品の数を返す */
function tidyModel(model: Message[]): { model: Message[]; removed: number } {
  const ids = new Set<string>()
  for (const m of model) if (Array.isArray(m.content)) for (const p of m.content) if (p.type === "tool-call" && REMOVED_TOOLS.has(p.toolName ?? "") && p.toolCallId) ids.add(p.toolCallId)
  const drop = (p: Part) => (p.type === "tool-call" || p.type === "tool-result") && (REMOVED_TOOLS.has(p.toolName ?? "") || ids.has(p.toolCallId ?? ""))
  let removed = 0
  const next = model.flatMap((m) => {
    if (!Array.isArray(m.content)) return [m]
    const content = m.content.filter((p) => !drop(p))
    removed += m.content.length - content.length
    if (content.length === m.content.length) return [m]
    return content.length ? [{ ...m, content }] : []
  })
  return { model: next, removed }
}

function wrangler(cmd: string[]) {
  return execFileSync("pnpm", ["exec", "wrangler", ...cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 })
}

const rows = JSON.parse(wrangler(["d1", "execute", "CSV_DB", where, "--json", "--command", "select id from csv_cases"])) as { results: { id: string }[] }[]
const caseIds = rows.flatMap((r) => r.results.map((x) => x.id))
const dir = mkdtempSync(join(tmpdir(), "tidy-chat-"))
const total = { cases: caseIds.length, chats: 0, changed: 0, uiParts: 0, modelParts: 0, busy: 0 }
try {
  for (const id of caseIds) {
    const key = `${BUCKET}/cases/${id}/chat.json`
    let text: string
    try {
      text = wrangler(["r2", "object", "get", key, where, "--pipe"])
    } catch {
      continue
    }
    if (!text.trim()) continue
    total.chats++
    const doc = JSON.parse(text) as Doc
    const ui = tidyUi(doc.ui)
    const model = doc.session ? tidyModel(doc.session.model) : { model: [], removed: 0 }
    const { carryover, ...session } = doc.session ?? {}
    if (doc.session && carryover !== undefined) model.removed++
    if (!ui.removed && !model.removed) continue
    if (doc.turn) {
      total.busy++
      console.log(`${id}: 指示を処理しているので飛ばした（あとでもう一度）`)
      continue
    }
    total.changed++
    total.uiParts += ui.removed
    total.modelParts += model.removed
    console.log(`${id}: 画面の部品と印 ${ui.removed}・AI の履歴の部品と印 ${model.removed}${dryRun ? "（--dry-run なので書かない）" : ""}`)
    if (dryRun) continue
    const next: Doc = { ...doc, ui: ui.ui, session: doc.session ? { ...(session as NonNullable<Doc["session"]>), model: model.model } : null }
    const file = join(dir, `${id}.json`)
    writeFileSync(file, JSON.stringify(next))
    wrangler(["r2", "object", "put", key, where, "--file", file, "--content-type", "application/json"])
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(
  `案件 ${total.cases}・会話 ${total.chats}・${dryRun ? "直す" : "直した"}会話 ${total.changed}（画面の部品と印 ${total.uiParts}・AI の履歴の部品と印 ${total.modelParts}）・飛ばした会話 ${total.busy}`,
)
if (total.busy) process.exitCode = 1
