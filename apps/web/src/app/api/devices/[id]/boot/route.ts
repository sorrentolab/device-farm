import { agentClient } from "@/server/agent-client"
import { deviceRepo } from "@/server/device-repo"
import { notFound, runRoute } from "@/server/http"
import * as Effect from "effect/Effect"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// simctl bootstatus can take a while on a cold simulator
export const maxDuration = 120

type Context = { params: Promise<{ id: string }> }

/**
 * Boot a shutdown simulator/emulator through its agent. Responds once the
 * device is booted; discovery flips bootState on the next report either way.
 */
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params
  return runRoute(
    deviceRepo.getRawById(id).pipe(
      Effect.flatMap((device): Effect.Effect<Response, unknown> => {
        if (!device) return Effect.succeed(notFound())
        if (device.status === "offline")
          return Effect.succeed(NextResponse.json({ error: "device is offline" }, { status: 409 }))
        if (device.kind === "physical")
          return Effect.succeed(
            NextResponse.json({ error: "physical devices cannot be booted remotely" }, { status: 409 }),
          )
        if (device.bootState === "booted")
          return Effect.succeed(NextResponse.json({ ok: true, alreadyBooted: true }))
        return agentClient
          .boot({
            agentHost: device.agentHost,
            agentUrl: device.agentUrl,
            udid: device.udid,
            platform: device.platform as "ios" | "android",
            kind: device.kind as "simulator" | "emulator" | "physical",
          })
          .pipe(
            Effect.flatMap(() => deviceRepo.markBootedByUdid(device.udid)),
            Effect.map(() => NextResponse.json({ ok: true })),
          )
      }),
    ),
  )
}
