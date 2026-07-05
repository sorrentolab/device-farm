import { deviceRepo } from "@/server/device-repo"
import { runJson } from "@/server/http"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return runJson(deviceRepo.list().pipe(Effect.map((devices) => ({ devices }))))
}
