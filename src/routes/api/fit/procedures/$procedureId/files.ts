import { createFileRoute } from "@tanstack/react-router"
import { uploadFitFile } from "@/server/fit-file-routes"

export const Route = createFileRoute("/api/fit/procedures/$procedureId/files")({
  server: { handlers: { POST: ({ request, params }) => uploadFitFile(request, params.procedureId) } },
})
