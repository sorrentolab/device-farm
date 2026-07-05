import * as Schema from "effect/Schema"
import { Device, Job, Run } from "./domain.js"

/** Messages pushed to the dashboard over WS (or SSE fallback — same payloads). */
export const RealtimeMessage = Schema.Union(
  Schema.Struct({ type: Schema.Literal("device.updated"), device: Device }),
  Schema.Struct({ type: Schema.Literal("job.updated"), job: Job }),
  Schema.Struct({ type: Schema.Literal("run.updated"), run: Run }),
  Schema.Struct({
    type: Schema.Literal("run.log"),
    runId: Schema.String,
    line: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("frame"),
    deviceId: Schema.String,
    /** JPEG, base64 — ~1fps per watched device */
    jpegBase64: Schema.String,
    at: Schema.String,
  }),
)
export type RealtimeMessage = typeof RealtimeMessage.Type
