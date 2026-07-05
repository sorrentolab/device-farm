/**
 * The farm mark: a grid of device tiles, one live.
 * Same geometry as src/app/icon.svg (the favicon) — keep them in sync.
 */
export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="11" height="11" fill="none" stroke="#58a6ff" strokeWidth="2.5" />
      <rect x="18" y="3" width="11" height="11" fill="none" stroke="#58a6ff" strokeWidth="2.5" />
      <rect x="3" y="18" width="11" height="11" fill="none" stroke="#58a6ff" strokeWidth="2.5" />
      <rect x="18" y="18" width="11" height="11" fill="#3fb950" />
    </svg>
  )
}
