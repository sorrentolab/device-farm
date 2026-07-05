import { leases } from "@/db/schema"
import { agentClient } from "@/server/agent-client"
import { getDb } from "@/server/db"
import { deviceRepo } from "@/server/device-repo"
import { decodeJsonBody, notFound, runRoute } from "@/server/http"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import { and, eq, gt } from "drizzle-orm"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// A hard reset (OS reboot) can take a while on cold simulators / real devices.
export const maxDuration = 180

const RESET_WINDOW_MS = 2 * 60 * 1000

const ResetRequest = Schema.Struct({
  mode: Schema.optionalWith(Schema.Literal("soft", "hard"), { default: () => "soft" as const }),
  /** Proceed even while a job holds the device (the job is NOT canceled and will likely fail). */
  force: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(
    decodeJsonBody(ResetRequest, request).pipe(
      Effect.flatMap(({ mode, force }) =>
        Effect.gen(function* () {
          const device = yield* deviceRepo.getRawById(id)
          if (!device) return notFound()
          if (device.status === "offline")
            return NextResponse.json({ error: "device is offline" }, { status: 409 })

          const [jobLease] = yield* Effect.tryPromise({
            try: () =>
              getDb()
                .select()
                .from(leases)
                .where(
                  and(
                    eq(leases.deviceId, device.id),
                    eq(leases.kind, "job"),
                    gt(leases.expiresAt, new Date()),
                  ),
                )
                .limit(1),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          })
          if (jobLease && !force)
            return NextResponse.json(
              { error: "device is running a job — pass force to reset anyway (the job will not be canceled)" },
              { status: 409 },
            )

          if (mode === "hard") {
            yield* deviceRepo.markResetting(device.id, new Date(Date.now() + RESET_WINDOW_MS))
          }

          yield* agentClient.reset(
            {
              agentHost: device.agentHost,
              agentUrl: device.agentUrl,
              udid: device.udid,
              platform: device.platform as "ios" | "android",
              kind: device.kind as "simulator" | "emulator" | "physical",
            },
            mode,
          )
          return NextResponse.json({ ok: true, mode, forced: Boolean(jobLease && force) })
        }),
      ),
    ),
  )
}
