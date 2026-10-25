// A datastore service's `password` and `custom-env` values must not survive, in whole or in
// 3-character pieces, in any output path: the dry-run listing, an argv, an error message,
// the stderr that echoes an argument, and diff or export data.
import { describe, it, expect } from 'vitest'
import { createRunner, DokkuCommandError } from './dokku.js'
import { maskSensitiveArgs, maskSensitiveArgsList, maskSensitiveData } from './mask.js'

// Values built to break naive masking: spaces, quotes, `$`, a leading dash (no `;`, which separates entries).
const HARD = [
  "zq7 Wx'k9 vB\"m$ -Rt",
  "pb tt'wxy zqk9",
  '-leading dash zq7',
  'a"b c$HOME zq7 d',
  "it's \"q\" $x -n zq7",
  "'qvox zq7' tzl",
]
// A password only holds [A-Za-z0-9._~-], and may start with a dash.
const PASSWORDS = ['-Hq7.zkv~9Xw', 'plain-Zq7Wxk9', 'tJ9_mQ3.vBn2']

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

describe.each(PASSWORDS)('password %j', secret => {
  it.each(['postgres', 'redis'])('never appears in the dry-run listing of %s:set, with or without --no-restart', async plugin => {
    for (const flags of [[], ['--no-restart']]) {
      const line = await dryRunLine(`${plugin}:set`, ...flags, 'db', 'password', '--', secret)
      const out = maskSensitiveArgs(line)
      expect(leaks(out, secret)).toEqual([])
      expect(out).toBe(`${plugin}:set ${flags.join(' ')}${flags.length ? ' ' : ''}db password -- ****`)
    }
  })

  it('never appears in the dry-run listing of :create --password', async () => {
    const out = maskSensitiveArgs(await dryRunLine('postgres:create', 'db', '--image', 'postgres', '--password', secret, '--memory', '512'))
    expect(leaks(out, secret)).toEqual([])
    expect(out).toBe('postgres:create db --image postgres --password **** --memory 512')
  })

  it('never appears in an argv, in the error message, or in stderr that echoes it', () => {
    for (const args of [
      ['postgres:set', '--no-restart', 'db', 'password', '--', secret],
      ['redis:create', 'cache', '--password', secret],
    ]) {
      const { masked, secrets, opaque } = maskSensitiveArgsList(args)
      expect(leaks(masked.join(' '), secret)).toEqual([])
      expect(secrets).toContain(secret)
      expect(opaque).toContain(secret)
      const err = new DokkuCommandError(args, 1, `bad value ${secret} given`)
      expect(leaks(err.message, secret)).toEqual([])
      expect(err.message).toContain('bad value **** given')
    }
  })

  it('never appears in diff or export data', () => {
    const out = JSON.stringify(maskSensitiveData({ postgres: { db: { properties: { password: secret, memory: 512 } } } }))
    expect(leaks(out, secret)).toEqual([])
    expect(out).toContain('"memory":512')
  })
})

describe.each(HARD)('custom-env value %j', secret => {
  const value = `API_KEY=${secret};TZ=UTC;PGOPTIONS=${secret}`

  it('never appears in the dry-run listing of :set, and the names stay readable', async () => {
    for (const plugin of ['postgres', 'redis']) {
      const out = maskSensitiveArgs(await dryRunLine(`${plugin}:set`, 'svc1', 'custom-env', '--', value))
      expect(leaks(out, secret)).toEqual([])
      expect(out).toBe(`${plugin}:set svc1 custom-env -- API_KEY=****;TZ=****;PGOPTIONS=****`)
    }
  })

  it('never appears in the dry-run listing of :create --custom-env', async () => {
    const out = maskSensitiveArgs(await dryRunLine('postgres:create', 'svc1', '--custom-env', value, '--memory', '512'))
    expect(leaks(out, secret)).toEqual([])
    expect(out).toBe('postgres:create svc1 --custom-env API_KEY=****;TZ=****;PGOPTIONS=**** --memory 512')
  })

  it('never appears in an argv, in the error message, or in stderr that echoes it', () => {
    for (const args of [['postgres:set', 'svc1', 'custom-env', '--', value], ['redis:create', 'cache', '--custom-env', value]]) {
      const { masked, secrets, opaque } = maskSensitiveArgsList(args)
      expect(leaks(masked.join(' '), secret)).toEqual([])
      expect(masked.join(' ')).toContain('API_KEY=****;TZ=****;PGOPTIONS=****')
      expect(secrets).toContain(secret)
      expect(opaque).toContain(secret)
      const err = new DokkuCommandError(args, 1, `bad value ${secret} given`)
      expect(leaks(err.message, secret)).toEqual([])
    }
  })

  it('never appears in diff or export data, where the names are kept', () => {
    const out = JSON.stringify(maskSensitiveData({ postgres: { db: { properties: { 'custom-env': { API_KEY: secret, TZ: 'UTC' } } } } }))
    expect(leaks(out, secret)).toEqual([])
    expect(out).toContain('"API_KEY":"****"')
    expect(out).toContain('"TZ":"****"')
  })

  it('leaves the REPLACE_ME placeholder export writes readable', () => {
    const out = maskSensitiveData({ 'custom-env': { TZ: 'REPLACE_ME' } }) as Record<string, Record<string, string>>
    expect(out['custom-env'].TZ).toBe('REPLACE_ME')
  })
})
