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

  it('throws when ${VAR} references an unset env var', () => {
    const yamlContent = `
apps:
  myapp:
    env:
      SECRET: "\${UNSET_VAR_XYZ}"
`
    const file = path.join(tmpDir, 'dokku-compose.yml')
    fs.writeFileSync(file, yamlContent)
    delete process.env.UNSET_VAR_XYZ
    expect(() => loadConfig(file)).toThrow(/UNSET_VAR_XYZ/)
  })

  it('throws listing all missing vars at once', () => {
    const yamlContent = `
apps:
  myapp:
    env:
      A: "\${UNSET_A_XYZ}"
      B: "\${UNSET_B_XYZ}"
`
    const file = path.join(tmpDir, 'dokku-compose.yml')
    fs.writeFileSync(file, yamlContent)
    delete process.env.UNSET_A_XYZ
    delete process.env.UNSET_B_XYZ
    expect(() => loadConfig(file)).toThrow(/UNSET_A_XYZ.*UNSET_B_XYZ|UNSET_B_XYZ.*UNSET_A_XYZ/)
  })
})

describe('loadConfig parse-then-substitute (LAB-739)', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-test-'))
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
    for (const k of ['LAB739_SECRET', 'LAB739_EMPTY', 'LAB739_A', 'LAB739_B', 'LAB739_KEY']) delete process.env[k]
  })

  const load = (yamlContent: string) => {
    const file = path.join(tmpDir, 'dokku-compose.yml')
    fs.writeFileSync(file, yamlContent)
    return loadConfig(file)
  }
  const envOf = (c: ReturnType<typeof loadConfig>) => c.apps.myapp.env as Record<string, string>

  it('keeps a secret with quote, apostrophe, #, backslash, colon and newline unchanged', () => {
    const secret = 'a"b\'c # d\\e: f\ng'
    process.env.LAB739_SECRET = secret
    const c = load('apps:\n  myapp:\n    env:\n      S: "${LAB739_SECRET}"\n      T: ${LAB739_SECRET}\n')
    expect(envOf(c).S).toBe(secret)
    expect(envOf(c).T).toBe(secret)
  })

  it('lists every missing variable once, across the whole tree', () => {
    delete process.env.LAB739_A
    delete process.env.LAB739_B
    expect(() =>
      load('apps:\n  myapp:\n    env:\n      A: "${LAB739_A}"\n      B: "${LAB739_B}"\n      C: "${LAB739_A}"\n')
    ).toThrow('Unset environment variable(s) referenced in config: LAB739_A, LAB739_B')
  })

  it('treats an empty variable as unset', () => {
    process.env.LAB739_EMPTY = ''
    expect(() => load('apps:\n  myapp:\n    env:\n      A: "${LAB739_EMPTY}"\n')).toThrow(
      'Unset environment variable(s) referenced in config: LAB739_EMPTY'
    )
  })

  it('turns $${ into a literal ${ without looking the variable up', () => {
    delete process.env.LAB739_A
    const c = load('apps:\n  myapp:\n    env:\n      A: "x$${LAB739_A}y"\n')
    expect(envOf(c).A).toBe('x${LAB739_A}y')
  })

  it('does not substitute keys or comments', () => {
    process.env.LAB739_KEY = 'real'
    const c = load('apps:\n  myapp:\n    env:\n      "${LAB739_KEY}": v # ${LAB739_UNSET_IN_COMMENT}\n')
    expect(envOf(c)['${LAB739_KEY}']).toBe('v')
  })
})
