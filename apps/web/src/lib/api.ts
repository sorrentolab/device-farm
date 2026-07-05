"use client"

import type { Device, Job, Run } from "@dfarm/shared"

export type JobDetail = { job: Job; runs: Run[] }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(body || `${res.status} ${res.statusText}`)
  }
  const ct = res.headers.get("content-type") ?? ""
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>
}

export const api = {
  devices: () => req<{ devices: Device[] }>("/api/devices").then((r) => r.devices),
  jobs: (status?: string) =>
    req<{ jobs: Job[] }>(`/api/jobs${status ? `?status=${status}` : ""}`).then((r) => r.jobs),
  job: (id: string) => req<JobDetail>(`/api/jobs/${id}`),
  cancelJob: (id: string) => req(`/api/jobs/${id}`, { method: "DELETE" }),
  boot: (deviceId: string) =>
    req<{ ok: boolean }>(`/api/devices/${deviceId}/boot`, { method: "POST" }),
  resetDevice: (deviceId: string, mode: "soft" | "hard" = "soft") =>
    req<{ ok: boolean }>(`/api/devices/${deviceId}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    }),
  setWatched: (deviceId: string, watched: boolean) =>
    req(`/api/devices/${deviceId}/watch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watched }),
    }),
  reserve: (deviceUdid: string, createdBy: string) =>
    req<{ id: string; token: string | null }>("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requirements: { deviceUdid },
        ttlSeconds: 900,
        createdBy,
      }),
    }),
  runArtifacts: (runId: string) =>
    req<{ files: string[] }>(`/api/runs/${runId}/artifacts`).then((r) => r.files),
  historyPage: (offset: number, limit = 50) =>
    req<{ jobs: Job[]; hasMore: boolean }>(`/api/jobs?terminal=1&limit=${limit}&offset=${offset}`),
  activeJobs: () => req<{ jobs: Job[] }>("/api/jobs?active=1").then((r) => r.jobs),
}

export const fmtTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString() : "—"

/** "1 Jun 2026 10:23pm" */
export const fmtExact = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  const d = new Date(iso)
  const month = d.toLocaleString("en", { month: "short" })
  let h = d.getHours()
  const ampm = h >= 12 ? "pm" : "am"
  h = h % 12 || 12
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${d.getDate()} ${month} ${d.getFullYear()} ${h}:${min}${ampm}`
}

export const fmtAgo = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  // beyond a week, relative time stops being meaningful — show the date
  const d = new Date(iso)
  const month = d.toLocaleString("en", { month: "short" })
  return d.getFullYear() === new Date().getFullYear()
    ? `${d.getDate()} ${month}`
    : `${d.getDate()} ${month} ${d.getFullYear()}`
}

export const fmtDuration = (startIso: string, endIso: string | null): string => {
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const s = Math.max(0, (end - new Date(startIso).getTime()) / 1000)
  if (s < 90) return `${s.toFixed(0)}s`
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`
}
