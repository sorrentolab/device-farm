export class AgentLogger {
  private readonly onceKeys = new Set<string>()

  info(message: string, data?: unknown): void {
    this.write("info", message, data)
  }

  warn(message: string, data?: unknown): void {
    this.write("warn", message, data)
  }

  warnOnce(key: string, message: string, data?: unknown): void {
    if (this.onceKeys.has(key)) return
    this.onceKeys.add(key)
    this.warn(message, data)
  }

  error(message: string, data?: unknown): void {
    this.write("error", message, data)
  }

  private write(level: "info" | "warn" | "error", message: string, data?: unknown): void {
    const line = `[${new Date().toISOString()}] [agent] [${level}] ${message}`
    if (data === undefined) {
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](line)
      return
    }
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](line, data)
  }
}
