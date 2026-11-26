import { toast } from "sonner"
import type { CaseStatus } from "@/lib/cases/types"
import { errorMessage } from "@/lib/errors"
import { setRuntime } from "../create-case-store"
import type { CaseEnv } from "../env"

/**
 * 案件の状態を変える（楽観的に変え、失敗したら、その後に変えていなければ元に戻す）。完了にしたら振り返りを案内する（完了から戻せば消す）
 */
export async function changeStatus(env: CaseEnv, next: CaseStatus) {
  const { store } = env
  const before = store.getState().runtime.status
  const id = store.getState().runtime.gen.status + 1
  setRuntime(store, (r) => ({ status: next, gen: { ...r.gen, status: id } }))
  const current = () => store.getState().runtime.gen.status === id
  try {
    await env.deps.updateStatus(next)
    if (current()) setRuntime(store, (r) => ({ hints: { ...r.hints, review: next === "done" } }))
  } catch (e) {
    if (current()) setRuntime(store, () => ({ status: before }))
    toast.error(errorMessage(e, "状態を変えられませんでした"))
  }
}
