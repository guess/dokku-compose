import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { parseConfig, type Config } from './schema.js'

function interpolateEnvVars(content: string): string {
  const missing: string[] = []
  const result = content.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const value = process.env[name]
    if (value === undefined || value === '') {
      missing.push(name)
      return ''
    }
    return value
  })
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
  const raw = yaml.load(interpolateEnvVars(content))
  return parseConfig(raw)
}
