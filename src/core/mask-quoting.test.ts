import { describe, it, expect } from 'vitest'
import { createRunner, DokkuCommandError } from './dokku.js'
import { maskSensitiveArgs, maskSensitiveArgsList, maskSensitiveData } from './mask.js'

// Secrets built to break naive masking: spaces, single and double quotes, `$`, a leading dash.
const HARD = [
  "zq7 Wx'k9 vB\"m$ -Rt",
  "pb tt'wxy zqk9",
  '-leading dash zq7',
  'a"b c$HOME zq7 d',
  "it's \"q\" $x -n zq7",
  "'qvox zq7' tzl",
]

/** Every run of `len` characters of `secret` that shows up in `out`. */
function leaks(out: string, secret: string, len = 3): string[] {
  const found: string[] = []
  for (let i = 0; i + len <= secret.length; i++) {
    const frag = secret.slice(i, i + len)
    if (out.includes(frag)) found.push(frag)
  }
  return found
}

async function dryRunLine(...args: string[]): Promise<string> {
  const runner = createRunner({ dryRun: true })
  await runner.run(...args)
  return runner.dryRunLog[0]
}

describe.each(HARD)('hard secret %j', secret => {
  it('never appears in the dry-run listing of set backup-encryption-passphrase', async () => {
    for (const plugin of ['postgres', 'redis']) {
      const line = await dryRunLine(`${plugin}:set`, 'api', 'backup-encryption-passphrase', secret)
      const out = maskSensitiveArgs(line)
      expect(leaks(out, secret)).toEqual([])
      expect(out).toBe(`${plugin}:set api backup-encryption-passphrase ****`)
    }
  })

  it('never appears in the dry-run listing of backup-set-encryption', async () => {
    const out = maskSensitiveArgs(await dryRunLine('postgres:backup-set-encryption', 'api', secret))
    expect(out).toBe('postgres:backup-set-encryption api ****')
  })

  it('never appears in an argv, in the error message, or in stderr that echoes it', () => {
    const args = ['postgres:set', 'api', 'backup-encryption-passphrase', secret]
    const { masked, secrets, opaque } = maskSensitiveArgsList(args)
    expect(masked.join(' ')).not.toContain(secret)
    expect(leaks(masked.join(' '), secret)).toEqual([])
    expect(secrets).toContain(secret)
    expect(opaque).toContain(secret)
    const err = new DokkuCommandError(args, 1, `bad value ${secret} given`)
    expect(leaks(err.message, secret)).toEqual([])
    expect(err.message).toContain('bad value **** given')
  })

  it('never appears in diff or export data', () => {
    const out = JSON.stringify(maskSensitiveData({ encryption: { passphrase: secret }, other: { BACKUP_PASSPHRASE: secret } }))
    expect(leaks(out, secret)).toEqual([])
  })

  it('a PASSPHRASE=value pair is masked completely, quoted or not', async () => {
    const out = maskSensitiveArgs(await dryRunLine('config:set', 'myapp', `BACKUP_PASSPHRASE=${secret}`, 'OTHER=visible'))
    expect(leaks(out, secret)).toEqual([])
    expect(out).toContain('BACKUP_PASSPHRASE=****')
    expect(out).toContain('OTHER=visible')
    const { masked } = maskSensitiveArgsList(['config:set', 'myapp', `BACKUP_PASSPHRASE=${secret}`])
    expect(leaks(masked.join(' '), secret)).toEqual([])
  })

  it('leaks at most the last 4 characters of a backup-auth secret, and keeps the arguments after it readable', async () => {
    const line = await dryRunLine('postgres:backup-auth', 'api', 'AKIAEXAMPLE', secret, 'us-east-1', 'v4', 's3.example.com')
    const out = maskSensitiveArgs(line)
    expect(leaks(out, secret.slice(0, -4))).toEqual([])
    expect(out).toMatch(/^postgres:backup-auth api \*\*\*\*MPLE \*\*\*\*.{4} us-east-1 v4 s3\.example\.com$/)
    const { masked, secrets } = maskSensitiveArgsList(['postgres:backup-auth', 'api', 'AKIAEXAMPLE', secret, 'us-east-1', 'v4', 's3.example.com'])
    expect(secrets).toContain(secret)
    expect(leaks(masked.join(' '), secret.slice(0, -4))).toEqual([])
  })

  it('leaks at most the last 4 characters of a SECRET=value pair', async () => {
    const out = maskSensitiveArgs(await dryRunLine('config:set', 'myapp', `SECRET_TOKEN=${secret}`, 'OTHER=visible'))
    expect(leaks(out, secret.slice(0, -4))).toEqual([])
    expect(out).toContain('OTHER=visible')
  })

  it('leaks at most the last 4 characters of a registry password', async () => {
    const out = maskSensitiveArgs(await dryRunLine('registry:login', 'registry.example.com', 'bot', secret))
    expect(leaks(out, secret.slice(0, -4))).toEqual([])
  })
})
