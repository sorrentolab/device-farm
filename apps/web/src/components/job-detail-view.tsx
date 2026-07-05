"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { Run } from "@dfarm/shared"
import { api, fmtDateTime, fmtDuration, type JobDetail } from "@/lib/api"
import { realtime } from "@/lib/realtime-client"
import { describeRequirements } from "@/components/queue-view"

const TERMINAL = ["passed", "failed", "canceled"]

function AttemptRow({ run, isLast }: { run: Run; isLast: boolean }) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)
  const state = run.outcome ?? "running"

  const toggleArtifacts = () => {
    setOpen((was) => !was)
    if (files === null) api.runArtifacts(run.id).then(setFiles, () => setFiles([]))
  }

  return (
    <div className={`attempt ${state}`}>
      <span className="attempt-dot" aria-hidden />
      <div className="attempt-body">
        <div className="attempt-head">
          <span>
            attempt {run.attempt} on <strong>{run.deviceName}</strong>
          </span>
          <span className={`badge ${state}`}>{state}</span>
          {(run.outcome === "device_lost" || run.outcome === "infra_failure") && !isLast && (
            <span className="attempt-note">→ retried</span>
          )}
          {run.errorMessage && <span className="attempt-note">{run.errorMessage}</span>}
          {run.artifactsDir && (
            <button className="attempt-toggle" onClick={toggleArtifacts}>
              {open ? "hide artifacts" : "artifacts"}
            </button>
          )}
          <span className="when">
            {fmtDuration(run.startedAt, run.finishedAt)}
            {run.exitCode !== null && ` · exit ${run.exitCode}`}
          </span>
        </div>
        {open && (
          <div className="artifacts-panel">
            <div className="artifacts-head">
              <span>
                {files === null
                  ? "loading…"
                  : `${files.length} file${files.length === 1 ? "" : "s"}`}
              </span>
              {files !== null && files.length > 0 && (
                <a className="artifacts-download" href={`/api/runs/${run.id}/artifacts.zip`}>
                  ⤓ download all (.zip)
                </a>
              )}
            </div>
            {files !== null && files.length > 0 && (
              <ul className="artifacts-files">
                {files.map((f) => (
                  <li key={f}>
                    <a className="mono" href={`/api/runs/${run.id}/artifacts/${f}`} target="_blank">
                      {f}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function LogViewer({ jobId, finished }: { jobId: string; finished: boolean }) {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/logs`)
    es.onmessage = (ev) => setLines((ls) => [...ls, ev.data])
    es.addEventListener("done", () => {
      setDone(true)
      es.close()
    })
    es.onerror = () => {
      if (finished) {
        setDone(true)
        es.close()
      }
      // otherwise EventSource auto-reconnects and the server replays
    }
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    const box = boxRef.current
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight
  }, [lines])

  return (
    <div
      className="log-viewer"
      ref={boxRef}
      onScroll={(e) => {
        const el = e.currentTarget
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {lines.length === 0 ? (
        <div className="waiting">{done ? "No log output." : "Waiting for output…"}</div>
      ) : (
        lines.join("\n")
      )}
      {!done && lines.length > 0 && <div className="waiting">▌</div>}
    </div>
  )
}

export function JobDetailView({ jobId }: { jobId: string }) {
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () =>
      api.job(jobId).then(
        (d) => alive && (setDetail(d), setError(null)),
        (e) => alive && setError(String(e)),
      )
    refresh()
    const unsub = realtime.subscribe((msg) => {
      if (
        (msg.type === "job.updated" && msg.job.id === jobId) ||
        (msg.type === "run.updated" && msg.run.jobId === jobId)
      )
        refresh()
    })
    const interval = setInterval(refresh, 15000)
    return () => {
      alive = false
      unsub()
      clearInterval(interval)
    }
  }, [jobId])

  if (error)
    return (
      <main>
        <div className="error-banner">Couldn’t load job: {error}</div>
      </main>
    )
  if (!detail) return <main><div className="empty">Loading…</div></main>

  const { job, runs } = detail
  const sorted = [...runs].sort((a, b) => a.attempt - b.attempt)
  const finished = TERMINAL.includes(job.status)

  return (
    <main>
      <p className="subtitle" style={{ marginBottom: 0 }}>
        <Link href={job.type === "run_flow" && finished ? "/history" : "/queue"}>
          ← back
        </Link>
      </p>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono">{job.id.slice(0, 8)}</span>
        <span className={`badge ${job.status}`}>{job.status}</span>
      </h1>
      <p className="subtitle">
        {job.type === "run_flow" ? "maestro flow" : "interactive reservation"} ·{" "}
        {describeRequirements(job.requirements)} · submitted by <strong>{job.createdBy}</strong> ·{" "}
        {fmtDateTime(job.createdAt)}
        {!finished && (
          <>
            {" "}
            ·{" "}
            <button className="danger" onClick={() => api.cancelJob(job.id)}>
              cancel
            </button>
          </>
        )}
      </p>

      {job.error && <div className="error-banner">{job.error}</div>}

      <h2>Attempts</h2>
      {sorted.length === 0 ? (
        <div className="empty">Waiting for a device…</div>
      ) : (
        <div className="timeline">
          {sorted.map((r, i) => (
            <AttemptRow key={r.id} run={r} isLast={i === sorted.length - 1} />
          ))}
        </div>
      )}

      {job.type === "run_flow" && (
        <>
          <h2>Log</h2>
          <LogViewer jobId={job.id} finished={finished} />
        </>
      )}
    </main>
  )
}
