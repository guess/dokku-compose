import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { parseConfig, type Config } from './schema.js'

export function loadConfig(filePath: string): Config {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`)
  }
  const raw = yaml.load(fs.readFileSync(filePath, 'utf8'))
  return parseConfig(raw)
}
