import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { parseConfig, type Config } from './schema.js'

// Substitutes ${VAR} in string values of the parsed tree (never keys). `$${`
// is an escape for a literal `${`. Missing/empty variables are collected
// across the whole tree and reported once.
function interpolateValue(value: unknown, missing: string[]): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\$\{|\$\{([^}]+)\}/g, (match, name?: string) => {
      if (name === undefined) return '${'
      const v = process.env[name]
      if (v === undefined || v === '') {
        missing.push(name)
        return ''
      }
      return v
    })
  }
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, missing))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolateValue(v, missing)
    return out
  }
  return value
}

function interpolateEnvVars(raw: unknown): unknown {
  const missing: string[] = []
  const result = interpolateValue(raw, missing)
  if (missing.length > 0) {
    const unique = Array.from(new Set(missing))
    throw new Error(
      `Unset environment variable(s) referenced in config: ${unique.join(', ')}`
    )
  }
  return result
}

export function loadConfig(filePath: string): Config {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`)
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const raw = interpolateEnvVars(yaml.load(content))
  return parseConfig(raw)
}
