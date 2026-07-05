import type { Device, JobDetail, Reservation, Run } from "@dfarm/shared"

export const formatJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export const formatTable = (headers: readonly string[], rows: readonly string[][]): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  )

  const formatRow = (row: readonly string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
      .join("  ")
      .trimEnd()

  return `${[formatRow(headers), ...rows.map(formatRow)].join("\n")}\n`
}

export const formatHeldBy = (device: Device): string => {
  if (device.currentLeaseKind === "interactive") return "interactive"
  if (device.currentLeaseKind === "job" && device.currentJobId) return device.currentJobId
  return "-"
}

export const sortedRuns = (runs: readonly Run[]): Run[] =>
  [...runs].sort((left, right) => {
    const attempt = left.attempt - right.attempt
    if (attempt !== 0) return attempt
    return left.startedAt.localeCompare(right.startedAt)
  })

export const latestRun = (runs: readonly Run[]): Run | undefined => sortedRuns(runs).at(-1)

export const formatJobFinalLine = (detail: JobDetail): string => {
  const run = latestRun(detail.runs)
  const attempt = run?.attempt ?? detail.job.attempt
  const device = run ? ` on ${run.deviceName}` : ""
  const reason = detail.job.error ? ` — ${detail.job.error}` : ""

  return `job ${detail.job.id} ${detail.job.status} (attempt ${attempt}/${detail.job.maxAttempts}${device})${reason}`
}

export const formatJobStatus = (detail: JobDetail): string => {
  const lines = [
    `job ${detail.job.id} ${detail.job.status} (attempt ${detail.job.attempt}/${detail.job.maxAttempts})`,
    ...sortedRuns(detail.runs).map(
      (run) => `attempt ${run.attempt} on ${run.deviceName} \u2014 ${run.outcome ?? "running"}`,
    ),
  ]

  return `${lines.join("\n")}\n`
}

export const formatReservationSummary = (reservation: Reservation): string => {
  if (reservation.status === "active") {
    const device = reservation.device?.name ?? "unknown device"
    const expiry = reservation.expiresAt ?? "unknown expiry"
    return `reservation ${reservation.id} active on ${device} until ${expiry}`
  }

  if (reservation.status === "queued") {
    return `reservation ${reservation.id} queued (device pending)`
  }

  return `reservation ${reservation.id} ${reservation.status}`
}

export const isTerminalJobStatus = (status: JobDetail["job"]["status"]): boolean =>
  status === "passed" || status === "failed" || status === "canceled"
