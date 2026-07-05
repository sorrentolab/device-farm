#!/usr/bin/env bun

import { ApiError } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import { parseArgs } from "./args.js"
import { runDevices } from "./commands/devices.js"
import { runCancel, runFlow, runStatus } from "./commands/jobs.js"
import {
  runExec,
  runExtend,
  runRelease,
  runReserve,
  runShot,
} from "./commands/reservations.js"
import { makeContext, type CliContext } from "./context.js"
import { LeaseExpiredCliError, RuntimeError, UsageError } from "./errors.js"
import { commandHelp, rootHelp } from "./help.js"
import { formatUnknownError, writeStderr, writeStdout } from "./io.js"
import type { CliCommand } from "./types.js"

const dispatch = (
  context: CliContext,
  command: CliCommand,
): Effect.Effect<number, ApiError | RuntimeError | UsageError | LeaseExpiredCliError> => {
  switch (command._tag) {
    case "Help":
      return writeStdout(command.topic ? commandHelp(command.topic) : rootHelp()).pipe(
        Effect.as(0),
      )
    case "Devices":
      return runDevices(context, command)
    case "Run":
      return runFlow(context, command)
    case "Reserve":
      return runReserve(context, command)
    case "Shot":
      return runShot(context, command)
    case "Exec":
      return runExec(context, command)
    case "Extend":
      return runExtend(context, command)
    case "Release":
      return runRelease(context, command)
    case "Status":
      return runStatus(context, command)
    case "Cancel":
      return runCancel(context, command)
  }
}

const renderError = (
  context: CliContext,
  error: ApiError | RuntimeError | UsageError | LeaseExpiredCliError,
): Effect.Effect<number> => {
  if (error instanceof UsageError) {
    const suffix = error.topic
      ? `Run 'dfarm ${error.topic} --help' for usage.`
      : "Run 'dfarm --help' for usage."
    return writeStderr(`error: ${error.message}\n${suffix}\n`).pipe(Effect.as(2))
  }

  if (error instanceof LeaseExpiredCliError) {
    return writeStderr(
      `reservation ${error.reservationId} has expired or the lease token is invalid\n`,
    ).pipe(Effect.as(3))
  }

  if (error instanceof RuntimeError) {
    return writeStderr(`error: ${error.message}\n`).pipe(Effect.as(error.exitCode ?? 1))
  }

  if (error instanceof ApiError) {
    const message =
      error.status === 0
        ? `could not reach dfarm server at ${context.baseUrl}: ${error.message}`
        : `dfarm API error (${error.status}): ${error.message}`
    return writeStderr(`error: ${message}\n`).pipe(Effect.as(1))
  }

  return writeStderr(`error: ${formatUnknownError(error)}\n`).pipe(Effect.as(1))
}

const context = makeContext()
const program = parseArgs(Bun.argv.slice(2)).pipe(
  Effect.flatMap((command) => dispatch(context, command)),
  Effect.catchAll((error) => renderError(context, error)),
)

const exitCode = await Effect.runPromise(program)
process.exitCode = exitCode
