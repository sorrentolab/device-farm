import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
  SeedClient,
  defaultStubUdids,
  waitForDeviceStatus,
} from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

const expectFreshHeartbeat = (heartbeat: string | null) => {
  expect(heartbeat).not.toBeNull()
  expect(Date.now() - new Date(heartbeat!).getTime()).toBeLessThan(15_000)
}

describe("stub agent registration and heartbeat", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("registers default devices with fresh heartbeats and reports a newly added device", async () => {
    // Given the e2e stack is running with the stub agent.
    const { devices } = await Effect.runPromise(client.listDevices())

    // Then the default stub devices are online with fresh lastHeartbeatAt values.
    for (const udid of defaultStubUdids) {
      const device = devices.find((candidate) => candidate.udid === udid)
      expect(device).toBeDefined()
      expect(device?.status).toBe("online")
      expectFreshHeartbeat(device?.lastHeartbeatAt ?? null)
    }

    // When the stub agent is commanded to add another booted device.
    const addedUdid = `stub-ios-extra-${Date.now()}`
    await Effect.runPromise(
      seed.addDevice({
        udid: addedUdid,
        platform: "ios",
        kind: "simulator",
        name: "E2E Extra iPhone",
        osVersion: "18.1",
        bootState: "booted",
      }),
    )

    // Then that device appears through the public devices API within the heartbeat window.
    const added = await waitForDeviceStatus(client, addedUdid, "online", {
      timeoutMs: 10_000,
      description: "added stub device to register",
    })
    expect(added.name).toBe("E2E Extra iPhone")
    expectFreshHeartbeat(added.lastHeartbeatAt)
  })
})
