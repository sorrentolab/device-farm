import * as Data from "effect/Data"

/** Device vanished mid-operation (unplugged, simulator shut down, agent lost it). */
export class DeviceLostError extends Data.TaggedError("DeviceLostError")<{
  readonly deviceId: string
  readonly message: string
}> {}

/** No online, unleased device matches the job's requirements right now. */
export class NoDeviceAvailableError extends Data.TaggedError("NoDeviceAvailableError")<{
  readonly requirements: unknown
  /** a matching shutdown simulator exists and could be booted */
  readonly bootableCandidateUdid?: string
  /** NO registered device matches at all (not just busy/offline) — waiting will never help */
  readonly noMatchingDevice?: boolean
}> {}

/** Lease token invalid, released, or past its TTL — API surfaces this as HTTP 410. */
export class LeaseExpiredError extends Data.TaggedError("LeaseExpiredError")<{
  readonly leaseId: string
}> {}

/** The agent's local HTTP server didn't respond. */
export class AgentUnreachableError extends Data.TaggedError("AgentUnreachableError")<{
  readonly agentHost: string
  readonly message: string
}> {}

/** Non-2xx from the dfarm REST API. */
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number
  readonly message: string
}> {}
