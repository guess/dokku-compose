import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { parseConfig, type Config } from './schema.js'

function interpolateEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '')
}

export function loadConfig(filePath: string): Config {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`)
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const raw = yaml.load(interpolateEnvVars(content))
  return parseConfig(raw)
}
