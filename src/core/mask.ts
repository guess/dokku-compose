const SENSITIVE_RE = /(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|KEY|AUTH|CREDENTIAL)/i

/** Names that contain KEY but hold no secret: a GPG public key id and the keyserver it is fetched from. */
const NOT_SECRET_KEYS = new Set(['public_key_id', 'keyserver'])

/** What `export` writes in place of a secret it cannot read back. */
const PLACEHOLDER = 'REPLACE_ME'

/** A passphrase is shown as nothing at all: unlike a token, its last characters are worth hiding. */
const OPAQUE_RE = /PASSPHRASE/i

function maskValue(value: string, opaque = false): string {
  if (opaque || value.length <= 4) return '****'
  return `****${value.slice(-4)}`
}

// One shell word as the dry-run listing writes it: single-quoted runs (which may hold spaces),
// backslash escapes (`'\''` is a quote inside a quoted word) and bare characters. A stray quote
// that closes nowhere is consumed with the rest of the line, so a malformed value over-masks
// instead of leaking.
const WORD = String.raw`(?:'[^']*'|\\.|[^\s\\])+`

/** Mask KEY=VALUE pairs in a command string */
export function maskSensitiveArgs(cmd: string): string {
  // A whole argument shell-quoted because its value holds spaces or quotes: 'KEY=a b'.
  let masked = cmd.replace(new RegExp(String.raw`'([^\s='\\]*(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|KEY|AUTH|CREDENTIAL)[^\s='\\]*)=((?:[^']|'\\'')*)'`, 'gi'), (_, key, value) => {
    return `${key}=${maskValue(value.replace(/'\\''/g, "'"), OPAQUE_RE.test(key))}`
  })
  masked = masked.replace(new RegExp(String.raw`([^\s=]*(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|KEY|AUTH|CREDENTIAL)[^\s=]*)=(${WORD})`, 'gi'), (_, key, value) => {
    return `${key}=${maskValue(value, OPAQUE_RE.test(key))}`
  })

  // `<plugin>:set <name> backup-encryption-passphrase <passphrase>` and
  // `<plugin>:backup-set-encryption <name> <passphrase>`: the passphrase is the last argument,
  // so the whole rest of the line goes, whatever quotes, spaces or dashes it holds.
  masked = masked.replace(
    /^(\S+:set\s+\S+\s+backup-encryption-passphrase\s+).+$/s,
    (_, prefix) => `${prefix}****`
  )
  masked = masked.replace(
    /^(\S+:backup-set-encryption\s+\S+\s+).+$/s,
    (_, prefix) => `${prefix}****`
  )

  // Special-case `registry:login [--global] <server> <username> <password>` —
  // password is a positional arg, not KEY=VALUE, so the regex above can't catch it.
  masked = masked.replace(
    new RegExp(String.raw`^(?!.*--password-stdin)(registry:login\s+(?:--global\s+)?\S+\s+\S+\s+)(${WORD})`),
    (_, prefix, password) => `${prefix}${maskValue(password)}`
  )

  // Special-case `<plugin>:backup-auth <name> <access_key_id> <secret_access_key> ...` —
  // both credentials are positional args, not KEY=VALUE.
  masked = masked.replace(
    new RegExp(String.raw`^(\S+:backup-auth\s+\S+\s+)(${WORD})(\s+)(${WORD})`),
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
export function maskSensitiveArgsList(args: string[]): { masked: string[]; secrets: string[]; opaque: string[] } {
  const secrets: string[] = []
  // Secrets that are masked completely, wherever they are scrubbed from.
  const opaque: string[] = []
  const masked = [...args]

  const mark = (index: number, completely = false) => {
    const value = masked[index]
    if (value === undefined || value === '') return
    secrets.push(value)
    if (completely) opaque.push(value)
    masked[index] = maskValue(value, completely)
  }

  // KEY=VALUE pairs, wherever they appear.
  for (let i = 0; i < masked.length; i++) {
    const m = masked[i].match(/^([^\s=]*(?:TOKEN|SECRET|PASSWORD|PASSPHRASE|KEY|AUTH|CREDENTIAL)[^\s=]*)=(.+)$/i)
    if (m) {
      secrets.push(m[2])
      const completely = OPAQUE_RE.test(m[1])
      if (completely) opaque.push(m[2])
      masked[i] = `${m[1]}=${maskValue(m[2], completely)}`
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

  // `<plugin>:set <name> backup-encryption-passphrase <passphrase>` and
  // `<plugin>:backup-set-encryption <name> <passphrase>`.
  if (/^\S+:set$/.test(masked[0] ?? '') && masked[2] === 'backup-encryption-passphrase') mark(3, true)
  if (/^\S+:backup-set-encryption$/.test(masked[0] ?? '')) mark(2, true)

  return { masked, secrets, opaque }
}

/** Scrub any of the given secret values out of free-form text (e.g. stderr). */
export function maskSecretsInText(text: string, secrets: string[], opaque: string[] = []): string {
  let masked = text
  for (const secret of secrets) {
    if (!secret) continue
    masked = masked.split(secret).join(maskValue(secret, opaque.includes(secret)))
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
      if (NOT_SECRET_KEYS.has(key.toLowerCase()) || value === PLACEHOLDER) {
        result[key] = value
      } else if (typeof value === 'string' && (SENSITIVE_RE.test(key) || /sink/i.test(key))) {
        result[key] = maskValue(value, OPAQUE_RE.test(key))
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
