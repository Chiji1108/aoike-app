import { useEffect, useState } from "react"
import { AppShell, CSV } from "@/components/app-shell"
import { CaseSessionContext } from "@/components/cases/store/context"
import { serverDeps } from "@/components/cases/store/deps"
import type { CaseLoaderData } from "@/components/cases/store/env"
import { createCaseSession } from "@/components/cases/store/session"
import { CaseDialogs } from "./dialogs"
import { CaseHeader } from "./case-header"
import { CaseLayout } from "./case-layout"
import { FocusEffects } from "./focus-effects"
import { WorkspaceToolsProvider } from "./tools"

/** 作業の画面をチャットの横に並べる画面の幅（これより狭い画面ではチャットを画面いっぱいにし、作業の画面は上に重ねて開く） */
const WIDE_QUERY = "(min-width: 1280px)"

/**
 * 案件の画面。案件の1回分（ストア・表の派生・action・保存）を案件ごとに1つ作って渡し、部品を並べるだけ
 * （部品はストアの一部を読み、action で変える。key={kase.id} なので案件が変われば作り直す）
 */
export function CaseWorkspace(page: CaseLoaderData) {
  const [session] = useState(() => createCaseSession(page, serverDeps(page.kase.id)))
  // 保存の層をつなぐ（初めてつないだときに変換の元・去年の Excel を読み始める）
  useEffect(() => session.connect(), [session])
  // 画面の幅をストアに入れる（並べ方・タブの開き方は action と layoutOf が読む。サーバーで描くときは狭い画面のまま）
  useEffect(() => {
    const m = window.matchMedia(WIDE_QUERY)
    session.actions.setWide(m.matches)
    const on = (e: MediaQueryListEvent) => session.actions.setWide(e.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [session])
  const { customer, kase } = page
  return (
    <CaseSessionContext.Provider value={session}>
      <WorkspaceToolsProvider>
        <AppShell tool={CSV} fill>
          <CaseLayout header={<CaseHeader customer={customer} fiscalYear={kase.fiscalYear} />} />
          <CaseDialogs customer={customer} fiscalYear={kase.fiscalYear} />
          <FocusEffects />
        </AppShell>
      </WorkspaceToolsProvider>
    </CaseSessionContext.Provider>
  )
}
