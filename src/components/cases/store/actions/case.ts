import { toast } from "sonner"
import type { CaseStatus } from "@/lib/cases/types"
import { errorMessage } from "@/lib/errors"
import { setRuntime } from "../create-case-store"
import type { CaseEnv } from "../env"

/**
 * 案件の状態を変える（楽観的に変え、失敗したら、その後に変えていなければサーバーが最後に受け付けた状態に戻す。
 * 続けて失敗しても、前の楽観的な値〔サーバーに無い状態〕には戻さない）。完了にしたら振り返りを案内する（完了から戻せば消す）
 */
export async function changeStatus(env: CaseEnv, next: CaseStatus) {
  const { store } = env
  const id = store.getState().runtime.gen.status + 1
  setRuntime(store, (r) => ({ status: next, gen: { ...r.gen, status: id } }))
  const current = () => store.getState().runtime.gen.status === id
  try {
    await env.deps.updateStatus(next)
    setRuntime(store, (r) => ({ savedStatus: next, ...(current() ? { hints: { ...r.hints, review: next === "done" } } : {}) }))
  } catch (e) {
    if (current()) setRuntime(store, (r) => ({ status: r.savedStatus }))
    toast.error(errorMessage(e, "状態を変えられませんでした"))
  }
}
