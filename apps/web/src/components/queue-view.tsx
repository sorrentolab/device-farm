"use client"

import Link from "next/link"
import type { DeviceRequirements, Job } from "@dfarm/shared"
import { api, fmtAgo } from "@/lib/api"
import { jobSort, useFarm } from "@/lib/use-farm"

export const describeRequirements = (r: DeviceRequirements): string => {
  const parts = [
    r.platform,
    r.kind,
    r.osMin && `≥${r.osMin}`,
    r.osMax && `≤${r.osMax}`,
    r.namePattern && `name=${r.namePattern}`,
    r.deviceUdid && `device=${r.deviceUdid.slice(0, 12)}`,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "any device"
}

function JobRow({ job }: { job: Job }) {
  const cancel = async () => {
    if (!confirm(`Cancel job ${job.id.slice(0, 8)}?`)) return
    await api.cancelJob(job.id).catch((e) => alert(`Cancel failed: ${e}`))
  }
  return (
    <tr>
      <td className="mono">
        <Link href={`/jobs/${job.id}`}>{job.id.slice(0, 8)}</Link>
      </td>
      <td>{job.type === "run_flow" ? "flow" : "reservation"}</td>
      <td>
        <span className={`badge ${job.status}`}>{job.status}</span>
      </td>
      <td className="mono">{describeRequirements(job.requirements)}</td>
      <td>{job.createdBy}</td>
      <td>
        {job.attempt > 0 ? `${job.attempt}/${job.maxAttempts}` : `–/${job.maxAttempts}`}
      </td>
      <td>{fmtAgo(job.createdAt)}</td>
      <td>
        <button className="danger" onClick={cancel}>
          cancel
        </button>
      </td>
    </tr>
  )
}

export function QueueView() {
  const { jobs, error } = useFarm()
  const active = (jobs ?? [])
    .filter((j) => ["queued", "assigned", "running"].includes(j.status))
    .sort(jobSort)

  return (
    <main>
      <h1>
        Queue <span className="pill-count">{active.length}</span>
      </h1>
      <p className="subtitle">Queued and running work, oldest submissions first served.</p>
      {error && <div className="error-banner">Can’t reach the farm API: {error}</div>}
      {jobs === null ? (
        <div className="empty">Loading…</div>
      ) : active.length === 0 ? (
        <div className="empty">Queue is empty — the farm is all yours.</div>
      ) : (
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>type</th>
                <th>status</th>
                <th>needs</th>
                <th>submitted by</th>
                <th>attempt</th>
                <th>age</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
