import { createMiddleware } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { getAuth } from "@/lib/auth"

/**
 * 事務所アカウントでのログインが必要なサーバー関数に付けるミドルウェア。
 * SHARP 用の閲覧アカウントなど、ほかの役割を足したときも、勤怠などの事務所のデータには入れない。
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error("ログインが必要です")
  if (session.user.role !== "office") throw new Error("この操作はできません")
  return next({ context: { session } })
})
