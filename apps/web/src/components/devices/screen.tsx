"use client"

import { useEffect, useState } from "react"
import type { Device } from "@dfarm/shared"

export const kindLabel: Record<Device["kind"], string> = {
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
export function Screen({ device, frame }: { device: Device; frame: string | null }) {
  const [polledSrc, setPolledSrc] = useState<string | null>(null)
  const polling = device.watched && device.status !== "offline" && !frame

  useEffect(() => {
    if (!polling) return
    let alive = true
    const poll = async () => {
      const res = await fetch(`/api/devices/${device.id}/frame.jpg?t=${Date.now()}`).catch(() => null)
      if (!alive || !res?.ok) return
      const blob = await res.blob()
      if (alive)
        setPolledSrc((old) => {
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
          not booted —<br />boot the {kindLabel[device.kind]} to see its screen
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
