import { env, waitUntil } from "cloudflare:workers"
import Anthropic, { toFile } from "@anthropic-ai/sdk"
import { createUIMessageStream, createUIMessageStreamResponse, generateId, toUIMessageStream, type ModelMessage, type UserModelMessage } from "ai"
import { z } from "zod"
import { getCsvDb } from "@/db"
import { containerName, contentTypeOf, r2KeyOf } from "@/lib/cases/types"
import { fromWire, caseTableWireSchema } from "@/lib/chat/wire"
import { ENDED_TEXT, type ChatHistory, type ChatMessage, type ChatMetadata } from "@/lib/chat/messages"
import { tryParseJson } from "@/lib/json"
import { mappingPlanSchema } from "@/lib/convert/plan-schema"
import { sheetShapeSchema } from "@/lib/convert/plan-patch"
import { newProposal, proposalKey, proposalPrefix, proposalRecordSchema, type ProposalRecord } from "@/lib/chat/proposals"
import { newTurnState, startTurn, systemPrompt, type ContainerFile, type TurnStep } from "@/lib/chat/turn"
import { tokensOfAiSdk, usdOf } from "@/lib/cost"
import { errorMessage } from "@/lib/errors"
import * as store from "./case-store"
import { batchWithClaude } from "./claude"
import {
  abandonTurn,
  beginTurn,
  ChatBusyError,
  ChatConflictError,
  endSession,
  loadChat,
  saveChat,
  settleSession,
  type ChatBucket,
  type ChatDoc,
  type ChatSession,
  type Loaded,
  type TurnOutcome,
} from "./chat-store"
import { signedIn, text } from "./http"
import { finishTurn, watchStop } from "./turn-close"
import { searchLocation } from "./location"
import { locateOne } from "./location-run"
import { serverAddressLookup, serverPlaceIndex } from "./place-index"
import { personalChecker } from "./location-guard"
import { namesOfSaved, readSavedCase } from "./case-names"
import { guardPersonal, type Site } from "@/lib/location/sites"
import { unviewableAfter, viewIdle, type FileViewer } from "@/lib/chat/view-file"


const requestSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(10_000),
  table: caseTableWireSchema,
  context: z.string().max(50_000),
  sourceFileId: z.string().max(64).nullable(),
  /** 今の列の対応と計画の元のシートの大きさ（チャットの set_plan の確かめ。変換の元の表が無い案件は null） */
  plan: z.object({ plan: mappingPlanSchema, shape: sheetShapeSchema }).nullable(),
})

/** 止める印を見に行く間隔 */
const STOP_POLL_MS = 1_000

/** 指示を止める印（R2。案件のキーの頭の下に置くので、案件を消すと一緒に消える） */
const stopKey = (caseId: string, turnId: string) => `cases/${caseId}/chat-stop/${encodeURIComponent(turnId)}`

/** 指示を止める（画面の「止める」）。処理している Worker が印を見て AI の呼び出しを止め、それまでの費用と作ったファイルを記録する */
export async function stopChat(caseId: string, turnId: string) {
  const { doc } = await loadChat(bucket(), caseId)
  if (doc.turn?.id === turnId) await env.CSV_FILES.put(stopKey(caseId, turnId), "")
}

/** コンテナがこれより早く切れるなら、新しいコンテナにする（指示の途中で切れないように） */
const CONTAINER_MARGIN_MS = 5 * 60_000

const bucket = () => env.CSV_FILES as unknown as ChatBucket

function anthropic() {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

/** コンテナの中の名前（顧客名などを Files API の名前に出さない。拡張子だけ残す） */

/**
 * チャットの1回の指示（POST /api/csv/cases/<caseId>/chat）。本文は JSON（ChatRequest）。JSON の本文は CORS の許可が無いと
 * ほかのサイトから送れないので、Content-Type を確かめる（サーバー関数の CSRF の確かめの代わり）。返事は AI SDK の UI メッセージのストリーム
 */
export const chatTurn = (request: Request, caseId: string) => signedIn(request, () => runTurn(request, caseId))

async function runTurn(request: Request, caseId: string): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return text("本文は JSON で送ってください", 415)
  if (!env.ANTHROPIC_API_KEY) return text("APIキー未設定（ANTHROPIC_API_KEY）のため、チャットは使えません", 503)
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return text("本文の JSON が読めません", 400)
  }
  const parsed = requestSchema.safeParse(json)
  if (!parsed.success) return text("指示の形が正しくありません", 400)
  const body = parsed.data

  const db = getCsvDb()
  const kase = await store.getCase(db, caseId)
  if (!kase || kase.deleting) return text("案件が見つかりません", 404)
  const [customer, files, rules] = await Promise.all([store.getCustomer(db, kase.customerId), store.listFiles(db, caseId), store.rulesForAi(db, kase.customerId)])
  // 指示を処理している印を立てる。ここから下ろすまで、この案件の会話を書くのはこの指示だけ
  const turn = { id: body.id, startedAt: Date.now() }
  let loaded: Loaded
  try {
    const held = await beginTurn(bucket(), caseId, turn)
    // 印を取る前に削除が始まっていたら何もしない（削除は会話を終えてから R2 を消すので、そのあとに会話を作り直さない）
    const now = await store.getCase(db, caseId)
    if (!now || now.deleting) {
      await abandonTurn(bucket(), caseId, held)
      return text("案件が見つかりません", 404)
    }
    loaded = held
  } catch (e) {
    if (e instanceof ChatBusyError || e instanceof ChatConflictError) return text(e.message, 409)
    throw e
  }
  const startSession: ChatSession = loaded.doc.session ?? { model: [], container: null, files: [], generated: [] }
  const containerLive = startSession.container !== null && Date.parse(startSession.container.expiresAt) > Date.now() + CONTAINER_MARGIN_MS

  // 案件の届いたファイル（顧客の回答のファイルも）をコンテナに渡す。まだ上げていないものは Files API に上げ、上げるたびに記録する（途中で失敗しても、会話を終えるときに消せる）。
  // コンテナが新しくなるときは全部を付け直す
  let session = startSession
  const added: ChatSession["files"] = []
  try {
    for (const f of files.filter((f) => f.kind === "source")) {
      if (session.files.some((s) => s.caseFileId === f.id)) continue
      const row = await store.getFileRow(db, f.id)
      const object = row && (await env.CSV_FILES.get(row.r2Key))
      if (!object) continue
      const name = containerName(session.files.length, f.name)
      const up = await anthropic().files.upload({ file: await toFile(await object.arrayBuffer(), name, { type: contentTypeOf(f.name) }) })
      const file = { anthropicId: up.id, caseFileId: f.id, name, original: f.name }
      added.push(file)
      session = { ...session, files: [...session.files, file] }
      loaded = await saveChat(bucket(), caseId, loaded, { ...loaded.doc, session })
    }
  } catch (e) {
    // 上げたのに記録できなかったファイルは、あとで消せないので今消す。消せなくても印は下ろし、渡せなかったことを知らせる
    const known = new Set(loaded.doc.session?.files.map((f) => f.anthropicId))
    const unrecorded = added.filter((f) => !known.has(f.anthropicId)).map((f) => f.anthropicId)
    const leftover = await deleteAnthropicFiles(unrecorded).then(
      () => null,
      (err: unknown) => err,
    )
    await endTurn(caseId, loaded, { ...loaded.doc, turn: null })
    if (leftover) console.error("記録できなかった Files API のファイルを消せませんでした", unrecorded, leftover)
    return text(errorMessage(e, "AI にファイルを渡せませんでした"), 502)
  }
  const attach = containerLive ? added : session.files

  const userModel: UserModelMessage = {
    role: "user",
    content: [
      ...attach.map((f) => ({
        type: "file" as const,
        mediaType: contentTypeOf(f.original),
        data: { type: "reference" as const, reference: { anthropic: f.anthropicId } },
        providerOptions: { anthropic: { containerUpload: true } },
      })),
      { type: "text" as const, text: body.text },
    ],
  }
  const userUi: ChatMessage = { id: body.id, role: "user", parts: [{ type: "text", text: body.text }] }
  const containerFiles: ContainerFile[] = session.files.map((f) => ({ name: f.name, original: f.original, isSource: f.caseFileId === body.sourceFileId }))
  const system = systemPrompt({ ...rules, customerName: customer?.name ?? "" }, body.context, containerFiles, body.table.rule7Tax)
  // 止める: 画面の「止める」（止める印を R2 に置く）か、タブを閉じた（request.signal。本番の enable_request_signal）で AI の呼び出しを止める（工事場所の検索も）
  const abort = new AbortController()
  request.signal.addEventListener("abort", () => abort.abort(request.signal.reason), { once: true })
  // 工事場所の「この現場ってどこ？」はチャットとは別のやり取りで調べる（コード実行と同じやり取りに Web 検索を入れない。検索の結果は履歴に積まず、答えだけを道具の結果にする）
  // 住所データの索引と個人名の確かめは、工事場所を調べるときだけ作る
  let checker: Promise<(text: string) => boolean> | undefined
  const guard = async (sites: Site[]) => guardPersonal(sites, await (checker ??= personalChecker(db, caseId, body.table)))
  /** ほかの顧客の名前（問い合わせのメールの下書きに入れない。指示の間で1回だけ読む） */
  let others: Promise<readonly string[]> | undefined
  const otherCustomers = () => (others ??= store.otherCustomerNames(db, kase.customerId))
  // 案件のファイルを AI にそのまま見せる（view_file。文字の層の無い PDF・画像）。コンテナに置いたのと同じ Files API のファイルを見せ、
  // PDF のページを切り出したとき・画像の拡張子と中身が違うときだけ新しく上げる（上げたものは state.view.uploads に溜め、会話の作ったファイルとして記録して会話を終えるときに消す）。
  // 中身は案件のファイルの R2 のキー（r2KeyOf。保存するときと同じ決まり）から読み、DB を引き直さない
  const sizeOf = new Map(files.map((f) => [f.id, f.size]))
  const viewer: FileViewer = {
    // 案件から消したファイルは見せない（会話の履歴にはまだあるが、元のファイルが無い）
    files: session.files.flatMap((f) => {
      const size = sizeOf.get(f.caseFileId)
      const unviewable = session.unviewable?.find((u) => u.name === f.name)?.reason
      return size === undefined ? [] : [{ name: f.name, original: f.original, id: f.anthropicId, size, ...(unviewable ? { unviewable } : {}) }]
    }),
    read: async (name) => {
      const f = session.files.find((x) => x.name === name)
      const object = f && (await env.CSV_FILES.get(r2KeyOf(caseId, f.caseFileId)))
      return object ? new Uint8Array(await object.arrayBuffer()) : null
    },
    upload: async (bytes, name, type) => (await anthropic().files.upload({ file: await toFile(bytes, name, { type }) })).id,
  }
  // 注文者・工事名に AI が書いた値は、変換と同じ匿名化の AI に通す（lib/chat/turn.ts の anonymizeChanges）
  const state = newTurnState(
    fromWire(body.table),
    (req) => batchWithClaude(anthropic(), req),
    {
      locate: (site, spent) =>
        locateOne(
          {
            index: serverPlaceIndex(),
            knowledge: (req) => batchWithClaude(anthropic(), req),
            search: (s, sp) => searchLocation(anthropic(), serverPlaceIndex(), s, sp, abort.signal),
          },
          site,
          spent,
        ),
      guard,
    },
    body.plan,
    { lookup: serverAddressLookup },
    // 保存した作業から分かっている個人名（道具が要るときに、指示の間で1回だけ読む）
    async () => namesOfSaved(await readSavedCase(db, caseId)),
    { customerName: customer?.name ?? "", otherCustomers },
    viewer,
    session.model,
  )
  /** 履歴・作ったファイル・費用を書き終えたら resolve する。印がまだ自分のもの（画面の会話を書いて下ろしてよい）なら true */
  const recorded = Promise.withResolvers<boolean>()

  const stream = createUIMessageStream<ChatMessage>({
    originalMessages: [...loaded.doc.ui, userUi],
    execute: async ({ writer }) => {
      const steps: TurnStep[] = []
      let completed: ModelMessage[] | null = null
      let failure: unknown = null
      const unwatch = watchStop(
        async () => (await env.CSV_FILES.head(stopKey(caseId, turn.id))) !== null,
        () => abort.abort(new Error("職員が止めました")),
        STOP_POLL_MS,
      )
      try {
        const result = startTurn({
          apiKey: env.ANTHROPIC_API_KEY,
          system,
          messages: [...session.model, userModel],
          state,
          containerId: containerLive ? session.container!.id : undefined,
          abortSignal: abort.signal,
          onStep: (step) => steps.push(step),
        })
        writer.merge(toUIMessageStream({ stream: result.stream, sendFinish: false }))
        // 画面が流れを読むのをやめても AI の呼び出しを最後まで（止めたならそこまで）進め、結果を待てるようにする
        void result.consumeStream()
        // 止めた回の responseMessages は途中までの内容で resolve せず reject する（lib/chat/__tests__/abort.test.ts で確かめている）ので、
        // ここに来たのは終わった回だけ
        completed = [userModel, ...(await result.responseMessages)]
      } catch (e) {
        failure = e
      } finally {
        unwatch()
      }
      // 止めた・失敗した回でも、終わった往復の費用と作ったファイルは記録する（後始末のため）
      const usd = steps.reduce((n, s) => n + usdOf(tokensOfAiSdk(s.usage)), 0) + state.anonymizeUsd + state.locationSpent.usd
      const outcome: TurnOutcome = { completed, steps: steps.flatMap((s) => s.messages), container: steps.at(-1)?.container ?? (containerLive ? session.container : null) }
      const proposal = !failure && (state.pending.length || state.question) ? newProposal(generateId(), { kind: "chat", messageId: body.id }, state.pending, state.question) : null
      let ours = true
      let shown = false
      try {
        const closed = await finishTurn({
          putProposal: proposal && (() => putProposal(caseId, { proposal, changes: state.pending })),
          deleteProposal: () => env.CSV_FILES.delete(proposalKey(caseId, proposal!.id)),
          cleanup: () => env.CSV_FILES.delete(stopKey(caseId, turn.id)),
          record: async (ok) => {
            // 止めた回は view_file が上げている途中のことがあるので、上げ終わるのを待ってから記録する（上げたものは必ず記録して、会話を終えるときに消す）
            if (state.view) await viewIdle(state.view)
            const settled = settleSession(session, ok ? outcome : { ...outcome, completed: null }, added.length > 0, {
              uploads: state.view?.uploads,
              unviewable: state.view && failure ? unviewableAfter(state.view, failure) : [],
            })
            return record(caseId, loaded, settled)
          },
          addCost: async () => {
            if (usd > 0) await store.addCaseCost(db, caseId, usd)
          },
        })
        if (closed.recorded) loaded = closed.recorded
        ours = closed.ours
        shown = closed.proposal
        failure ??= closed.error
      } finally {
        recorded.resolve(ours)
      }
      // 一括調査を始めるボタン（検索は職員が押してから。件数と費用の目安を添える）
      if (state.locationOffer) writer.write({ type: "data-location-offer", data: state.locationOffer })
      // 画面の決まった処理を始めるボタン（ダウンロードの前の確認・問い合わせの Excel）。止めた・失敗した回は出さない
      if (!failure) for (const action of state.actions) writer.write({ type: "data-action", data: { action } })
      // 置いた変更案は、後始末のほかの失敗があっても画面に出す（開き直したときと同じに見せる）
      if (proposal && shown) {
        writer.write({ type: "data-proposal", data: { id: proposal.id } })
        writer.write({ type: "data-proposal-content", data: { proposal, changes: state.pending }, transient: true })
      }
      // 費用は止めた・失敗した回でも画面に届ける（サーバーは足したので、画面の案件の合計と食い違わないように）
      const caseUsd = (await store.getCase(db, caseId).catch(() => undefined))?.costUsd ?? kase.costUsd + usd
      const total = steps.reduce((t, s) => ({ input: t.input + (s.usage.inputTokens ?? 0), output: t.output + (s.usage.outputTokens ?? 0) }), { input: 0, output: 0 })
      const metadata: ChatMetadata = { usd, caseUsd, ms: Date.now() - turn.startedAt, inputTokens: total.input, outputTokens: total.output, toolCalls: state.toolCalls }
      writer.write({ type: "message-metadata", messageMetadata: metadata })
      if (failure) throw failure
      if (!ours) throw new ChatConflictError()
      writer.write({ type: "finish" })
    },
    // 画面の会話を書き、印を下ろす。タブを閉じた（流れを読むのをやめた）ときも呼ばれる。止めた・失敗した回は、指示と途中までの返事を残す
    onFinish: ({ messages }) => {
      waitUntil(
        recorded.promise.then(async (ok) => {
          if (ok) await endTurn(caseId, loaded, { ...loaded.doc, ui: messages, turn: null })
        }),
      )
    },
    onError: (e) => (e instanceof ChatConflictError ? e.message : errorMessage(e, "AI の呼び出しに失敗しました")),
  })
  return createUIMessageStreamResponse({ stream })
}

/**
 * 会話の履歴・作ったファイルを書く（印は立てたまま）。書けなければ（印を引き継がれた）、この回で作ったファイルは記録できないので今消し、null を返す
 */
async function record(caseId: string, loaded: Loaded, session: ChatSession): Promise<Loaded | null> {
  try {
    return await saveChat(bucket(), caseId, loaded, { ...loaded.doc, session })
  } catch (e) {
    if (!(e instanceof ChatConflictError)) throw e
    const known = new Set([...(loaded.doc.session?.generated ?? [])])
    await deleteAnthropicFiles(session.generated.filter((id) => !known.has(id)))
    return null
  }
}

/** 印を下ろす（書けなければ、印はもう別の指示のもの。会話はその指示が書く） */
async function endTurn(caseId: string, loaded: Loaded, doc: ChatDoc) {
  try {
    await saveChat(bucket(), caseId, loaded, doc)
  } catch (e) {
    if (!(e instanceof ChatConflictError)) throw e
  }
}

/** Files API のファイルを消す（もう無いものは消えたとみなす）。消すものが無ければ APIキーが無くてもよい */
async function deleteAnthropicFiles(ids: readonly string[]) {
  if (!ids.length) return
  if (!env.ANTHROPIC_API_KEY) throw new Error("APIキー未設定のため、AI に渡したファイルを消せません")
  const client = anthropic()
  for (const id of ids) {
    try {
      await client.files.delete(id)
    } catch (e) {
      if (!(e instanceof Anthropic.NotFoundError)) throw e
    }
  }
}

/**
 * 会話を終える: Files API に上げたファイルとコード実行が作ったファイルを消し、AI に送る履歴を捨てる（画面の会話は残す）。
 * ファイルを消すと前の履歴は送れなくなる（履歴がファイルを指している）ので、次の指示から新しい会話になる。何度実行しても同じ結果
 */
export async function endChat(caseId: string): Promise<{ id: string; text: string } | null> {
  const ended: ChatMessage = { id: generateId(), role: "system", parts: [{ type: "text", text: ENDED_TEXT }] }
  return (await endSession(bucket(), caseId, deleteAnthropicFiles, ended)) ? { id: ended.id, text: ENDED_TEXT } : null
}

async function putProposal(caseId: string, record: ProposalRecord) {
  await env.CSV_FILES.put(proposalKey(caseId, record.proposal.id), JSON.stringify(record), { httpMetadata: { contentType: "application/json" } })
}

/** 工事場所の一括調査が出した変更案を置く・消す（server/location-workflow.ts） */
export const putProposalRecord = putProposal
export const deleteProposalRecord = (caseId: string, proposalId: string) => env.CSV_FILES.delete(proposalKey(caseId, proposalId))

/** 変更案の記録（R2）を1つ読む。missing は記録が無い、unreadable は記録はあるが形が合わず読めない */
async function readRecord(caseId: string, proposalId: string): Promise<ProposalRecord | "missing" | "unreadable"> {
  const object = await env.CSV_FILES.get(proposalKey(caseId, proposalId))
  if (!object) return "missing"
  const parsed = proposalRecordSchema.safeParse(tryParseJson(await object.text()))
  return parsed.success ? parsed.data : "unreadable"
}

/** 変更案の記録（R2）を1つ読む。無い・読めないものは undefined（その変更案は出さない。ページ全体は開ける） */
export async function readProposal(caseId: string, proposalId: string): Promise<ProposalRecord | undefined> {
  const r = await readRecord(caseId, proposalId)
  return typeof r === "string" ? undefined : r
}

/**
 * 案件の画面に渡す変更案の記録: 案件の作業で開いているものと、作業にまだ無いもの（返事を受け取り損ねたもの）だけを読む。
 * 作業で決め終わった変更案の記録はもう要らないので消す（読むたびに溜まらない。消し損ねても次に開いたときにまた消す）。
 * unreadable は記録はあるが読めなかった変更案の id（画面は閉じずに知らせる。記録は消さない）。記録の無い変更案はどちらにも入らない
 */
export async function readOpenProposals(caseId: string, closed: ReadonlySet<string>): Promise<{ records: ProposalRecord[]; unreadable: string[] }> {
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await env.CSV_FILES.list({ prefix: proposalPrefix(caseId), cursor })
    ids.push(...page.objects.map((o) => o.key.slice(proposalPrefix(caseId).length).replace(/\.json$/, "")))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  const done = ids.filter((id) => closed.has(id))
  if (done.length) await env.CSV_FILES.delete(done.map((id) => proposalKey(caseId, id)))
  const open = ids.filter((id) => !closed.has(id))
  const read = await Promise.all(open.map((id) => readRecord(caseId, id)))
  return { records: read.filter((r) => typeof r !== "string"), unreadable: open.filter((_, i) => read[i] === "unreadable") }
}

/** 画面に出す会話（GET /api/csv/cases/<caseId>/chat。チャット欄を開いたときに読む。画面は validateUIMessages で形を確かめる） */
export const chatHistory = (request: Request, caseId: string) =>
  signedIn(request, async () => {
    const { ui } = (await loadChat(bucket(), caseId)).doc
    const history: ChatHistory = { messages: ui }
    return Response.json(history, { headers: { "cache-control": "private, no-store" } })
  })

