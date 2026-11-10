import { Outlet, createFileRoute } from "@tanstack/react-router"
import { FIT_NAME } from "@/lib/constants"

/** FIT 申請のページ（/fit の下）。ページの名前をそろえる */
export const Route = createFileRoute("/_authed/fit")({
  head: () => ({ meta: [{ title: FIT_NAME }] }),
  component: Outlet,
})
