import { createFileRoute } from "@tanstack/react-router"
import { downloadCaseFile } from "@/server/file-routes"

export const Route = createFileRoute("/api/csv/files/$fileId")({
  server: { handlers: { GET: ({ request, params }) => downloadCaseFile(request, params.fileId) } },
})
