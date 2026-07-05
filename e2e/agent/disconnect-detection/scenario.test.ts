import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { SeedClient, waitForDeviceStatus } from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

describe("stub agent disconnect detection", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("marks a disconnected device offline promptly and online again after reconnect", async () => {
    // Given a default stub iOS simulator is online.
    await waitForDeviceStatus(client, "stub-ios-1", "online", { timeoutMs: 10_000 })

    // When the stub agent reports that simulator as disconnected.
    await Effect.runPromise(seed.stub({ type: "disconnect", udid: "stub-ios-1" }))

    // Then the public devices API marks it offline through the agent-report path.
    const offline = await waitForDeviceStatus(client, "stub-ios-1", "offline", {
      timeoutMs: 10_000,
      description: "stub-ios-1 to be marked offline",
    })
    expect(offline.udid).toBe("stub-ios-1")

    // When the stub agent reconnects the simulator.
    await Effect.runPromise(seed.stub({ type: "reconnect", udid: "stub-ios-1" }))

    // Then the public devices API shows it online again.
    const online = await waitForDeviceStatus(client, "stub-ios-1", "online", {
      timeoutMs: 10_000,
      description: "stub-ios-1 to come back online",
    })
    expect(online.udid).toBe("stub-ios-1")
  })
})
