import { jobActions } from "@/server/job-actions"
import { jobRepo } from "@/server/job-repo"
import { noContent, notFound, runRoute } from "@/server/http"
import * as Effect from "effect/Effect"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(
    jobRepo.detail(id).pipe(Effect.map((detail) => (detail ? NextResponse.json(detail) : notFound()))),
  )
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(jobActions.cancel(id).pipe(Effect.as(noContent())))
}
