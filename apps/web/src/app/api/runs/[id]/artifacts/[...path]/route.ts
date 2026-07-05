import { readArtifact } from "@/server/artifacts"
import { notFound, runRoute } from "@/server/http"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; path: string[] }> }

export async function GET(_request: Request, context: Context) {
  const { id, path } = await context.params
  return runRoute(
    readArtifact(id, path).pipe(
      Effect.map((bytes) =>
        bytes
          ? new Response(bytes, {
              headers: {
                "content-type": "application/octet-stream",
                "cache-control": "no-store",
              },
            })
          : notFound(),
      ),
    ),
  )
}
