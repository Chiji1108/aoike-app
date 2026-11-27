import { FileText, PanelRightClose, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { FILE_KIND_LABELS, fileUrl, isSheetFile, receivedFiles, type CaseFile } from "@/lib/cases/types"
import type { MappingPlan, SheetGrid } from "@/lib/convert/plan"
import { sameHeader } from "@/lib/convert/sources"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { cn } from "@/lib/utils"
import { isStep, VIEW_LABELS, type StepView, type ToolId } from "@/lib/cases/steps"
import { StepBar } from "./step-bar"
import { StepDone } from "./step-done"
import { AnswerTab } from "./tabs/answer-tab"
import { ExportTab } from "./tabs/export-tab"
import { GyoshuTab } from "./tabs/gyoshu-tab"
import { InquiryTab } from "./tabs/inquiry-tab"
import { LocationTab } from "./tabs/location-tab"
import { ReplaceTab } from "./tabs/replace-tab"
import { TableTab } from "./tabs/table-tab"

type Plan = MappingPlan<KojiFieldId>

/**
 * 作業の画面（段の並び〔答える → 業種を決める → 直す → 問い合わせ → ダウンロード〕と、表・道具）。置くかと置き方は case-layout.tsx が layoutOf で決める
 * （広い画面では横幅いっぱいに置いてチャットは右下の窓、狭い画面では上に重ねて開く）。開いているものは lib/cases/steps.ts の activeView（選ぶまでは今の段）。
 * 直すの段と表は同じ表を1つだけ置き、直すの段では直す行だけ（理由と直し方の列つき）、表ではすべての行を出す。
 * チャットの窓が隠す分は、枠が渡す CSS の変数だけ下（表は右も）に余白を足す。どれも置いたまま（閉じても中の欄の状態を消さない）
 */
export function WorkPanel() {
  const actions = useCaseActions()
  const { view, tool } = useCaseView(useShallow((v) => ({ view: v.view, tool: v.tool })))
  const pad = "min-h-0 overflow-auto p-4 pb-[calc(1rem+var(--chat-cover-b,0px))]"
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="作業の画面" data-testid="work-panel" data-view={view}>
      <Toolbar />
      {/* 段の並びは段か表のどれかを選んだまま。道具を開いている間は段・表の中身を隠し、道具は Tabs の外に出す */}
      <Tabs
        value={view}
        onValueChange={(v: StepView) => (isStep(v) ? actions.goStep(v) : actions.setTab(v))}
        className={cn("min-h-0 gap-0", tool ? "flex-none" : "flex-1")}
      >
        <StepBar />
        <div hidden={tool !== null} className="flex min-h-0 flex-1 flex-col">
        <TabsContent value="answer" keepMounted className={pad} data-testid="answer-section" data-step-panel="answer">
          <AnswerTab />
        </TabsContent>
        <TabsContent value="gyoshu" keepMounted className={pad} data-step-panel="gyoshu">
          <div className="grid gap-4">
            <GyoshuTab />
            <StepDone step="gyoshu" />
          </div>
        </TabsContent>
        {/*
         * 直すの段と表は同じ表（並べ替え・検索・列の表示を2つに分けない）。tabpanel を1つにし、値を開いているほう（直すか表）に合わせる
         * （開いているタブの aria-controls がいつもこの panel を指す。同じ要素のままなので表の状態は消えない）。済んだ直すの段は表が空なので、済みの行を上に出す
         */}
        <TabsContent
          value={view === "fix" ? "fix" : "table"}
          keepMounted
          className="relative flex min-h-0 flex-1 flex-col gap-3 p-4"
          data-testid="table-section"
          data-kind={view === "fix" ? "fix" : "all"}
          data-step-panel={view === "fix" ? "fix" : undefined}
        >
          {view === "fix" && <StepDone step="fix" />}
          <TableTab />
        </TabsContent>
        <TabsContent value="inquiry" keepMounted className="min-h-0 overflow-auto px-4 pt-2 pb-[calc(1rem+var(--chat-cover-b,0px))]" data-step-panel="inquiry">
          <InquiryTab />
          <StepDone step="inquiry" className="mt-4" />
        </TabsContent>
        <TabsContent value="export" keepMounted className={pad} data-testid="export-section" data-step-panel="export">
          <ExportTab />
        </TabsContent>
        </div>
      </Tabs>
      {/* 道具（工事場所・一括置換）。どれも置いたまま（閉じても中の欄の状態を消さない） */}
      <ToolPanel id="location" open={tool === "location"} className={pad}>
        <LocationTab />
      </ToolPanel>
      <ToolPanel id="replace" open={tool === "replace"} className={pad} testId="replace-details">
        <ReplaceTab />
      </ToolPanel>
    </section>
  )
}

/** 道具の中身。開いていることが分かるように名前と「閉じる」（段の並びで選んでいる段・表に戻る）を上に出す */
function ToolPanel({ id, open, className, testId, children }: { id: ToolId; open: boolean; className: string; testId?: string; children: React.ReactNode }) {
  const actions = useCaseActions()
  return (
    <section hidden={!open} className="flex min-h-0 flex-1 flex-col" aria-label={VIEW_LABELS[id]} data-testid={`tool-${id}`}>
      <div className="flex items-center gap-2 border-b px-4 py-1.5 text-sm">
        <span className="font-medium">{VIEW_LABELS[id]}</span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={actions.closeTool} data-testid="tool-close">
          <X /> 閉じる
        </Button>
      </div>
      <div className={cn("flex-1", className)} data-testid={testId}>
        {children}
      </div>
    </section>
  )
}

/** 作業の画面の上: 届いたファイル（ダウンロードの控えは見出しの「…」のダウンロードの履歴）・計画の元のシート・閉じる（段の並びはその下の StepBar） */
function Toolbar() {
  const actions = useCaseActions()
  const files = useCase(useShallow((s) => receivedFiles(s.runtime.files)))
  const sourceFileId = useCase((s) => s.work.sourceFileId)
  const busy = useCase((s) => !!s.runtime.loading || s.runtime.planDraft !== null)
  const source = useCase((s) => s.runtime.source)
  const grid = useTable((t) => t.grid)
  const plan = useTable((t) => t.plan)
  const inline = useCaseView((v) => v.layout.work?.place === "inline")
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs" data-testid="case-toolbar">
      <FileChips files={files} sourceFileId={sourceFileId} loading={busy} onChoose={actions.chooseSource} />
      {source && grid && plan && source.sheets.length > 1 && (
        <SheetChooser sheets={source.sheets} primary={grid} plan={plan} onPrimary={(name) => void actions.startPlanning(source, name)} onChange={actions.changePlan} />
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <Button size="icon-sm" variant="ghost" onClick={() => actions.setWorkShown(false)} aria-label="作業の画面を閉じる" title="作業の画面を閉じる（チャットの「表を開く」で開き直せます）" data-testid="work-close">
          {inline ? <PanelRightClose /> : <X />}
        </Button>
      </div>
    </div>
  )
}

/** 届いたファイル（小さく並べる。lib/cases/types.ts の FILE_ORIGINS）。表になる届いたファイル（Excel・CSV）は変換の元に選べる（PDF は保存と一覧だけ） */
function FileChips({ files, sourceFileId, loading, onChoose }: { files: CaseFile[]; sourceFileId: string | null; loading: boolean; onChoose: (f: CaseFile) => void }) {
  if (!files.length) return null
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" data-testid="file-list">
      {files.map((f) => (
        <li
          key={f.id}
          className={cn("flex max-w-72 items-center gap-1.5 rounded-lg border px-2 py-1", f.id === sourceFileId && "border-violet-300 bg-violet-50 dark:bg-violet-950/30")}
          data-file={f.name}
          data-kind={f.kind}
          title={`${FILE_KIND_LABELS[f.kind]}・${formatSize(f.size)}`}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <a href={fileUrl(f.id)} className="truncate hover:underline" download={f.name}>
            {f.name}
          </a>
          {f.id === sourceFileId ? (
            <span className="shrink-0 font-medium text-violet-700" data-testid="current-source">
              変換の元
            </span>
          ) : (
            f.kind === "source" &&
            isSheetFile(f.name) && (
              <Button variant="ghost" size="xs" disabled={loading} onClick={() => onChoose(f)}>
                変換の元にする
              </Button>
            )
          )}
        </li>
      ))}
    </ul>
  )
}

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** 計画の元にするシートを選び直す（計画を立て直す）と、見出しが同じシートを変換に足す */
function SheetChooser({ sheets, primary, plan, onPrimary, onChange }: { sheets: SheetGrid[]; primary: SheetGrid; plan: Plan; onPrimary: (name: string) => void; onChange: (p: Plan) => void }) {
  const others = sheets.filter((s) => s !== primary && sameHeader(s, primary, plan.headerRow))
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="sheet-picker">
      <NativeSelect id="sheet" aria-label="計画の元にするシート" className="h-8 text-xs" value={primary.name} onChange={(e) => onPrimary(e.target.value)}>
        {sheets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}（{s.rows.length}行）
          </option>
        ))}
      </NativeSelect>
      {others.map((s) => (
        <label key={s.name} className="flex items-center gap-1" title="見出しが同じシート（選ぶと行を結合します）">
          <input
            type="checkbox"
            checked={plan.sheets.includes(s.name)}
            onChange={(e) => onChange({ ...plan, sheets: e.target.checked ? [...plan.sheets, s.name] : plan.sheets.filter((n) => n !== s.name) })}
          />
          ＋{s.name}
        </label>
      ))}
    </div>
  )
}
