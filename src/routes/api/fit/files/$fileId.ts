import { createFileRoute } from "@tanstack/react-router"
import { downloadFitFile } from "@/server/fit-file-routes"

export const Route = createFileRoute("/api/fit/files/$fileId")({
  server: { handlers: { GET: ({ request, params }) => downloadFitFile(request, params.fileId) } },
})
