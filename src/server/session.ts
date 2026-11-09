import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { getAuth } from "@/lib/auth"
import type { UserRole } from "@/lib/constants"

export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
  // null を返すとレスポンスなし扱いになるため、必ずオブジェクトで返す
  return { userId: session?.user.id ?? null, role: (session?.user.role as UserRole | undefined) ?? null }
})
