import { deviceRepo } from "@/server/device-repo"
import { decodeJsonBody, runJson } from "@/server/http"
import { AgentReport } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return runJson(decodeJsonBody(AgentReport, request).pipe(Effect.flatMap(deviceRepo.report)))
}
