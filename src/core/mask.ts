const SENSITIVE_RE = /(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)/i

function maskValue(value: string): string {
  if (value.length <= 4) return '****'
  return `****${value.slice(-4)}`
}

/** Mask KEY=VALUE pairs in a command string */
export function maskSensitiveArgs(cmd: string): string {
  return cmd.replace(/([^\s=]*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)[^\s=]*)=(\S+)/gi, (_, key, value) => {
    return `${key}=${maskValue(value)}`
  })
}

/** Deep-mask sensitive values in data structures (for diff/export output) */
export function maskSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data.map(maskSensitiveData)
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === 'string' && SENSITIVE_RE.test(key)) {
        result[key] = maskValue(value)
      } else if (typeof value === 'object' && value !== null) {
        result[key] = maskSensitiveData(value)
      } else {
        result[key] = value
      }
    }
    return result
  }
  return data
}
