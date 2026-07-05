"use client"

import { useEffect, useRef, useState } from "react"
import type { Device, Job, RealtimeMessage } from "@dfarm/shared"
import { api } from "@/lib/api"
import { realtime } from "@/lib/realtime-client"

/**
 * Devices + jobs kept current: fetched once, patched by realtime messages,
 * re-fetched on reconnect (and every 30s as a safety net — realtime is beta).
 */
export function useFarm() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [frames, setFrames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const framesRef = useRef(frames)
  framesRef.current = frames

  useEffect(() => {
    let alive = true
    // Jobs here are the ACTIVE set (queue page + device rows); history has its
    // own paginated fetch so this doesn't grow with every job ever run.
    const refresh = () =>
      Promise.all([api.devices(), api.activeJobs()])
        .then(([d, j]) => {
          if (!alive) return
          setDevices([...d])
          setJobs([...j])
          setError(null)
        })
        .catch((e) => alive && setError(String(e)))

    refresh()
    const interval = setInterval(refresh, 30000)

    const unsubMsg = realtime.subscribe((msg: RealtimeMessage) => {
      if (msg.type === "device.updated") {
        setDevices((ds) =>
          ds ? [...ds.filter((d) => d.id !== msg.device.id), msg.device] : ds,
        )
      } else if (msg.type === "job.updated") {
        setJobs((js) => (js ? [...js.filter((j) => j.id !== msg.job.id), msg.job] : js))
      } else if (msg.type === "frame") {
        setFrames((f) => ({
          ...f,
          [msg.deviceId]: `data:image/jpeg;base64,${msg.jpegBase64}`,
        }))
      }
    })
    const unsubStatus = realtime.onStatus((live) => {
      if (live) refresh()
    })

    return () => {
      alive = false
      clearInterval(interval)
      unsubMsg()
      unsubStatus()
    }
  }, [])

  return { devices, jobs, frames, error }
}

/** Usable devices first: online → busy → shutdown → offline, then by name. */
export const deviceSort = (a: Device, b: Device): number => {
  const rank = (d: Device) => {
    if (d.status === "offline") return 3
    if (d.bootState === "shutdown") return 2
    if (d.status === "busy") return 1
    return 0
  }
  return rank(a) - rank(b) || a.name.localeCompare(b.name) || a.udid.localeCompare(b.udid)
}

export const jobSort = (a: Job, b: Job): number =>
  b.createdAt.localeCompare(a.createdAt)
