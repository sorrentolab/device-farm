"use client"

import Link from "next/link"
import { useState } from "react"
import type { Device } from "@dfarm/shared"
import { api, fmtAgo } from "@/lib/api"

const kindLabel: Record<Device["kind"], string> = {
  simulator: "sim",
  emulator: "emu",
  physical: "device",
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

  const os = `${device.platform === "ios" ? "iOS" : "Android"} ${device.osVersion}`
  const interactive = device.currentLeaseKind === "interactive"

  return (
    <div className="card">
      <div className="screen">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame} alt={`${device.name} screen`} />
        ) : device.watched && device.status !== "offline" ? (
          // watched but no frame pushed yet — show last cached frame if the server has one
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/devices/${device.id}/frame.jpg?t=${Date.now()}`} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <div className="placeholder">{device.platform === "ios" ? "" : "🤖"}</div>
        )}
        <span className="kind-tag">{kindLabel[device.kind]}</span>
      </div>
      <div className="body">
        <div className="title-row">
          <span className="name" title={device.udid}>
            {device.name}
          </span>
          <span className={`badge ${interactive ? "interactive" : device.status}`}>
            {interactive ? "reserved" : device.status}
          </span>
        </div>
        <div className="meta">
          {os} · {device.bootState}
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
        </div>
      </div>
    </div>
  )
}
