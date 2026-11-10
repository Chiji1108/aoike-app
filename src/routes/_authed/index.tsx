import { Link, createFileRoute } from "@tanstack/react-router"
import { CalendarDays, ChevronRight, ExternalLink, FileSpreadsheet, Globe, type LucideIcon } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { APP_NAME } from "@/lib/constants"

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: APP_NAME }] }),
  component: PortalPage,
})

type Tool = { name: string; description: string; icon: LucideIcon } & (
  | { to: "/kintai" | "/csv"; href?: never }
  // app.aoike.jp の外（ホームページなど）は、その URL を開く
  | { to?: never; href: string }
)

const TOOLS: Tool[] = [
  {
    name: "勤怠",
    description: "スタッフの勤怠の入力と、勤務報告書の印刷",
    icon: CalendarDays,
    to: "/kintai",
  },
  {
    name: "工事経歴書 CSV",
    description: "工事経歴書の Excel から、建設業.NET に読み込む CSV を作る",
    icon: FileSpreadsheet,
    to: "/csv",
  },
  {
    name: "ホームページ",
    // 公開前の確認用の URL。www.aoike.jp で公開したら差し替える
    description: "事務所のホームページ（公開前の確認用）",
    icon: Globe,
    href: "https://aoike-website.chiji.workers.dev",
  },
]

const cardClass =
  "group flex items-center gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/20 hover:bg-muted/40"

function PortalPage() {
  return (
    <AppShell>
      {/* 見た目の見出しは出さない（ヘッダーに事務所名がある）。読み上げ用にだけ置く */}
      <h1 className="sr-only">{APP_NAME}</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((tool) => {
          const body = <ToolCard tool={tool} />
          return (
            <li key={tool.name}>
              {tool.to ? (
                <Link to={tool.to} className={cardClass}>
                  {body}
                </Link>
              ) : (
                <a href={tool.href} className={cardClass}>
                  {body}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </AppShell>
  )
}

function ToolCard({ tool }: { tool: Tool }) {
  const { icon: Icon } = tool
  return (
    <>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{tool.name}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{tool.description}</span>
      </span>
      {tool.href ? (
        <ExternalLink className="size-4 text-muted-foreground" aria-label="別の URL で開く" />
      ) : (
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  )
}
