"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Job } from "@dfarm/shared"
import { api } from "@/lib/api"
import { realtime } from "@/lib/realtime-client"

const PAGE_SIZE = 50
const TERMINAL = ["passed", "failed", "canceled"]

/**
 * Paginated finished-jobs feed for the history page. Loads pages of 50 as the
 * sentinel scrolls into view; jobs finishing right now arrive over realtime
 * and are merged at the top.
 */
export function useHistory() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)
  const offsetRef = useRef(0)

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const page = await api.historyPage(offsetRef.current, PAGE_SIZE)
      offsetRef.current += page.jobs.length
      setHasMore(page.hasMore)
      setJobs((prev) => {
        const known = new Set((prev ?? []).map((j) => j.id))
        return [...(prev ?? []), ...page.jobs.filter((j) => !known.has(j.id))]
      })
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    loadMore()
    return realtime.subscribe((msg) => {
      if (msg.type !== "job.updated" || !TERMINAL.includes(msg.job.status)) return
      setJobs((prev) => {
        if (!prev) return prev
        const rest = prev.filter((j) => j.id !== msg.job.id)
        // freshly finished — it belongs at the top of a newest-first feed
        return [msg.job, ...rest]
      })
    })
  }, [loadMore])

  /** Attach to the element that marks the end of the list. */
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadMore()
        },
        { rootMargin: "400px" },
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [loadMore],
  )

  return { jobs, hasMore, error, sentinelRef, loadMore }
}
