import * as Effect from "effect/Effect"
// Embedded at build time from the canonical agent-facing doc — single source
// of truth; `mise run cli:install` picks up doc edits automatically.
import usingDfarm from "../../../../docs/using-dfarm.md" with { type: "text" }
import { writeStdout } from "../io.js"

export const runDocs = (): Effect.Effect<number> =>
  writeStdout(`${usingDfarm.trimEnd()}\n\nCommand reference: dfarm --help · per-command: dfarm <command> --help\n`).pipe(
    Effect.map(() => 0),
  )
