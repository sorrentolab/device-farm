import { listArtifacts } from "@/server/artifacts"
import { notFound, runRoute } from "@/server/http"
import * as Effect from "effect/Effect"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(
    listArtifacts(id).pipe(Effect.map((result) => (result ? NextResponse.json(result) : notFound()))),
  )
}
