import { deviceRepo } from "@/server/device-repo"
import { decodeJsonBody, notFound, runRoute } from "@/server/http"
import { WatchRequest } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(
    decodeJsonBody(WatchRequest, request).pipe(
      Effect.flatMap((body) => deviceRepo.setWatched(id, body.watched)),
      Effect.map((device) => (device ? NextResponse.json(device) : notFound())),
    ),
  )
}
