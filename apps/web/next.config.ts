import type { NextConfig } from "next"
const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  transpilePackages: ["@dfarm/shared"],
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
    resolveAlias: {
      "@dfarm/shared": "./src/shared-proxy/index.ts",
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@dfarm/shared": "./src/shared-proxy/index.ts",
    }
    return config
  },
}

export default nextConfig
