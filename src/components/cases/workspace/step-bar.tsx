import { useEffect, useRef } from "react"
import { Check, ChevronDown, ChevronRight, Download, Table2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { exportTitle, fixBreakdown, remainingSteps } from "@/components/cases/next-steps"
import { useCaseActions, useCaseView } from "@/components/cases/store/context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { currentStep, SHORT_LABELS, stepCount, stepDone, STEPS, TOOLS, VIEW_LABELS, type StepId } from "@/lib/cases/steps"
import { tabBadge, type CaseTodo } from "@/lib/cases/todo"
import { cn } from "@/lib/utils"

/**
 * 作業の画面の上の段の並び（答える → 業種を決める → 直す → 問い合わせ → ダウンロード）と、段とは別の「表」・道具（その他）。
 * 段はタブとして押せ、済んだ段は ✓（押せる。縛らない）、今の段（最初の済んでいない段）は色で示す。数は lib/cases/todo.ts を読むだけ。
 * 狭い画面では短い名前にして横にスクロールする（続きがある側の端を薄くし、開いている段を見えるところへ送る）
 */
export function StepBar() {
  const { todo, view, tool } = useCaseView(useShallow((v) => ({ todo: v.todo, view: v.view, tool: v.tool })))
  const actions = useCaseActions()
  const current = currentStep(todo)
  const list = useRef<HTMLDivElement>(null)
  // 開いている段が横に隠れていれば見えるところまで送る（狭い画面。「次は ◯◯ →」・残りの段・チャットから開いたときも）
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [view])
  return (
    <div className="flex h-11 w-full shrink-0 items-center gap-1 border-b pr-2" data-testid="step-row">
      {/*
       * 狭い画面では段の並びが横に収まらない。ScrollArea（shadcn）で横にスクロールし、続きがある側だけ端を薄くする（data-overflow-x-*。
       * 隠れているのが分かる。スクロールし切ると消える）。開いている段は上の effect で見えるところへ送る
       */}
      <ScrollArea
        orientation="horizontal"
        className="h-11 min-w-0 flex-1"
        viewportClassName="data-overflow-x-end:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] data-overflow-x-start:[mask-image:linear-gradient(to_right,transparent,black_2.5rem)] data-overflow-x-start:data-overflow-x-end:[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]"
        data-testid="step-scroll"
      >
        <TabsList
          ref={list}
          variant="line"
          className="h-11 w-max justify-start gap-0 rounded-none px-2"
          aria-label="作業の段"
          data-testid="next-steps"
          data-current={current}
        >
          {STEPS.map((id, i) => (
            <span key={id} className="flex shrink-0 items-center">
              {i > 0 && <ChevronRight className="mx-0.5 size-3 shrink-0 text-muted-foreground/50" aria-hidden />}
              {/* 道具を開いている間に、選んでいる段・表を押しても道具を閉じて戻る（値が変わらないと Tabs は知らせないので押したときに閉じる） */}
              <StepTab id={id} todo={todo} current={id === current} onPress={actions.closeTool} />
            </span>
          ))}
          <span className="mx-2 h-5 w-px shrink-0 bg-border" aria-hidden />
          <TabsTrigger value="table" onClick={actions.closeTool} className="flex-none px-2" title="すべての行（表計算ソフトのように全体を見る）" data-testid="tab-table">
            <Table2 className="size-3.5" />
            {VIEW_LABELS.table}
            <span className="num text-xs text-muted-foreground">{todo.fix.all}</span>
          </TabsTrigger>
          {/* 道具は表のすぐ右（画面の右端は広い画面ではチャットの窓が重なる） */}
          <MoreTools todo={todo} active={tool} />
        </TabsList>
      </ScrollArea>
    </div>
  )
}

/** 段の数の単位（業種を決める・直すは行、問い合わせ・ダウンロードは件。答えるは数だけ） */
const STEP_UNITS: Record<StepId, string> = { answer: "", gyoshu: "行", fix: "行", inquiry: "件", export: "件" }

function StepTab({ id, todo, current, onPress }: { id: StepId; todo: CaseTodo; current: boolean; onPress: () => void }) {
  const done = stepDone(todo, id)
  const count = stepCount(todo, id)
  const waiting = id === "inquiry" && todo.inquiry.state === "waiting"
  const left = id === "export" && remainingSteps(todo).length > 0
  return (
    <TabsTrigger
      onClick={onPress}
      value={id}
      className={cn("flex-none gap-1 px-2 text-xs sm:text-sm", current && !done && "text-amber-900 data-active:text-amber-950 dark:text-amber-200")}
      title={stepTitle(id, todo)}
      aria-current={current ? "step" : undefined}
      data-testid={`next-step-${id}`}
      data-done={done ? "1" : "0"}
      data-state={id === "inquiry" ? todo.inquiry.state : undefined}
    >
      {done ? <Check className="size-3.5 text-emerald-600" /> : id === "export" ? <Download className="size-3.5" /> : null}
      <span className="sm:hidden">{SHORT_LABELS[id]}</span>
      <span className="hidden sm:inline">{VIEW_LABELS[id]}</span>
      {done && <span className="sr-only">済み</span>}
      {waiting && <span className="text-[11px] text-muted-foreground">返事待ち</span>}
      {!done && (
        <span className={cn("num rounded-full px-1.5 text-[11px] font-medium", current ? "bg-amber-100 text-amber-900" : "bg-muted text-foreground/70")}>
          {count}
          {STEP_UNITS[id]}
        </span>
      )}
      {/* 残りがあってもダウンロードできる（点は残りがあることだけ。意味はツールチップ） */}
      {left && <span className="size-1.5 rounded-full bg-amber-500" data-testid="export-badge" aria-hidden />}
    </TabsTrigger>
  )
}

/** 道具（工事場所・一括置換）。段の並びの終わり（表の右）のメニューにまとめ、開いている道具はその名前を出す */
function MoreTools({ todo, active }: { todo: CaseTodo; active: (typeof TOOLS)[number] | null }) {
  const actions = useCaseActions()
  const badge = TOOLS.reduce((s, t) => s + tabBadge(todo, t), 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant={active ? "secondary" : "ghost"} className="ml-1 shrink-0 gap-1 text-xs" data-testid="more-tools" data-active={active ?? undefined} />
        }
      >
        {active ? VIEW_LABELS[active] : "その他"}
        {badge > 0 && <span className="num rounded-full bg-muted px-1.5 text-[11px]">{badge}</span>}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {TOOLS.map((t) => (
          <DropdownMenuItem key={t} onClick={() => actions.showTab(t)} data-testid={`more-tool-${t}`}>
            {VIEW_LABELS[t]}
            {tabBadge(todo, t) > 0 && <span className="num ml-auto text-xs text-muted-foreground">{tabBadge(todo, t)}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function stepTitle(id: StepId, s: CaseTodo) {
  if (id === "answer") return "報告の聞き返し・チャットの変更案に答える（載せる工事・税込か税抜か・計画の聞き返しなど）"
  if (id === "gyoshu") return "7割で載りうる行の業種をまとめて決める（決めるたびに載せる行が入れ替わるので、直すより先に）"
  if (id === "fix") return s.fix.rows ? `直す行（${fixBreakdown(s.fix)}）` : "直す行はありません"
  if (id === "inquiry") return s.inquiry.state === "waiting" ? "顧客に送りました。答えのメールはチャットに貼り、ファイルは📎で付けてから、チャットで「回答を読んで」と頼みます" : "顧客に聞くことを確かめて送る"
  return exportTitle(s)
}
