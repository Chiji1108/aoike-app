import { env } from "cloudflare:workers"
import { z } from "zod"
import { getFitDb } from "@/db"
import { contentTypeOf } from "@/lib/cases/types"
import { DOC_TYPES, MAX_DOC_BYTES } from "@/lib/fit/documents"
import * as store from "./fit-store"
import { signedIn, text } from "./http"

const uploadHeaders = z.object({
  docType: z.enum(DOC_TYPES),
  name: z.string().trim().min(1).max(200),
})

/**
 * 手続に書類を置く。本文はファイルそのもの。種類と名前はヘッダー（X-Doc-Type、X-File-Name は encodeURIComponent したもの）で受け、
 * ファイル名を URL（ログに残る）に載せない。独自のヘッダーが要るので、ほかのサイトのフォームや CORS の許可の無い fetch からは送れない（CSRF の確認の代わり）。
 * 大きさは Content-Length で先に受ける（R2 は長さの分からない本文を置けない）
 */
export const uploadFitFile = (request: Request, procedureId: string) =>
  signedIn(request, async (session) => {
    const h = request.headers
    const length = h.get("content-length")
    if (length === null) return text("ファイルの大きさ（Content-Length）がありません", 411)
    if (!/^\d+$/.test(length)) return text("ファイルの大きさ（Content-Length）が読めません", 400)
    if (Number(length) > MAX_DOC_BYTES) return text("ファイルは 100MB までです", 413)
    if (!request.body || Number(length) === 0) return text("ファイルが空です", 400)
    let name: string
    try {
      name = decodeURIComponent(h.get("x-file-name") ?? "")
    } catch {
      return text("ファイル名が読めません", 400)
    }
    const parsed = uploadHeaders.safeParse({ docType: h.get("x-doc-type"), name })
    if (!parsed.success) return text("書類の種類・名前が正しくありません", 400)
    const saved = await store.addFile(getFitDb(), env.FIT_FILES, procedureId, {
      ...parsed.data,
      contentType: contentTypeOf(parsed.data.name),
      body: request.body,
      uploadedBy: session.user.id,
    })
    return saved ? Response.json(saved) : text("手続が見つかりません", 404)
  })

/** 書類を返す（ログインしているときだけ。R2 は公開しない）。だれがいつダウンロードしたかを残す。いつも保存させ、中身から種類を推測させない */
export const downloadFitFile = (request: Request, fileId: string) =>
  signedIn(request, async (session) => {
    const db = getFitDb()
    const row = await store.getFileRow(db, fileId)
    if (row?.purgedAt) return text("消した書類です", 410)
    if (row?.deletedAt) return text("ゴミ箱の書類です。戻してからダウンロードしてください", 410)
    const object = row && (await env.FIT_FILES.get(row.r2Key))
    if (!row || !object) return text("書類が見つかりません", 404)
    await store.recordDownload(db, row.id, session.user.id)
    return new Response(object.body, {
      headers: {
        "content-type": row.contentType,
        "content-length": String(object.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    })
  })
