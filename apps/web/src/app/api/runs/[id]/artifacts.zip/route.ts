import { zipArtifacts } from "@/server/artifacts"
import { notFound, runRoute } from "@/server/http"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(
    zipArtifacts(id).pipe(
      Effect.map((buffer) =>
        buffer
          ? new Response(new Uint8Array(buffer), {
              headers: {
                "content-type": "application/zip",
                "content-disposition": `attachment; filename="dfarm-run-${id.slice(0, 8)}-artifacts.zip"`,
                "cache-control": "no-store",
              },
            })
          : notFound(),
      ),
    ),
  )
}
