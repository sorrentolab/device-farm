export const now = () => new Date()

export const addSeconds = (date: Date, seconds: number) =>
  new Date(date.getTime() + seconds * 1000)

export const compareDottedVersions = (left: string, right: string): number => {
  const a = left.split(/[^\d]+/).filter(Boolean).map(Number)
  const b = right.split(/[^\d]+/).filter(Boolean).map(Number)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export const nameMatches = (name: string, pattern: string | undefined): boolean => {
  if (!pattern) return true
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1), "i").test(name)
    } catch {
      return false
    }
  }
  return name.toLowerCase().includes(pattern.toLowerCase())
}

export const randomToken = () => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString("base64url")
}
