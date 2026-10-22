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
      // A union failure hides why its object branch failed (an unknown key, say): show that branch's reasons.
      const branches = issue.code === 'invalid_union' ? (issue as any).errors as any[][] | undefined : undefined
      const reasons = branches?.filter(b => !b.every(i => i.code === 'invalid_type' && i.path.length === 0)).flat()
      if (reasons && reasons.length > 0) {
        for (const r of reasons) errors.push(`${[issuePath, ...r.path].filter(x => x !== '').join('.')}: ${r.message}`)
      } else {
        errors.push(`${issuePath}: ${issue.message}`)
      }
    }
    // Continue to cross-field checks using raw data
  }

  // 4. Cross-field: service references
  const data = raw as any
  if (data?.apps && typeof data.apps === 'object') {
    const serviceNames = new Set<string>()
    if (data?.postgres && typeof data.postgres === 'object') {
      for (const name of Object.keys(data.postgres)) serviceNames.add(name)
    }
    if (data?.redis && typeof data.redis === 'object') {
      for (const name of Object.keys(data.redis)) serviceNames.add(name)
    }
    for (const [appName, appCfg] of Object.entries<any>(data.apps)) {
      errors.push(...envExternalErrors(appName, appCfg))
      if (!appCfg?.links) continue
      for (const entry of appCfg.links) {
        const link = typeof entry === 'string' ? entry : entry?.service
        if (typeof link === 'string' && !serviceNames.has(link)) {
          errors.push(`apps.${appName}.links: service "${link}" not defined in postgres or redis`)
        }
      }
    }
  }

  // 5. Cross-field: plugin references (warnings only)
  const pluginNames = data?.plugins ? new Set(Object.keys(data.plugins)) : new Set<string>()
  if (data?.postgres && pluginNames.size > 0 && !pluginNames.has('postgres')) {
    warnings.push(`postgres: "postgres" plugin not declared in plugins (may be pre-installed)`)
  }
  if (data?.redis && pluginNames.size > 0 && !pluginNames.has('redis')) {
    warnings.push(`redis: "redis" plugin not declared in plugins (may be pre-installed)`)
  }

  return { errors, warnings }
}

/** `env_external:` names keys something else sets, so none may be one dokku-compose sets. */
function envExternalErrors(appName: string, appCfg: any): string[] {
  const list = appCfg?.env_external
  if (!Array.isArray(list)) return []
  const declared = appCfg.env && typeof appCfg.env === 'object' ? appCfg.env : {}
  const errors: string[] = []
  const seen = new Set<string>()
  for (const key of list) {
    if (typeof key !== 'string') continue
    const where = `apps.${appName}.env_external`
    if (key === 'DOKKU_COMPOSE_MANAGED_KEYS') errors.push(`${where}: "${key}" is dokku-compose's own marker`)
    else if (seen.has(key)) errors.push(`${where}: "${key}" is listed twice`)
    else if (key in declared) errors.push(`${where}: "${key}" is also in env:`)
    seen.add(key)
  }
  return errors
}
