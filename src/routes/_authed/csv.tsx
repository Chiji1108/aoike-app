import { Outlet, createFileRoute } from "@tanstack/react-router"
import { CSV_NAME } from "@/lib/constants"

/** 工事経歴書 CSV のページ（/csv の下）。ページの名前をそろえる */
export const Route = createFileRoute("/_authed/csv")({
  head: () => ({ meta: [{ title: CSV_NAME }] }),
  component: Outlet,
})
