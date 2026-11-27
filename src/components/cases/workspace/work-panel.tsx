import { FileText, PanelRightClose, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { NextSteps } from "@/components/cases/next-steps"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { WORK_TABS, type WorkTab } from "@/components/cases/work-tabs"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { tabBadge } from "@/lib/cases/todo"
import { FILE_KIND_LABELS, fileUrl, isSheetFile, receivedFiles, type CaseFile } from "@/lib/cases/types"
import type { MappingPlan, SheetGrid } from "@/lib/convert/plan"
import { sameHeader } from "@/lib/convert/sources"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { cn } from "@/lib/utils"
import { GyoshuTab } from "./tabs/gyoshu-tab"
import { InquiryTab } from "./tabs/inquiry-tab"
import { LocationTab } from "./tabs/location-tab"
import { ReplaceTab } from "./tabs/replace-tab"
import { SelectionTab } from "./tabs/selection-tab"
import { TableTab } from "./tabs/table-tab"

type Plan = MappingPlan<KojiFieldId>

/**
 * 作業の画面（表と、業種・7割と金額・問い合わせ・工事場所・一括置換のタブ）。置くかと置き方は case-layout.tsx が layoutOf で決める
 * （広い画面では横幅いっぱいに置いてチャットは右下の窓、狭い画面では上に重ねて開く）。チャットの窓が隠す分は、枠が渡す CSS の変数だけ下（表は右も）に余白を足す。タブはどれも置いたまま（閉じても中の欄の状態を消さない）
 */
export function WorkPanel() {
  const actions = useCaseActions()
  const tab = useCase((s) => s.ui.tab)
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="作業の画面" data-testid="work-panel">
      <Toolbar />
      <Tabs value={tab} onValueChange={(v) => actions.setTab(v as WorkTab)} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="h-10 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b px-3" aria-label="作業">
          {WORK_TABS.map((t) => (
            <TabTrigger key={t.id} id={t.id} label={t.label} />
          ))}
        </TabsList>
        <TabsContent value="table" keepMounted className="relative flex min-h-0 flex-col p-4" data-testid="table-section">
          <TableTab />
        </TabsContent>
        <TabsContent value="gyoshu" keepMounted className="min-h-0 overflow-auto p-4 pb-[calc(1rem+var(--chat-cover-b,0px))]">
          <GyoshuTab />
        </TabsContent>
        <TabsContent value="selection" keepMounted className="min-h-0 overflow-auto p-4 pb-[calc(1rem+var(--chat-cover-b,0px))]" data-testid="selection-section">
          <SelectionTab />
        </TabsContent>
        <TabsContent value="inquiry" keepMounted className="min-h-0 overflow-auto px-4 pt-2 pb-[calc(1rem+var(--chat-cover-b,0px))]">
          <InquiryTab />
        </TabsContent>
        <TabsContent value="location" keepMounted className="min-h-0 overflow-auto p-4 pb-[calc(1rem+var(--chat-cover-b,0px))]">
          <LocationTab />
        </TabsContent>
        <TabsContent value="replace" keepMounted className="min-h-0 overflow-auto p-4 pb-[calc(1rem+var(--chat-cover-b,0px))]" data-testid="replace-details">
          <ReplaceTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}

/** タブの名前と数（lib/cases/todo.ts の数を読むだけ） */
function TabTrigger({ id, label }: { id: WorkTab; label: string }) {
  const badge = useCaseView((v) => tabBadge(v.todo, id))
  return (
    <TabsTrigger value={id} className="flex-none px-2.5" data-testid={`tab-${id}`}>
      {label}
      {badge > 0 && <span className="num rounded-full bg-muted px-1.5 text-xs">{badge}</span>}
    </TabsTrigger>
  )
}

/** 作業の画面の上: 届いたファイル（ダウンロードの控えは見出しの「…」のダウンロードの履歴）・計画の元のシート・次にやること・閉じる */
function Toolbar() {
  const actions = useCaseActions()
  const files = useCase(useShallow((s) => receivedFiles(s.runtime.files)))
  const sourceFileId = useCase((s) => s.work.sourceFileId)
  const busy = useCase((s) => !!s.runtime.loading || s.runtime.planDraft !== null)
  const source = useCase((s) => s.runtime.source)
  const grid = useTable((t) => t.grid)
  const plan = useTable((t) => t.plan)
  const reconverting = useTable((t) => t.reconverting)
  const todo = useCaseView((v) => v.todo)
  const inline = useCaseView((v) => v.layout.work?.place === "inline")
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs" data-testid="case-toolbar">
      <FileChips files={files} sourceFileId={sourceFileId} loading={busy} onChoose={actions.chooseSource} />
      {source && grid && plan && source.sheets.length > 1 && (
        <SheetChooser sheets={source.sheets} primary={grid} plan={plan} onPrimary={(name) => void actions.startPlanning(source, name)} onChange={actions.changePlan} />
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <NextSteps steps={todo} onGo={actions.goStep} exportDisabled={reconverting} />
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
