import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadConfig } from './config.js'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('loadConfig', () => {
  it('loads and parses simple.yml', () => {
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    expect(Object.keys(config.apps)).toContain('myapp')
    expect(config.apps['myapp'].ports).toEqual(['http:5000:5000'])
  })

  it('throws on missing file', () => {
    expect(() => loadConfig('/nonexistent.yml')).toThrow(/not found/)
  })

  it('throws on invalid YAML', () => {
    expect(() => loadConfig(path.join(FIXTURES, 'invalid.yml'))).toThrow()
  })
})

describe('loadConfig env var interpolation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('substitutes ${VAR} with process.env value', () => {
    const yamlContent = `
apps:
  myapp:
    env:
      SECRET: "\${MY_SECRET}"
`
    const file = path.join(tmpDir, 'dokku-compose.yml')
    fs.writeFileSync(file, yamlContent)
    process.env.MY_SECRET = 'hunter2'
    const config = loadConfig(file)
    delete process.env.MY_SECRET
    expect((config.apps.myapp.env as Record<string, string>)['SECRET']).toBe('hunter2')
  })

  it('leaves ${VAR} as empty string when env var not set', () => {
    const yamlContent = `
apps:
  myapp:
    env:
      SECRET: "\${UNSET_VAR_XYZ}"
`
    const file = path.join(tmpDir, 'dokku-compose.yml')
    fs.writeFileSync(file, yamlContent)
    delete process.env.UNSET_VAR_XYZ
    const config = loadConfig(file)
    expect((config.apps.myapp.env as Record<string, string>)['SECRET']).toBe('')
  })
})
