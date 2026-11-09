import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { getSessionFn } from "@/server/session"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const { userId, role } = await getSessionFn()
    // ログインしたら、開こうとしていたページに戻す
    if (!userId) throw redirect({ to: "/login", search: { redirect: location.href } })
    if (role !== "office") throw redirect({ to: "/login" })
    return { userId }
  },
  component: Outlet,
})
