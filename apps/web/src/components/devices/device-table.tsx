"use client"

import Link from "next/link"
import { useState } from "react"
import type { Device } from "@dfarm/shared"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, fmtAgo } from "@/lib/api"

function statusBadge(device: Device) {
  const interactive = device.currentLeaseKind === "interactive"
  if (interactive) return { className: "interactive", label: "reserved" }
  if (device.bootState === "shutdown" && device.status !== "offline")
    return { className: "shutdown", label: "shutdown" }
  return { className: device.status, label: device.status }
}

function RowActions({ device }: { device: Device }) {
  const [busy, setBusy] = useState(false)
  const shutdown = device.bootState === "shutdown" && device.status !== "offline"

  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      alert(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (device.status === "offline") return null

  if (shutdown) {
    return (
      <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={act(() => api.boot(device.id))}>
        {busy ? "booting…" : "boot"}
      </Button>
    )
  }

  const jobHeld = device.currentLeaseKind === "job"

  return (
    <div className="flex justify-end gap-1.5">
      {!jobHeld && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          disabled={busy}
          onClick={act(() => api.resetDevice(device.id))}
          title="Kill all apps and return to the home screen (soft reset)"
        >
          reset
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className={`h-6 px-2 text-xs ${device.watched ? "border-primary text-primary" : ""}`}
        disabled={busy}
        onClick={act(() => api.setWatched(device.id, !device.watched))}
        title="Stream this device's screen at ~1fps"
      >
        {device.watched ? "watching" : "watch"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={busy || device.status !== "online"}
        onClick={act(async () => {
          const r = await api.reserve(device.udid, "dashboard")
          alert(`Reserved.\n\nreservation ${r.id}\ntoken ${r.token ?? "(pending)"}\n\nUse dfarm shot/exec/release with these.`)
        })}
      >
        reserve
      </Button>
    </div>
  )
}

export function DeviceTable({ devices }: { devices: Device[] }) {
  return (
    <div className="border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-[11px] uppercase tracking-wider">Device</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">Platform</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">Type</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">OS</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">Status</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider">Job</TableHead>
            <TableHead className="text-right text-[11px] uppercase tracking-wider">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.map((d) => {
            const badge = statusBadge(d)
            return (
              <TableRow key={d.id} className={d.status === "offline" ? "opacity-50" : ""}>
                <TableCell className="max-w-[280px]">
                  <span className="block truncate font-medium" title={d.udid}>
                    {d.name}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {d.platform === "ios" ? "iOS" : "Android"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {d.kind === "physical" ? "physical" : `virtual · ${d.kind}`}
                </TableCell>
                <TableCell className="mono text-muted-foreground">{d.osVersion}</TableCell>
                <TableCell>
                  <span className={`badge ${badge.className}`}>{badge.label}</span>
                  {d.status === "offline" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      seen {fmtAgo(d.lastHeartbeatAt)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {d.currentJobId ? (
                    <Link href={`/jobs/${d.currentJobId}`} className="mono">
                      {d.currentJobId.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <RowActions device={d} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
