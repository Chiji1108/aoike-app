import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { getAuth } from "@/lib/auth"

export class SignedOutError extends Error {
  constructor() {
    super("ログインが必要です")
  }
}

/**
 * 要求が事務所アカウントでログインしているか確かめる。していなければ SignedOutError を投げる。
 * SHARP 用の閲覧アカウントなど、ほかの役割を足したときも、勤怠や工事経歴書などの事務所のデータには入れない。
 */
export const requireSession = createServerOnlyFn(async (headers: Headers) => {
  const session = await getAuth().api.getSession({ headers })
  if (!session || session.user.role !== "office") throw new SignedOutError()
  return session
})

/** 事務所アカウントでのログインが必要なサーバー関数に付けるミドルウェア */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) =>
  next({ context: { session: await requireSession(getRequestHeaders()) } }),
)
