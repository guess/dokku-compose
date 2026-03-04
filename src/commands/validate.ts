import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { ConfigSchema } from '../core/schema.js'

export interface ValidationResult {
  errors: string[]
  warnings: string[]
}

export function validate(filePath: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. File exists
  if (!fs.existsSync(filePath)) {
    return { errors: [`File not found: ${filePath}`], warnings }
  }

  // 2. Valid YAML
  let raw: unknown
  try {
    raw = yaml.load(fs.readFileSync(filePath, 'utf8'))
  } catch (e: any) {
    return { errors: [`YAML parse error: ${e.message}`], warnings }
  }

  // 3. Schema validation (catches type errors, invalid ports, etc.)
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const issuePath = issue.path.join('.')
      errors.push(`${issuePath}: ${issue.message}`)
    }
    // Continue to cross-field checks using raw data
  }

  // 4. Cross-field: service references
  const data = raw as any
  if (data?.apps && typeof data.apps === 'object') {
    const serviceNames = new Set(
      data?.services && typeof data.services === 'object'
        ? Object.keys(data.services)
        : []
    )
    for (const [appName, appCfg] of Object.entries<any>(data.apps)) {
      if (!appCfg?.links) continue
      for (const link of appCfg.links) {
        if (!serviceNames.has(link)) {
          errors.push(`apps.${appName}.links: service "${link}" not defined in services`)
        }
      }
    }
  }

  // 5. Cross-field: plugin references (warnings only)
  if (data?.services && data?.plugins) {
    const pluginNames = new Set(Object.keys(data.plugins))
    for (const [svcName, svcCfg] of Object.entries<any>(data.services)) {
      if (svcCfg?.plugin && !pluginNames.has(svcCfg.plugin)) {
        warnings.push(`services.${svcName}.plugin: "${svcCfg.plugin}" not declared in plugins (may be pre-installed)`)
      }
    }
  }

  return { errors, warnings }
}
