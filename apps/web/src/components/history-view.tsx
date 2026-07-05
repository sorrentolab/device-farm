"use client"

import Link from "next/link"
import { useState } from "react"
import { fmtAgo, fmtExact } from "@/lib/api"
import { useHistory } from "@/lib/use-history"
import { describeRequirements } from "@/components/queue-view"

export function HistoryView() {
  const { jobs, hasMore, error, sentinelRef } = useHistory()
  const [statusFilter, setStatusFilter] = useState("")
  const [text, setText] = useState("")

  const shown = (jobs ?? [])
    .filter((j) => !statusFilter || j.status === statusFilter)
    .filter(
      (j) =>
        !text ||
        j.createdBy.toLowerCase().includes(text.toLowerCase()) ||
        j.id.startsWith(text) ||
        describeRequirements(j.requirements).includes(text),
    )

  return (
    <main>
      <h1>History</h1>
      <p className="subtitle">Finished jobs; open one for its logs, artifacts, and attempt timeline.</p>
      {error && <div className="error-banner">Can’t reach the farm API: {error}</div>}
      <div className="filter-bar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">any outcome</option>
          <option value="passed">passed</option>
          <option value="failed">failed</option>
          <option value="canceled">canceled</option>
        </select>
        <input
          type="text"
          placeholder="filter by submitter, job id, requirements…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minWidth: 280 }}
        />
      </div>
      {jobs === null ? (
        <div className="empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="empty">
          {jobs.length === 0 && !hasMore ? "Nothing here yet." : "No loaded jobs match these filters."}
        </div>
      ) : (
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>type</th>
                <th>outcome</th>
                <th>needs</th>
                <th>submitted by</th>
                <th>attempts</th>
                <th>finished</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id}>
                  <td className="mono">
                    <Link href={`/jobs/${j.id}`}>{j.id.slice(0, 8)}</Link>
                  </td>
                  <td>{j.type === "run_flow" ? "flow" : "reservation"}</td>
                  <td>
                    <span className={`badge ${j.status}`}>{j.status}</span>
                  </td>
                  <td className="mono">{describeRequirements(j.requirements)}</td>
                  <td>{j.createdBy}</td>
                  <td>
                    {Math.max(j.attempt, 1)}/{j.maxAttempts}
                  </td>
                  <td>
                    <span title={fmtExact(j.updatedAt)} className="cursor-default">
                      {fmtAgo(j.updatedAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {jobs !== null && (
        <div ref={sentinelRef} className="py-4 text-center text-xs text-muted-foreground">
          {hasMore ? "loading more…" : jobs.length > 0 ? "end of history" : ""}
        </div>
      )}
    </main>
  )
}
