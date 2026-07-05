import * as Effect from "effect/Effect"
import { RuntimeError } from "./errors.js"

export const writeStdout = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(text)
  })

export const writeStderr = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(text)
  })

export const writeStdoutBytes = (bytes: Uint8Array): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(bytes)
  })

export const writeFileBytes = (
  path: string,
  bytes: Uint8Array,
): Effect.Effect<void, RuntimeError> =>
  Effect.tryPromise({
    try: async () => {
      await Bun.write(path, bytes)
    },
    catch: (error) =>
      new RuntimeError({
        message: `failed to write ${path}: ${formatUnknownError(error)}`,
      }),
  })

export const readTextFile = (path: string): Effect.Effect<string, RuntimeError> =>
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (error) =>
      new RuntimeError({
        message: `failed to read ${path}: ${formatUnknownError(error)}`,
      }),
  })

export const sleep = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

export const formatUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
