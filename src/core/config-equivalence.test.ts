import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { loadConfig } from './config.js'
import { parseConfig } from './schema.js'

const FIXTURE_DIR = path.join(import.meta.dirname, '../tests/fixtures')
const REAL_DIR = process.env.DOKKU_COMPOSE_EQUIVALENCE_DIR

// Copy of the algorithm before #7: substitute into raw YAML text, then parse.
function oldLoad(file: string) {
  const content = fs.readFileSync(file, 'utf8')
  const out = content.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '')
  return parseConfig(yaml.load(out))
}

function sameUnderBoth(file: string) {
  const names = new Set(
    [...fs.readFileSync(file, 'utf8').matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1])
  )
  for (const n of names) process.env[n] = `dummy-${n.toLowerCase().replace(/_/g, '-')}`
  try {
    expect(names.size).toBeGreaterThan(0)
    expect(loadConfig(file)).toEqual(oldLoad(file))
  } finally {
    for (const n of names) delete process.env[n]
  }
}

describe('old and new interpolation load the synthetic fixture identically', () => {
  it('interpolation.yml', () => sameUnderBoth(path.join(FIXTURE_DIR, 'interpolation.yml')))
})

// Set DOKKU_COMPOSE_EQUIVALENCE_DIR to a directory of real compose files to check them too.
describe.skipIf(!REAL_DIR)('real compose files load identically under old and new interpolation', () => {
  const files = REAL_DIR
    ? fs.readdirSync(REAL_DIR).filter((f) => /^dokku-compose\..*\.yml$/.test(f))
    : []
  for (const f of files) {
    it(f, () => sameUnderBoth(path.join(REAL_DIR!, f)))
  }
})
