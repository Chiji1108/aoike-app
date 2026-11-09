import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"
import { legacyRedirectUrl } from "@/lib/legacy-host"

// app.aoike.jp にまとめる前のホスト名（kintai.aoike.jp など）で来たら、app.aoike.jp の同じページへ転送する
const legacyHostMiddleware = createMiddleware({ type: "request" }).server(({ request, next }) => {
  const location = legacyRedirectUrl(new URL(request.url))
  if (location) return new Response(null, { status: 308, headers: { location } })
  return next()
})

// サーバー関数（データの読み書き）は同一オリジンからの呼び出しのみ許可する
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
})

export const startInstance = createStart(() => ({
  requestMiddleware: [legacyHostMiddleware, csrfMiddleware],
}))
