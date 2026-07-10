import { notFound, runRoute } from "@/server/http"
import { pruneArtifacts } from "@/server/retention"
import { PruneArtifactsRequest } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (process.env.E2E_TEST_MODE !== "1") return notFound()
  return runRoute(
    Effect.tryPromise({
      try: () => request.json(),
      catch: () => new Error("invalid JSON body"),
    }).pipe(
      Effect.flatMap((body) => Schema.decodeUnknown(PruneArtifactsRequest)(body)),
      Effect.flatMap((req) => pruneArtifacts(req.retentionDays)),
      Effect.map((result) => NextResponse.json(result)),
    ),
  )
}
