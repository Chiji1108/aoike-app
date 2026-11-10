import handler from "@tanstack/react-start/server-entry"
import { getFitDb } from "./db"
import { emptyTrash } from "./server/fit-store"

/**
 * Worker の入口。画面とサーバー関数は TanStack Start のまま、工事場所の一括調査の Workflow のクラスを足す。
 * 毎日の定時の処理（wrangler.jsonc の triggers）で、FIT の書類のゴミ箱から30日たったものを消す
 */
export { LocationSearchWorkflow } from "./server/location-workflow"

export default {
  fetch: (request) => handler.fetch(request),
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      emptyTrash(getFitDb(), env.FIT_FILES).then((n) => {
        if (n > 0) console.log(`FIT の書類のゴミ箱から ${n} 件を消しました`)
      }),
    )
  },
} satisfies ExportedHandler<Env>
