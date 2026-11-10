import { Link, createFileRoute } from "@tanstack/react-router"
import { ArrowRight, CalendarDays, ExternalLink, FileSpreadsheet, Globe, Sun, type LucideIcon } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { APP_NAME } from "@/lib/constants"
import { reiwaOf } from "@/lib/fit/procedure"
import { formatDateLong, todayIso, weekdayLabel } from "@/lib/period"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: APP_NAME }] }),
  component: PortalPage,
})

/** ツールごとの色（アイコンの地・上の線。ダークモードでは暗い地にする） */
const TONES = {
  sky: { tile: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", bar: "from-sky-400/70" },
  emerald: { tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", bar: "from-emerald-400/70" },
  amber: { tile: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", bar: "from-amber-400/70" },
} as const

type Tool = { name: string; description: string; icon: LucideIcon; to: "/kintai" | "/csv" | "/fit"; tone: keyof typeof TONES }

const TOOLS: Tool[] = [
  { name: "勤怠", description: "スタッフの勤怠の入力と、勤務報告書の印刷", icon: CalendarDays, to: "/kintai", tone: "sky" },
  { name: "工事経歴書 CSV", description: "工事経歴書の Excel から、建設業.NET に読み込む CSV を作る", icon: FileSpreadsheet, to: "/csv", tone: "emerald" },
  { name: "FIT 申請", description: "SHARP から受託する太陽光の FIT 申請の事件簿と、週次の案件表", icon: Sun, to: "/fit", tone: "amber" },
]

/** app.aoike.jp の外のページ */
const LINKS: { name: string; description: string; icon: LucideIcon; href: string }[] = [
  // 公開前の確認用の URL。www.aoike.jp で公開したら差し替える
  { name: "ホームページ", description: "事務所のホームページ（公開前の確認用）", icon: Globe, href: "https://aoike-website.chiji.workers.dev" },
]

function PortalPage() {
  const today = todayIso()
  return (
    <AppShell>
      <header className="mb-8">
        <p className="text-sm text-muted-foreground num">
          {formatDateLong(today)}（{weekdayLabel(today)}）・令和{reiwaOf(Number(today.slice(0, 4)))}年
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight">業務ツール</h1>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="portal-tools">
        {TOOLS.map((tool) => (
          <li key={tool.name}>
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">リンク</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map(({ name, description, icon: Icon, href }) => (
            <li key={name}>
              <a href={href} className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/50">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{description}</span>
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-label="別の URL で開く" />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  )
}

/** ツールのカード。広い画面では縦に、スマホでは横に並べて小さくする（3つが1画面に入るように） */
function ToolCard({ tool }: { tool: Tool }) {
  const { icon: Icon } = tool
  const tone = TONES[tool.tone]
  return (
    <Link
      to={tool.to}
      className="group relative flex h-full items-center gap-4 overflow-hidden rounded-2xl border bg-card p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-col sm:items-start sm:gap-0 sm:p-6"
    >
      {/* 上の細い色の線（ツールの見分け） */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r to-transparent", tone.bar)} />
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl sm:size-12", tone.tile)}>
        <Icon className="size-5 sm:size-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col sm:mt-5 sm:w-full">
        <span className="font-semibold tracking-tight sm:text-lg">{tool.name}</span>
        <span className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:mt-1.5 sm:flex-1 sm:text-sm">{tool.description}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand sm:mt-5">
        <span className="hidden sm:inline">開く</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
