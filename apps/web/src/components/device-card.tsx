"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { Device } from "@dfarm/shared"
import { api, fmtAgo } from "@/lib/api"

const kindLabel: Record<Device["kind"], string> = {
  simulator: "sim",
  emulator: "emu",
  physical: "device",
}

/**
 * Live screen area. Prefers frames pushed over realtime; while watched but
 * before any frame arrives, polls the server's frame cache. A watched device
 * that produces no frames (typically a shutdown simulator) says so instead of
 * showing a silent black box.
 */
function Screen({ device, frame }: { device: Device; frame: string | null }) {
  const [polledSrc, setPolledSrc] = useState<string | null>(null)
  const polling = device.watched && device.status !== "offline" && !frame

  useEffect(() => {
    if (!polling) return
    let alive = true
    const poll = async () => {
      const res = await fetch(`/api/devices/${device.id}/frame.jpg?t=${Date.now()}`).catch(() => null)
      if (!alive || !res?.ok) return
      const blob = await res.blob()
      if (alive) setPolledSrc((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(blob)
      })
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [polling, device.id])

  const src = frame ?? (polling ? polledSrc : null)

  return (
    <div className="screen">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${device.name} screen`} />
      ) : device.watched && device.bootState === "shutdown" ? (
        <div className="screen-hint">
          not booted —<br />hit boot to see its screen
        </div>
      ) : device.watched && device.status !== "offline" ? (
        <div className="screen-hint">waiting for frames…</div>
      ) : (
        <div className="placeholder">{device.platform === "ios" ? "" : "🤖"}</div>
      )}
      <span className="kind-tag">{kindLabel[device.kind]}</span>
    </div>
  )
}

export function DeviceCard({
  device,
  frame,
}: {
  device: Device
  /** latest live frame as a data URL, if we've received one */
  frame: string | null
}) {
  const [busy, setBusy] = useState(false)

  const toggleWatch = async () => {
    setBusy(true)
    try {
      await api.setWatched(device.id, !device.watched)
    } finally {
      setBusy(false)
    }
  }

  const reserve = async () => {
    setBusy(true)
    try {
      const r = await api.reserve(device.udid, "dashboard")
      alert(`Reserved.\n\nreservation ${r.id}\ntoken ${r.token ?? "(pending)"}\n\nUse dfarm shot/exec/release with these.`)
    } catch (e) {
      alert(`Reserve failed: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  const boot = async () => {
    setBusy(true)
    try {
      await api.boot(device.id)
      // discovery + realtime flip the card to booted/online within a report cycle
    } catch (e) {
      alert(`Boot failed: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  const os = `${device.platform === "ios" ? "iOS" : "Android"} ${device.osVersion}`
  const interactive = device.currentLeaseKind === "interactive"
  const shutdown = device.bootState === "shutdown" && device.status !== "offline"
  const badge = interactive
    ? { className: "interactive", label: "reserved" }
    : shutdown
      ? { className: "shutdown", label: "shutdown" }
      : { className: device.status, label: device.status }

  return (
    <div className="card">
      <Screen device={device} frame={frame} />
      <div className="body">
        <div className="title-row">
          <span className="name" title={device.udid}>
            {device.name}
          </span>
          <span className={`badge ${badge.className}`}>{badge.label}</span>
        </div>
        <div className="meta">
          {os}
          {device.status === "offline" && ` · seen ${fmtAgo(device.lastHeartbeatAt)}`}
        </div>
        {device.currentJobId && (
          <div className="meta">
            {interactive ? "held interactively" : "running"}{" "}
            <Link href={`/jobs/${device.currentJobId}`} className="mono">
              {device.currentJobId.slice(0, 8)}
            </Link>
          </div>
        )}
        <div className="actions">
          {shutdown ? (
            <button onClick={boot} disabled={busy} title="Boot this device through its agent">
              {busy ? "booting…" : "boot"}
            </button>
          ) : (
            <>
              <button
                className={device.watched ? "toggled" : ""}
                onClick={toggleWatch}
                disabled={busy || device.status === "offline"}
                title="Stream this device's screen at ~1fps"
              >
                {device.watched ? "◉ watching" : "watch"}
              </button>
              <button onClick={reserve} disabled={busy || device.status !== "online"}>
                reserve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
