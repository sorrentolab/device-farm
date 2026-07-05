import type { RealtimeMessage } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export type CachedFrame = {
  bytes: Uint8Array
  contentType: string
  at: string
}

type Subscriber = (message: RealtimeMessage) => void

class RealtimeHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly latestFrames = new Map<string, CachedFrame>()

  // SSE is the chosen transport. Next 16.2.10's public route-handler types do
  // not expose a stable application WebSocket upgrade API, so /api/events
  // streams the same RealtimeMessage JSON payloads without coupling callers to
  // the transport.
  readonly transport = "sse" as const

  publish = (message: RealtimeMessage) => {
    for (const subscriber of this.subscribers) {
      subscriber(message)
    }
  }

  subscribe = (subscriber: Subscriber) => {
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  storeFrame = (deviceId: string, bytes: Uint8Array, contentType: string) => {
    const at = new Date().toISOString()
    this.latestFrames.set(deviceId, { bytes, contentType, at })
    this.publish({
      type: "frame",
      deviceId,
      jpegBase64: Buffer.from(bytes).toString("base64"),
      at,
    })
  }

  getFrame = (deviceId: string): CachedFrame | undefined => this.latestFrames.get(deviceId)

  clear = () => {
    this.latestFrames.clear()
    this.subscribers.clear()
  }
}

export const realtimeHub = new RealtimeHub()

export class Realtime extends Effect.Service<Realtime>()("Realtime", {
  succeed: realtimeHub,
}) {}
