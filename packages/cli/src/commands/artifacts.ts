import type { ApiError } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import { join } from "node:path"
import type { CliContext } from "../context.js"
import { RuntimeError } from "../errors.js"
import { latestRun } from "../format.js"
import { writeFileBytesWithParents, writeStderr, writeStdout } from "../io.js"
import type { ArtifactsCommand } from "../types.js"

export const runArtifacts = (
  context: CliContext,
  command: ArtifactsCommand,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    const detail = yield* context.client.getJob(command.jobId)
    const run =
      command.attempt === undefined
        ? latestRun(detail.runs)
        : detail.runs.find((candidate) => candidate.attempt === command.attempt)

    if (!run) {
      return yield* Effect.fail(
        new RuntimeError({
          message:
            command.attempt === undefined
              ? "job has no runs yet"
              : `job has no run for attempt ${command.attempt}`,
        }),
      )
    }

    const { files } = yield* context.client.listRunArtifacts(run.id)
    if (files.length === 0) {
      yield* writeStderr("no artifacts for this run\n")
      return 1
    }

    const outDir = command.outDir ?? join("dfarm-artifacts", command.jobId)
    for (const file of files) {
      const bytes = yield* context.client.downloadRunArtifact(run.id, file)
      const outputPath = join(outDir, file)
      yield* writeFileBytesWithParents(outputPath, bytes)
      yield* writeStdout(`${outputPath}\n`)
    }

    return 0
  })
