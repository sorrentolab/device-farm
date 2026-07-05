"use client"

import { DeviceCard } from "@/components/device-card"
import { deviceSort, useFarm } from "@/lib/use-farm"

export function DevicesView() {
  const { devices, frames, error } = useFarm()

  return (
    <main>
      <h1>Devices</h1>
      <p className="subtitle">
        Everything the agents can see. Watch a device to stream its screen at ~1fps.
      </p>
      {error && <div className="error-banner">Can’t reach the farm API: {error}</div>}
      {devices === null ? (
        <div className="empty">Loading…</div>
      ) : devices.length === 0 ? (
        <div className="empty">
          No devices yet. Is a device agent running? (<code>mise run dev:agent</code>)
        </div>
      ) : (
        <div className="grid">
          {[...devices].sort(deviceSort).map((d) => (
            <DeviceCard key={d.id} device={d} frame={frames[d.id] ?? null} />
          ))}
        </div>
      )}
    </main>
  )
}
