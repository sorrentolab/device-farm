import { ApiError } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import type { CliContext } from "../context.js"
import { RuntimeError } from "../errors.js"
import { writeStderr, writeStdout } from "../io.js"
import type { ResetCommand } from "../types.js"

export const runReset = (
  context: CliContext,
  command: ResetCommand,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    const { devices } = yield* context.client.listDevices()
    const device = devices.find((d) => d.udid === command.udid)
    if (!device) {
      yield* writeStderr(`no device with udid '${command.udid}' — see dfarm devices\n`)
      return 1
    }

    yield* context.client.resetDevice(device.id, { mode: command.mode, force: command.force })
    yield* writeStdout(
      `${command.mode === "hard" ? "rebooting" : "reset"} ${device.name} (${device.udid})\n`,
    )
    if (command.mode === "hard") {
      yield* writeStderr("device will drop from the list briefly and return once booted\n")
    }
    return 0
  })
