import type { ApiError, DfarmClient, JobDetail } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { CliContext } from "../context.js"
import { RuntimeError } from "../errors.js"
import { formatJobFinalLine, formatJobStatus, formatJson, isTerminalJobStatus, latestRun } from "../format.js"
import { readTextFile, sleep, writeStderr, writeStdout } from "../io.js"
import type { CancelCommand, RunCommand, StatusCommand } from "../types.js"

const pollIntervalMs = 1000

export const runFlow = (
  context: CliContext,
  command: RunCommand,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    const flowYaml = yield* readTextFile(command.flowPath)
    const job = yield* context.client.submitJob({
      requirements: command.requirements,
      payload: {
        flowYaml,
        appPath: command.appPath,
        appBundleId: command.appBundleId,
        env: command.env,
        recordVideo: command.record,
      },
      createdBy: context.createdBy,
      maxAttempts: command.maxAttempts,
    })

    if (!command.wait) {
      yield* writeStdout(`${job.id}\n`)
      return 0
    }

    // Always surface the job id up front so a queued/stuck job is inspectable
    // (dfarm status <id>, dashboard) even before any log output arrives.
    yield* writeStderr(`job ${job.id} submitted — waiting for a device\n`)

    const exitCode = yield* tailUntilDone(context, job.id)
    if (command.record) {
      yield* writeStderr(`artifacts (incl. recording): dfarm artifacts ${job.id}\n`)
    }
    return exitCode
  })

/**
 * Stream a job's logs to stdout until it reaches a terminal status, then exit
 * with the run's code. Survives dropped streams (idle timeouts, server
 * restarts): the server replays logs on reconnect, dedupe is by line count.
 * Shared by `run --wait` and `status --wait` — the latter is the resume path
 * when a wait stream dies on the client side.
 */
const tailUntilDone = (
  context: CliContext,
  jobId: string,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    let printed = 0
    while (true) {
      let seen = 0
      yield* Stream.runForEach(context.client.tailJobLogs(jobId), (line) => {
        seen += 1
        if (seen <= printed) return Effect.void
        printed = seen
        return writeStdout(`${line}\n`)
      }).pipe(Effect.catchAll(() => Effect.void))

      const check = yield* context.client.getJob(jobId).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      )
      if (check && isTerminalJobStatus(check.job.status)) break
      yield* sleep(pollIntervalMs)
    }

    const detail = yield* waitForTerminalJob(context.client, jobId)
    yield* writeStderr(`${formatJobFinalLine(detail)}\n`)

    if (detail.job.status === "passed") return 0
    return latestRun(detail.runs)?.exitCode ?? 1
  })

export const runStatus = (
  context: CliContext,
  command: StatusCommand,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    if (command.wait) {
      const detail = yield* context.client.getJob(command.jobId)
      yield* writeStderr(
        `job ${detail.job.id} is ${detail.job.status} — attaching to log stream\n`,
      )
      return yield* tailUntilDone(context, command.jobId)
    }
    const detail = yield* context.client.getJob(command.jobId)
    yield* writeStdout(command.json ? formatJson(detail) : formatJobStatus(detail))
    return 0
  })

export const runCancel = (
  context: CliContext,
  command: CancelCommand,
): Effect.Effect<number, ApiError> =>
  Effect.gen(function* () {
    yield* context.client.cancelJob(command.jobId)
    return 0
  })

const waitForTerminalJob = (
  client: DfarmClient,
  jobId: string,
): Effect.Effect<JobDetail, ApiError> =>
  client.getJob(jobId).pipe(
    Effect.flatMap((detail) => {
      if (isTerminalJobStatus(detail.job.status)) return Effect.succeed(detail)
      return sleep(pollIntervalMs).pipe(Effect.flatMap(() => waitForTerminalJob(client, jobId)))
    }),
  )
