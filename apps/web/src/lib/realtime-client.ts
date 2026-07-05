"use client"

import type { RealtimeMessage } from "@dfarm/shared"

type Listener = (msg: RealtimeMessage) => void

/**
 * Browser side of the realtime hub. Tries WebSocket (/api/ws) first and falls
 * back to SSE (/api/events); the server exposes whichever transport it chose,
 * so exactly one of these will connect. Reconnects with backoff either way.
 */
class RealtimeClient {
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(live: boolean) => void>()
  private started = false
  private live = false
  private retryMs = 1000

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    this.start()
    return () => this.listeners.delete(fn)
  }

  onStatus(fn: (live: boolean) => void): () => void {
    this.statusListeners.add(fn)
    fn(this.live)
    return () => this.statusListeners.delete(fn)
  }

  private setLive(live: boolean) {
    if (this.live === live) return
    this.live = live
    this.statusListeners.forEach((fn) => fn(live))
  }

  private emit(data: string) {
    try {
      const msg = JSON.parse(data) as RealtimeMessage
      this.listeners.forEach((fn) => fn(msg))
    } catch {
      // ignore malformed frames
    }
  }

  private start() {
    if (this.started || typeof window === "undefined") return
    this.started = true
    this.connectWs()
  }

  private scheduleRetry(next: () => void) {
    this.setLive(false)
    const delay = this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, 15000)
    setTimeout(next, delay)
  }

  private connectWs() {
    let opened = false
    let settled = false
    let ws: WebSocket
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(`${proto}//${location.host}/api/ws`)
    } catch {
      this.connectSse()
      return
    }
    // Dev servers can leave an upgrade to an unknown path hanging instead of
    // rejecting it — don't wait forever before falling back to SSE.
    const probe = setTimeout(() => {
      if (!opened && !settled) {
        settled = true
        ws.close()
        this.connectSse()
      }
    }, 3000)
    ws.onopen = () => {
      opened = true
      clearTimeout(probe)
      this.retryMs = 1000
      this.setLive(true)
    }
    ws.onmessage = (ev) => this.emit(String(ev.data))
    ws.onclose = () => {
      clearTimeout(probe)
      if (settled) return
      settled = true
      // Never opened → endpoint probably doesn't exist; try SSE instead.
      if (!opened) this.connectSse()
      else this.scheduleRetry(() => this.connectWs())
    }
    ws.onerror = () => ws.close()
  }

  private connectSse() {
    const es = new EventSource("/api/events")
    es.onopen = () => {
      this.retryMs = 1000
      this.setLive(true)
    }
    es.onmessage = (ev) => this.emit(ev.data)
    es.onerror = () => {
      es.close()
      this.scheduleRetry(() => this.connectSse())
    }
  }
}

export const realtime = new RealtimeClient()
