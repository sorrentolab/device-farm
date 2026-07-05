import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { SeedClient, waitForDeviceStatus, waitForJobDetail } from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

const deviceIdByUdid = (udid: string) =>
  client.listDevices().pipe(
    Effect.map(({ devices }) => {
      const device = devices.find((d) => d.udid === udid)
      if (!device) throw new Error(`device ${udid} not registered`)
      return device.id
    }),
  )

const reset = (deviceId: string, body: object) =>
  fetch(`${process.env.DFARM_URL}/api/devices/${deviceId}/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("device reset", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("resets an idle device, refuses while a job runs, and force overrides", async () => {
    // Given an idle booted stub simulator.
    const idleId = await Effect.runPromise(deviceIdByUdid("stub-ios-2"))

    // When the operator soft-resets it. Then the farm accepts.
    const ok = await reset(idleId, {})
    expect(ok.status).toBe(200)

    // Given a job actively running on the other simulator.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 8_000 }))
    const job = await Effect.runPromise(
      client.submitJob({
        requirements: { deviceUdid: "stub-ios-1" },
        payload: { flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n", env: {} },
        createdBy: "e2e-web-reset-device",
      }),
    )
    await waitForJobDetail(client, job.id, (d) => d.job.status === "running", {
      timeoutMs: 15_000,
      description: "job to start running",
    })
    const busyId = await Effect.runPromise(deviceIdByUdid("stub-ios-1"))

    // When the operator resets the busy device without force. Then the farm refuses
    // with a clear reason and does not touch the job.
    const refused = await reset(busyId, {})
    expect(refused.status).toBe(409)
    const refusal = (await refused.json()) as { error: string }
    expect(refusal.error).toContain("running a job")

    // When the operator force-resets it. Then the farm proceeds (the job is left alone).
    const forced = await reset(busyId, { force: true })
    expect(forced.status).toBe(200)
    const body = (await forced.json()) as { forced: boolean }
    expect(body.forced).toBe(true)
  })

  test("a hard reset reboots the device without the farm mistaking it for a lost device", async () => {
    // Given an idle booted stub simulator.
    const deviceId = await Effect.runPromise(deviceIdByUdid("stub-ios-2"))

    // When the operator hard-resets it (the stub vanishes from discovery for a few seconds).
    const res = await reset(deviceId, { mode: "hard" })
    expect(res.status).toBe(200)

    // Then the device is never reported offline during the reboot window…
    for (let i = 0; i < 6; i += 1) {
      const { devices } = await Effect.runPromise(client.listDevices())
      const d = devices.find((x) => x.udid === "stub-ios-2")
      expect(d?.status).not.toBe("offline")
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }

    // …and is back online once rebooted.
    await waitForDeviceStatus(client, "stub-ios-2", "online", { timeoutMs: 15_000 })
  })
})
