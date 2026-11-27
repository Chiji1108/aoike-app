import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, validateUIMessages } from "ai"
import { z } from "zod"
import { Brain, Code2, Download, Loader2, MessageSquare, MessageSquareText, PanelRightOpen, Paperclip, Send, Square, Table2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/chat/markdown"
import { ProposalCard, type ProposalActions } from "@/components/chat/proposal-card"
import { LocationSearchStatus, type LocationSearch } from "@/components/convert/location-panel"
import { useCase, useCaseSession, useCaseView, useTable } from "@/components/cases/store/context"
import { useInquirySuggestion, useProposalActions } from "@/components/cases/workspace/hooks"
import { useFx, useLocationTool } from "@/components/cases/workspace/tools"
import { TOOL_TABS, workTabLabel, type WorkTab } from "@/components/cases/work-tabs"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller"
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import type { TableView } from "@/lib/cases/view"
import { chatDataSchemas, chatMetadataSchema, type ChatAction, type ChatMessage, type ChatRequest } from "@/lib/chat/messages"
import type { MappingPlan } from "@/lib/convert/plan"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import type { ChatChange, Proposal } from "@/lib/chat/proposals"
import { Cost } from "@/components/cost"
import type { UsdJpy } from "@/lib/fx"
import { errorMessage } from "@/lib/errors"
import { ATTACH_ACCEPT } from "@/lib/cases/types"
import { endChatFn, stopChatFn } from "@/server/chat-fns"

const historySchema = z.object({ messages: z.array(z.unknown()) })

/** 保存した会話を読み、形を確かめる（サーバーの R2 の会話。変更案の部品は id だけ） */
async function loadHistory(caseId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/csv/cases/${caseId}/chat`)
  if (!res.ok) throw new Error((await res.text()) || "会話を読めませんでした")
  const history = historySchema.parse(await res.json())
  // validateUIMessages は空の並びを受け付けない
  return history.messages.length
    ? await validateUIMessages<ChatMessage>({
        messages: history.messages,
        metadataSchema: chatMetadataSchema.optional(),
        dataSchemas: { proposal: chatDataSchemas.proposal, "location-offer": chatDataSchemas["location-offer"], action: chatDataSchemas.action },
      })
    : []
}

/** コードから呼ぶ道具の、画面での呼び名 */
const TOOL_LABELS: Record<string, string> = {
  get_table: "表を読む",
  check_table: "検査を確かめる",
  set_cells: "セルの変更案",
  set_include: "載せる・外すの変更案",
  add_rows: "工事を足す変更案",
  ask_customer: "問い合わせの変更案",
  set_selection: "7割と金額の設定の変更案",
  set_plan: "列の対応の変更案",
  offer_action: "ボタンを出す",
  ask_staff: "聞き返し",
  propose_rule: "ルールに足す行の案",
  find_location: "工事場所を調べる",
  get_inquiries: "問い合わせを読む",
  record_answers: "顧客の回答の変更案",
  propose_inquiry: "問い合わせのメールの下書きの案",
}

export type ChatPanelProps = {
  /** 会話の最初に出す変換の報告（案件の作業から作る。保存しない） */
  report: React.ReactNode
}

/** チャットの案内（押すと prompt を送る。会話に同じ指示があれば出さない） */
export type Suggestion = { text: string; label: string; prompt: string }

/**
 * 案件の画面のチャット（画面の主。表などの作業の画面はチャットの右か、狭い画面では上に重ねて開く）。AI の変更は変更案として返事に付け、職員が承認したものだけを表に入れる。
 * 会話は案件に保存し（R2）、開き直すと続きから。「会話を終える」で AI に渡したファイルを消す
 */
export function ChatPanel(props: ChatPanelProps) {
  const session = useCaseSession()
  const { actions } = session
  const caseId = session.config.caseId
  /** 変換が済んで送れるか（変換した、または変換の元の表が無い） */
  const chatReady = useCaseView((v) => v.chatReady)
  /** 案件にまだファイルが無い（入力欄の📎を「アップロード」と書いて目立たせる。ファイルのアップロードの入口は📎だけ） */
  const empty = useCase((s) => s.runtime.files.length === 0)
  const proposals = useCase((s) => s.work.proposals)
  /** 開いている変更案の中身 */
  const changes = useCase((s) => s.contents)
  const view = useTable((t) => t.view)
  /** ルールの追記・工事場所を保存している間（変更案の承認を止める） */
  const busy = useCase((s) => s.runtime.busy.rule)
  /** 今の列の対応（列の対応の変更案を「今 → 案」で出す） */
  const plan = useCase((s) => s.work.plan?.plan ?? null)
  /** 作業の画面（表ができてから）。閉じているときは見出しに「表を開く」を出す */
  const hasTable = useTable((t) => t.hasTable)
  const workShown = useCaseView((v) => v.layout.workShown)
  const fx = useFx()
  const location = useLocationTool()
  const proposalBase = useProposalActions()
  /** AI に頼むとよいこと（問い合わせのメールの下書き）。押すと prompt を送り、送れたら案内を消す。会話に同じ指示があれば出さない。会話の最後に出す */
  const suggestion = useInquirySuggestion()
  const fileInput = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState("")
  const [ending, setEnding] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** 送った指示がサーバーに断られたか（send が回答済みにしてよいかを決める） */
  const failed = useRef(false)

  const { messages, sendMessage, status, error, setMessages, stop } = useChat<ChatMessage>({
    id: caseId,
    transport: new DefaultChatTransport({
      api: `/api/csv/cases/${caseId}/chat`,
      prepareSendMessagesRequest: ({ messages }) => {
        const last = messages.at(-1)!
        const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
        // 表と文脈は送る瞬間の状態から作る（送るまでの手直しも入れる。大きいので送るときだけ）
        const body: ChatRequest = { id: last.id, text, ...session.chatRequest()! }
        return { body }
      },
    }),
    onData: (part) => {
      if (part.type === "data-proposal-content") actions.receiveChat(part.data)
    },
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      // 返事が届いた（たたんだ窓の未読の印。失敗は赤。職員が止めた返事は付けない）
      if (!isAbort) actions.chatArrived(isError || isDisconnect ? "error" : "new")
      // 案件の費用の合計（D1）。返事のたびに合計で置き換える
      if (message.metadata) actions.setCost(message.metadata.caseUsd)
    },
    onError: () => {
      failed.current = true
    },
  })
  const working = status === "submitted" || status === "streaming"
  /** 保存した会話。読み終えるまで送れない */
  const [history, setHistory] = useState<"loading" | "loaded" | { error: string }>("loading")
  useEffect(() => {
    let live = true
    void loadHistory(caseId).then(
      (loaded) => {
        if (!live) return
        for (const m of loaded) for (const p of m.parts) if ("toolCallId" in p) openedTools.current.add(p.toolCallId)
        setMessages(loaded)
        setHistory("loaded")
        actions.setChatLoaded(true)
      },
      (e) => live && setHistory({ error: errorMessage(e, "会話を読めませんでした") }),
    )
    return () => {
      live = false
    }
    // 読むのは開いたときの1回だけ（あとは指示の返事で会話が進む）
  }, [caseId])
  const ready = chatReady && history === "loaded"

  /**
   * 道具の結果が届いたら、その道具の作業のタブを開く（同じ道具の呼び出しで二度開かない）。
   * 保存した会話を読んだときは、読んだ道具の呼び出しを開いたことにしておく（開き直すたびにタブを動かさない）
   */
  const openedTools = useRef(new Set<string>())
  useEffect(() => {
    for (const m of messages.slice(-2)) {
      if (m.role !== "assistant") continue
      for (const p of m.parts) {
        if (!p.type.startsWith("tool-")) continue
        const call = p as { toolCallId?: string; state?: string }
        const tab = TOOL_TABS[p.type.slice(5)]
        if (!tab || !call.toolCallId || call.state !== "output-available" || openedTools.current.has(call.toolCallId)) continue
        openedTools.current.add(call.toolCallId)
        // 道具の結果が届いた（保存した会話を読んだときは開かない）
        actions.openTab(tab, "auto")
      }
    }
  }, [messages])

  /** 送れるか（ストアの1つの真実。case-view.ts の chatCanSend。送り始めてから返事が終わるまでは ui.chatTurn.sending で送れない） */
  const canSend = useCaseView((v) => v.chatCanSend)
  /**
   * 送る。送れなかった（返事の途中・会話の読み込み中、またはサーバーが断った）なら false。keepInput なら入力欄の書きかけを残す（決まった指示を送るボタン）。
   * 送り始めるその場でストアの sending を立て（送る前の保存を待つ間も。続けて押しても二度送らない）、返事が終わったら下ろす。書くのはここだけ
   */
  async function send(text = input.trim(), options: { keepInput?: true } = {}) {
    if (!text || !session.view(session.store.getState()).chatCanSend) return false
    actions.setChatSending(true)
    try {
      // 送る前に作業を保存し終える（サーバーが保存した作業から個人名を集めるため）。保存できなくても送る（表は画面が送る）
      await session.settle()
      if (!options.keepInput) setInput("")
      failed.current = false
      // 返事が終わるまで待つ（止めた・失敗したときも返る）
      await sendMessage({ text })
      return !failed.current
    } finally {
      actions.setChatSending(false)
    }
  }
  const sendRef = useRef(send)
  sendRef.current = send
  /**
   * 作業の画面から頼まれた決まった指示（「答える」の段の「AI に聞く」。ui.chatSend）を、受け取ったその場で送る。
   * 頼めるのは送れる間だけ（case-view.ts の chatCanSend。askChat）で、送り始めるその場で送っている途中になるので、ここではそのまま送る。
   * 送ったあとのサーバーの失敗は、ふつうの送り損ねと同じ表示（失敗した返事・やり直し）に任せる
   */
  const chatSend = useCase((s) => s.ui.chatSend)
  useEffect(() => {
    if (!chatSend) return
    actions.takeChatSend()
    // 送る処理は描くたびに作り直すので、最新のものを ref から呼ぶ（頼みが来たときだけ動かす）
    void sendRef.current(chatSend.text, { keepInput: true })
  }, [chatSend, actions])
  /** 会話にもう送った指示（once の案内を出さない） */
  const sentTexts = new Set(messages.flatMap((m) => (m.role === "user" ? [m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")] : [])))

  /** 画面の流れを止め、サーバーにも止めるよう伝える（流れを切るだけでは AI の呼び出しが止まらないことがある） */
  function stopTurn() {
    const turnId = [...messages].reverse().find((m) => m.role === "user")?.id
    void stop()
    if (turnId) void stopChatFn({ data: { caseId, turnId } }).catch((e) => toast.error(errorMessage(e, "止められませんでした")))
  }

  async function end() {
    setEnding(true)
    try {
      const ended = await endChatFn({ data: { caseId } })
      if (ended) {
        setMessages((ms) => [...ms, { id: ended.id, role: "system", parts: [{ type: "text", text: ended.text }] }])
      }
    } catch (e) {
      toast.error(errorMessage(e, "会話を終えられませんでした"))
    } finally {
      setEnding(false)
    }
  }

  const byId = new Map(proposals.map((p) => [p.id, p]))
  const proposalActions: ProposalActions = {
    decide: proposalBase.decide,
    // 変更案の無い聞き返しは、答えを AI に送って続けさせる（送れたときだけ回答済みにする。送れない間は答えるボタンを押せない）。
    // 変更案があれば「はい」で承認できるようになるだけ
    answer: (id, a) => {
      const p = byId.get(id)
      if (!p || p.state !== "open") return
      if (p.count > 0) {
        proposalBase.answer(id, a)
        if (a === "no") inputRef.current?.focus()
        return
      }
      void send(a === "yes" ? "はい" : "いいえ").then((sent) => sent && proposalBase.answer(id, a))
    },
    canSend,
    undo: proposalBase.undo,
    undoState: proposalBase.undoState,
    awaiting: proposalBase.awaiting,
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="チャット" data-testid="chat-panel">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <MessageSquare className="size-4 text-violet-600" />
        {/* 費用は返事ごとと、案件の合計（見出しの「…」）に出す */}
        <div className="min-w-0 flex-1 text-sm font-semibold">チャット</div>
        {hasTable && !workShown && (
          <Button size="sm" variant="outline" onClick={() => actions.setWorkShown(true)} data-testid="work-open">
            <PanelRightOpen /> 表を開く
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={end} disabled={working || ending} title="AI に渡したファイルを消し、次の指示から新しい会話にします" data-testid="chat-end">
          {ending ? <Loader2 className="animate-spin" /> : <Trash2 />}
          会話を終える
        </Button>
      </header>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 px-4 py-3" data-testid="chat-messages">
              {props.report}
              {history === "loading" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> 会話を読んでいます…
                </div>
              )}
              {typeof history === "object" && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800" data-testid="chat-error">
                  {history.error}
                </div>
              )}
              {messages.map((m, i) => (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                  <ChatMessageView
                    message={m}
                    streaming={working && i === messages.length - 1 && m.role === "assistant"}
                    proposals={byId}
                    changes={changes}
                    view={view}
                    actions={proposalActions}
                    busy={busy}
                    fx={fx}
                    location={location}
                    onAction={actions.chatAction}
                    onOpenTab={hasTable ? (t) => actions.openTab(t, "click") : null}
                    plan={plan}
                  />
                </MessageScrollerItem>
              ))}
              {status === "submitted" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="chat-working">
                  <Loader2 className="size-3.5 animate-spin" /> AI が作業しています…
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800" data-testid="chat-error">
                  {error.message}
                </div>
              )}
              {history === "loaded" && suggestion && !sentTexts.has(suggestion.prompt) && (
                <div className="grid gap-2 rounded-lg border bg-violet-50/60 px-3 py-2 text-xs dark:bg-violet-950/30" data-testid="chat-suggestion">
                  <span className="text-muted-foreground">{suggestion.text}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    disabled={!canSend}
                    onClick={() => void send(suggestion.prompt, { keepInput: true }).then((sent) => sent && actions.inquirySuggestionSent())}
                    data-testid="chat-suggestion-send"
                  >
                    <MessageSquareText /> {suggestion.label}
                  </Button>
                </div>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={ready ? "例: 金額は税込の列で（⌘+Enter で送る）" : empty ? "Excel をアップロードすると送れます" : "変換が済むと送れます"}
            disabled={!ready}
            className="min-h-16 text-sm"
            data-testid="chat-input"
          />
          <InputGroupAddon align="block-end" className="justify-between">
            {/* ファイルのアップロードの入口はここだけ（画面のどこにドラッグしても同じ） */}
            {empty ? (
              <InputGroupButton size="sm" variant="default" onClick={() => fileInput.current?.click()} data-testid="chat-attach">
                <Paperclip /> アップロード
              </InputGroupButton>
            ) : (
              <InputGroupButton size="icon-xs" variant="ghost" onClick={() => fileInput.current?.click()} aria-label="ファイルをアップロード" title="ファイルをアップロード" data-testid="chat-attach">
                <Paperclip />
              </InputGroupButton>
            )}
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              className="sr-only"
              data-testid="chat-file-input"
              onChange={(e) => {
                // 種類は案件の画面の action が見分ける（画面にドラッグしたファイルも同じ）
                if (e.target.files?.length) void actions.attach([...e.target.files])
                e.target.value = ""
              }}
            />
            {working ? (
              <InputGroupButton size="icon-xs" variant="outline" onClick={stopTurn} aria-label="止める" data-testid="chat-stop">
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" size="icon-xs" variant="default" disabled={!input.trim() || !ready} aria-label="送る" data-testid="chat-send">
                <Send />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  )
}

function ChatMessageView({
  message,
  streaming,
  proposals,
  changes,
  view,
  actions,
  busy,
  fx,
  location,
  onAction,
  onOpenTab,
  plan,
}: {
  message: ChatMessage
  location: LocationSearch
  onAction: (a: ChatAction) => void
  /** 道具の行から作業の画面のタブを開く（表がまだ無ければ null） */
  onOpenTab: ((tab: WorkTab) => void) | null
  plan: MappingPlan<KojiFieldId> | null
  streaming: boolean
  proposals: ReadonlyMap<string, Proposal>
  changes: ReadonlyMap<string, readonly ChatChange[]>
  view: TableView | null
  actions: ProposalActions
  busy: boolean
  fx: UsdJpy | null
}) {
  if (message.role === "system")
    return <p className="border-y py-1.5 text-center text-xs text-muted-foreground">{message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</p>
  if (message.role === "user")
    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="muted" align="end">
            <BubbleContent className="whitespace-pre-wrap">{message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  const meta = message.metadata
  return (
    <Message data-testid="chat-assistant">
      <MessageContent>
        {message.parts.map((p, i) => {
          if (p.type === "text") return <Markdown key={i} text={p.text} streaming={streaming} />
          if (p.type === "reasoning")
            return p.text ? (
              <Step key={i} icon={<Brain />} title="考えたこと">
                <div className="text-xs whitespace-pre-wrap text-muted-foreground">{p.text}</div>
              </Step>
            ) : null
          if (p.type === "data-location-offer")
            return (
              <div key={i} className="rounded-lg border bg-muted/20 p-2" data-testid="chat-location-offer">
                <LocationSearchStatus search={location} fx={fx} testId="chat-location" />
              </div>
            )
          if (p.type === "data-proposal") return <ProposalCard key={i} proposal={proposals.get(p.data.id)} changes={changes.get(p.data.id)} view={view} actions={actions} busy={busy} plan={plan} />
          if (p.type === "data-action") return <ActionButton key={i} action={p.data.action} onAction={onAction} />
          if (p.type.startsWith("tool-")) {
            const name = p.type.slice(5)
            const input = (p as { input?: { code?: string } }).input
            if (name === "code_execution")
              return (
                <Step key={i} icon={<Code2 />} title="コードを実行">
                  <CodeBlock size="sm">
                    <CodeBlockContent wrap className="max-h-64 text-[11px]">
                      {input?.code ?? JSON.stringify(input, null, 1) ?? ""}
                    </CodeBlockContent>
                  </CodeBlock>
                </Step>
              )
            const tab = TOOL_TABS[name]
            return (
              <Trace key={i}>
                <TraceLine>
                  <TraceIcon>
                    <Table2 />
                  </TraceIcon>
                  <TraceTitle className="text-xs text-muted-foreground">{TOOL_LABELS[name] ?? name}</TraceTitle>
                  {tab && onOpenTab && (
                    <Button size="xs" variant="ghost" className="h-5 px-1.5 text-xs text-violet-700" onClick={() => onOpenTab(tab)} data-testid="chat-open-tab" data-tab={tab}>
                      {workTabLabel(tab)}を開く
                    </Button>
                  )}
                </TraceLine>
              </Trace>
            )
          }
          return null
        })}
        {meta && (
          <MessageFooter className="px-0" data-testid="chat-reply-cost">
            {Math.round(meta.ms / 1000)}秒・道具 {meta.toolCalls} 回・<Cost usd={meta.usd} fx={fx} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

const ACTION_BUTTONS = {
  export: { label: "ダウンロードの前の確認を開く", icon: <Download /> },
} satisfies Record<ChatAction, { label: string; icon: React.ReactNode }>

function ActionButton({ action, onAction }: { action: ChatAction; onAction: (a: ChatAction) => void }) {
  const b = ACTION_BUTTONS[action]
  return (
    <Button size="sm" variant="outline" className="w-fit" onClick={() => onAction(action)} data-testid="chat-action" data-action={action}>
      {b.icon} {b.label}
    </Button>
  )
}

function Step({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>{icon}</TraceIcon>
            <TraceTitle className="text-xs">{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
