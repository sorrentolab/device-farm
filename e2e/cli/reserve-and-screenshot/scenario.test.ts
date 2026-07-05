import type { Device } from "@dfarm/shared"
import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DfarmCli,
  SeedClient,
  eventually,
  extractReservationFromCli,
} from "../../setup/harness.js"

const seed = new SeedClient()
const cli = new DfarmCli()

describe("dfarm reserve and shot", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("captures a screenshot through an Android reservation and rejects it after TTL expiry", async () => {
    // Given an available stub Android emulator.
    const outDir = await mkdtemp(join(tmpdir(), "dfarm-e2e-shot-"))
    const shotPath = join(outDir, "shot.png")

    // When a user reserves Android for 30 seconds and captures a screenshot.
    const reserve = await cli.run(["reserve", "--platform", "android", "--ttl", "30s", "--wait"], {
      env: { DFARM_CLIENT: "e2e-cli-reserve-and-screenshot" },
    })
    expect(reserve.exitCode).toBe(0)
    const reservation = extractReservationFromCli(reserve)

    const shot = await cli.run([
      "shot",
      reservation.id,
      "--token",
      reservation.token,
      "--out",
      shotPath,
    ])

    // Then the screenshot file is a non-empty image.
    expect(shot.exitCode).toBe(0)
    expect((await stat(shotPath)).size).toBeGreaterThan(0)
    expect([...await readFile(shotPath)].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47])

    // When the TTL expires.
    const expiredShot = await eventually(
      () =>
        Effect.promise(async () => {
          const result = await cli.run([
            "shot",
            reservation.id,
            "--token",
            reservation.token,
            "--out",
            join(outDir, "expired.png"),
          ])
          if (result.exitCode !== 3) {
            throw new Error(`shot still accepted with exit ${result.exitCode}`)
          }
          return result
        }),
      { timeoutMs: 60_000, intervalMs: 1_000, description: "reservation screenshot to expire" },
    )

    // Then the CLI exits with the lease-expired code and the emulator is available again.
    expect(expiredShot.exitCode).toBe(3)
    const devices = await eventually(
      () =>
        Effect.promise(async () => {
          const result = await cli.run(["devices", "--json"])
          if (result.exitCode !== 0) throw new Error(result.stderr)
          const parsed = JSON.parse(result.stdout) as { readonly devices: readonly Device[] }
          const android = parsed.devices.find((device) => device.udid === "stub-android-1")
          if (!android) throw new Error("stub Android emulator is missing")
          if (android.status !== "online" || android.currentLeaseKind !== null) {
            throw new Error(`stub Android emulator is ${android.status}/${android.currentLeaseKind}`)
          }
          return parsed
        }),
      { timeoutMs: 60_000, intervalMs: 1_000, description: "Android emulator to be available" },
    )
    expect(devices.devices.find((device) => device.udid === "stub-android-1")?.status).toBe("online")
  })
})
