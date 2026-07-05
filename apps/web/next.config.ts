import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  // @dfarm/shared ships TS source with extensionless relative imports; Next
  // transpiles it directly. Never alias it to a local copy — a stale duplicate
  // silently forked the wire schema once (see repo history).
  transpilePackages: ["@dfarm/shared"],
}

export default nextConfig
