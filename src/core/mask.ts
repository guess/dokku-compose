const SENSITIVE_RE = /(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)/i

function maskValue(value: string): string {
  if (value.length <= 4) return '****'
  return `****${value.slice(-4)}`
}

/** Mask KEY=VALUE pairs in a command string */
export function maskSensitiveArgs(cmd: string): string {
  let masked = cmd.replace(/([^\s=]*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)[^\s=]*)=(\S+)/gi, (_, key, value) => {
    return `${key}=${maskValue(value)}`
  })

  // Special-case `registry:login [--global] <server> <username> <password>` —
  // password is a positional arg, not KEY=VALUE, so the regex above can't catch it.
  masked = masked.replace(
    /^(?!.*--password-stdin)(registry:login\s+(?:--global\s+)?\S+\s+\S+\s+)(\S+)/,
    (_, prefix, password) => `${prefix}${maskValue(password)}`
  )

  // Special-case `<plugin>:backup-auth <name> <access_key_id> <secret_access_key> ...` —
  // both credentials are positional args, not KEY=VALUE.
  masked = masked.replace(
    /^(\S+:backup-auth\s+\S+\s+)(\S+)(\s+)(\S+)/,
    (_, prefix, accessKeyId, sep, secretAccessKey) =>
      `${prefix}${maskValue(accessKeyId)}${sep}${maskValue(secretAccessKey)}`
  )

  return masked
}

/**
 * Mask a dokku argv (before it is joined into a command string) and report
 * the original secret values that were masked, so callers can also scrub
 * those values out of anything else derived from the same command (e.g.
 * stderr that echoes an argument back). Operating on the array — rather than
 * a joined string — is what makes this reliable when a value itself
 * contains whitespace.
 */
export function maskSensitiveArgsList(args: string[]): { masked: string[]; secrets: string[] } {
  const secrets: string[] = []
  const masked = [...args]

  const mark = (index: number) => {
    const value = masked[index]
    if (value === undefined || value === '') return
    secrets.push(value)
    masked[index] = maskValue(value)
  }

  // KEY=VALUE pairs, wherever they appear.
  for (let i = 0; i < masked.length; i++) {
    const m = masked[i].match(/^([^\s=]*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)[^\s=]*)=(.+)$/i)
    if (m) {
      secrets.push(m[2])
      masked[i] = `${m[1]}=${maskValue(m[2])}`
    }
  }

  // `registry:login [--global] <server> <username> <password>` — password is
  // the last positional arg.
  if (masked[0] === 'registry:login' && !masked.includes('--password-stdin')) {
    mark(masked.length - 1)
  }

  // `<plugin>:backup-auth <name> <access_key_id> <secret_access_key> ...` —
  // both credentials are positional args right after the service name.
  if (/^\S+:backup-auth$/.test(masked[0] ?? '')) {
    mark(2)
    mark(3)
  }

  return { masked, secrets }
}

/** Scrub any of the given secret values out of free-form text (e.g. stderr). */
export function maskSecretsInText(text: string, secrets: string[]): string {
  let masked = text
  for (const secret of secrets) {
    if (!secret) continue
    masked = masked.split(secret).join(maskValue(secret))
  }
  return masked
}

/** Deep-mask sensitive values in data structures (for diff/export output) */
export function maskSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data.map(maskSensitiveData)
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      // A log sink is a DSN that can carry credentials (logs `vector-sink`, `vector-cron-sink`).
      if (typeof value === 'string' && (SENSITIVE_RE.test(key) || /sink/i.test(key))) {
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

/** Mask the value of each `key=value` pair of a querystring whose key looks sensitive. */
export function maskQuerystring(qs: string): string {
  return qs.split('&').map(pair => {
    const i = pair.indexOf('=')
    if (i === -1 || !SENSITIVE_RE.test(pair.slice(0, i))) return pair
    return `${pair.slice(0, i)}=${maskValue(pair.slice(i + 1))}`
  }).join('&')
}
