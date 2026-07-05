import * as Data from "effect/Data"
import type { HelpTopic } from "./types.js"

export class UsageError extends Data.TaggedError("UsageError")<{
  readonly message: string
  readonly topic?: HelpTopic
}> {}

export class RuntimeError extends Data.TaggedError("RuntimeError")<{
  readonly message: string
  readonly exitCode?: number
}> {}

export class LeaseExpiredCliError extends Data.TaggedError("LeaseExpiredCliError")<{
  readonly reservationId: string
}> {}
