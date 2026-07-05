"use client"

import { useState } from "react"
import type { Device } from "@dfarm/shared"
import { DeviceTable } from "@/components/devices/device-table"
import { LiveCard } from "@/components/devices/live-card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { deviceSort, useFarm } from "@/lib/use-farm"

type PlatformFilter = "all" | "ios" | "android"
type TypeFilter = "all" | "virtual" | "physical"

const matchesType = (d: Device, t: TypeFilter) =>
  t === "all" || (t === "physical" ? d.kind === "physical" : d.kind !== "physical")

export function DevicesView() {
  const { devices, frames, error } = useFarm()
  const [platform, setPlatform] = useState<PlatformFilter>("all")
  const [type, setType] = useState<TypeFilter>("all")

  const all = devices ?? []
  const watched = all.filter((d) => d.watched).sort(deviceSort)
  const filtered = all
    .filter((d) => platform === "all" || d.platform === platform)
    .filter((d) => matchesType(d, type))
    .sort(deviceSort)

  return (
    <main>
      <h1>Devices</h1>
      <p className="subtitle">
        Everything the agents can see. Watch a device to stream its screen at ~1fps.
      </p>
      {error && <div className="error-banner">Can’t reach the farm API: {error}</div>}

      {watched.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-ok" /> Live view
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {watched.map((d) => (
              <LiveCard key={d.id} device={d} frame={frames[d.id] ?? null} />
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ToggleGroup
          value={[platform]}
          onValueChange={(v) => v[0] && setPlatform(v[0] as PlatformFilter)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="all" className="px-3 text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="ios" className="px-3 text-xs">iOS</ToggleGroupItem>
          <ToggleGroupItem value="android" className="px-3 text-xs">Android</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          value={[type]}
          onValueChange={(v) => v[0] && setType(v[0] as TypeFilter)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="all" className="px-3 text-xs">All types</ToggleGroupItem>
          <ToggleGroupItem value="virtual" className="px-3 text-xs">Virtual</ToggleGroupItem>
          <ToggleGroupItem value="physical" className="px-3 text-xs">Physical</ToggleGroupItem>
        </ToggleGroup>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {all.length} devices
        </span>
      </div>

      {devices === null ? (
        <div className="empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {all.length === 0 ? (
            <>No devices yet. Is a device agent running? (<code>mise run dev:agent</code>)</>
          ) : (
            "No devices match these filters."
          )}
        </div>
      ) : (
        <DeviceTable devices={filtered} />
      )}
    </main>
  )
}
