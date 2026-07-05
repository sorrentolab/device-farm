import type { ApiError } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import { formatHeldBy, formatJson, formatTable } from "../format.js"
import { writeStdout } from "../io.js"
import type { CliContext } from "../context.js"
import type { DevicesCommand } from "../types.js"

export const runDevices = (
  context: CliContext,
  command: DevicesCommand,
): Effect.Effect<number, ApiError> =>
  Effect.gen(function* () {
    const devices = yield* context.client.listDevices()
    if (command.json) {
      yield* writeStdout(formatJson(devices))
      return 0
    }

    yield* writeStdout(
      formatTable(
        ["NAME", "PLATFORM", "KIND", "OS", "STATUS", "UDID", "HELD BY"],
        devices.devices.map((device) => [
          device.name,
          device.platform,
          device.kind,
          device.osVersion,
          device.status,
          device.udid,
          formatHeldBy(device),
        ]),
      ),
    )

    return 0
  })
