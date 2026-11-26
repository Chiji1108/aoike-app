import { createFileRoute, notFound } from "@tanstack/react-router"
import type { CaseLoaderData } from "@/components/cases/store/env"
import { savesSettled } from "@/components/cases/store/sync"
import { CaseWorkspace } from "@/components/cases/workspace/case-workspace"
import { getCasePageFn } from "@/server/cases"

export const Route = createFileRoute("/_authed/csv/cases/$caseId")({
  // 前に読んだ案件のデータ（戻る・先読み）で画面を描かず、読み直し終えてから描く（画面の1回分はそのときのデータから1回だけ作るので、
  // 古いデータで作ると、そのあとに届いた新しいデータを使わない）
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ params }): Promise<CaseLoaderData> => {
      // 同じ案件の画面から離れてすぐ戻ったときは、前の画面の最後の保存が終わって（あきらめて）から読む（古い版を読んで保存がぶつからない）
      const saved = await savesSettled(params.caseId)
      const page = await getCasePageFn({ data: { id: params.caseId } })
      if (!page) throw notFound()
      return { ...page, previousUnsaved: !saved }
    },
  },
  component: CasePage,
})

function CasePage() {
  const page = Route.useLoaderData()
  return <CaseWorkspace key={page.kase.id} {...page} />
}
