// Regenerates the summary and command tables in docs/dokku-audit.md from a Dokku
// checkout and the statuses in commands.tsv and datastores.tsv.
//
// usage: bun scripts/dokku-audit/generate.ts <dokku> <dokku-postgres> <dokku-redis>
//
// Each argument is a git checkout of that repository at the release being audited.
// Fails, writing nothing, when Dokku has a command without a status or a status
// names a command Dokku no longer has.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dokkuDir, postgresDir, redisDir] = process.argv.slice(2)
if (!dokkuDir || !postgresDir || !redisDir) {
  console.error('usage: bun scripts/dokku-audit/generate.ts <dokku> <dokku-postgres> <dokku-redis>')
  process.exit(1)
}

const here = import.meta.dir
const docPath = join(here, '../../docs/dokku-audit.md')
const ICON: Record<string, string> = { Y: '✅', R: '✅', P: '🟡', N: '❌', X: '⛔' }
type Status = { s: string; note: string }

/** Rows of a TSV file, skipping comments and blank lines. */
function tsv(file: string): string[][] {
  return readFileSync(join(here, file), 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('\t'))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'help-functions' || name === 'commands' || name.endsWith('.go')) out.push(p)
  }
  return out
}

// Help lines look like "    <name> <args>, <Description>".
const HELP_LINE = /^\s+([a-z0-9-]+(?::[a-z0-9-]+)+)(?: [^,]*)?, ([A-Z[].*)$/
const helpDesc = new Map<string, string>()
const flaggedDesc = new Set<string>()
for (const file of walk(join(dokkuDir, 'plugins'))) {
  if (file.endsWith('_test.go')) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(HELP_LINE)
    if (!m) continue
    // The first line wins, except that a variant whose args start with a flag
    // (`ps:scale --clear`) gives way to the first line without one.
    const flagged = /^\s+\S+ --/.test(line)
    if (!helpDesc.has(m[1]) || (flaggedDesc.has(m[1]) && !flagged)) {
      helpDesc.set(m[1], m[2].replace(/`$/, '').replace(/\s*\*\*\*WARNING.*$/, ''))
      if (flagged) flaggedDesc.add(m[1])
      else flaggedDesc.delete(m[1])
    }
  }
}

// Commands without a help line, and the base commands.
const extraDesc: Record<string, string> = {
  'proxy:build-config': 'Rebuild the proxy config for an app',
  'git:status': 'Show the git status of the app repo',
  'git:unlock': 'Remove a stale deploy lock from the app repo',
  'plugin:installed': 'Check whether a plugin is installed',
  cleanup: 'Cleans up exited/dead Docker containers and removes dangling images',
  config: 'Pretty-print an app or global environment',
  deploy: 'Deploy an app',
  enter: 'Connect to a specific app container',
  events: 'Show the last events (-t follows)',
  help: 'Print the list of commands',
  logs: 'Display recent log output',
  report: 'Display a report for one or all apps',
  run: 'Run a command in a new container using the current app image',
  shell: 'Spawn dokku shell',
  url: 'Show the first URL for an application (compatibility)',
  urls: 'Show all URLs for an application',
  version: "Print dokku's version",
}
const desc = (name: string) => helpDesc.get(name) ?? extraDesc[name] ?? ''

const status = new Map<string, Status>(tsv('commands.tsv').map(([n, s, note]) => [n, { s, note }]))

// Alternative proxies and scheduler-k3s get their status by rule.
const RULED = /^(caddy|haproxy|openresty|traefik|scheduler-k3s):/
function ruled(name: string): Status {
  const sub = name.slice(name.indexOf(':') + 1)
  if (name.startsWith('scheduler-k3s:')) {
    if (/(^|:)(set|clear|add|remove)$/.test(sub) && !sub.startsWith('cluster:')) {
      return { s: 'N', note: 'A12 (not planned)' }
    }
    if (/report|list|preview|show-kubeconfig/.test(sub)) return { s: 'X', note: 'Read-only' }
    return { s: 'X', note: 'Cluster lifecycle action' }
  }
  if (sub === 'set' || sub === 'labels:add' || sub === 'labels:remove') return { s: 'N', note: 'A9' }
  if (sub === 'start' || sub === 'stop') return { s: 'X', note: 'Daemon control' }
  return { s: 'X', note: 'Read-only' }
}

const errors: string[] = []
for (const name of [...helpDesc.keys()].sort()) {
  if (!status.has(name) && !RULED.test(name)) errors.push(`no status in commands.tsv for Dokku command ${name}`)
}
/** A subcommand with no help line: a script in `subcommands/`, or a case in the plugin's Go dispatcher. */
function hasHiddenSubcommand(name: string): boolean {
  const [ns, sub] = [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)]
  const plugin = join(dokkuDir, 'plugins', ns)
  const dispatcher = join(plugin, 'src/subcommands/subcommands.go')
  return existsSync(join(plugin, 'subcommands', sub)) ||
    (existsSync(dispatcher) && readFileSync(dispatcher, 'utf8').includes(`case "${sub}":`))
}
for (const [name, { s }] of status) {
  if (!(s in ICON)) errors.push(`commands.tsv: ${name} has status '${s}', not one of ${Object.keys(ICON).join(' ')}`)
  if (name.includes(':') && !helpDesc.has(name) && !(name in extraDesc && hasHiddenSubcommand(name))) {
    errors.push(`commands.tsv lists ${name}, which this Dokku checkout does not have`)
  }
}

const short = (d: string) => {
  d = d.replace(/\s+/g, ' ').trim()
  return d.length > 70 ? d.slice(0, 67).trimEnd() + '…' : d
}
const HEAD = '| Command | What it does | Status | dokku-compose |\n|---|---|:-:|---|'
const row = (n: string, { s, note }: Status) => `| \`${n}\` | ${short(desc(n))} | ${ICON[s]} | ${note} |`

const placed = new Set<string>()
const counts = new Map<string, Record<string, number>>()
function count(ns: string, s: string) {
  const c = counts.get(ns) ?? { Y: 0, P: 0, N: 0, X: 0 }
  c[s === 'R' ? 'Y' : s]++
  counts.set(ns, c)
}
function table(names: string[], statusOf: (n: string) => Status = n => status.get(n)!): string {
  return [HEAD, ...names.map(n => {
    placed.add(n)
    const st = statusOf(n)
    count(n.includes(':') ? n.split(':')[0] : '(base)', st.s)
    return row(n, st)
  })].join('\n')
}
const inNamespaces = (...ns: string[]) =>
  [...status.keys()].filter(n => ns.some(p => n.startsWith(p + ':'))).sort()

const groups: [string, string[]][] = [
  ['Apps and deploys', inNamespaces('apps', 'app-json', 'git', 'builds', 'repo')],
  ['Builders', inNamespaces('builder', 'builder-dockerfile', 'builder-herokuish', 'builder-lambda',
    'builder-nixpacks', 'builder-pack', 'builder-railpack', 'buildpacks')],
  ['Configuration', inNamespaces('config', 'docker-options', 'resource')],
  ['Processes and scheduling', inNamespaces('ps', 'checks', 'cron', 'run', 'scheduler', 'scheduler-docker-local')],
  ['Networking', inNamespaces('domains', 'ports', 'proxy', 'network', 'certs')],
  ['Nginx', inNamespaces('nginx')],
  ['Storage', inNamespaces('storage')],
  ['Registry', inNamespaces('registry')],
  ['Logs', inNamespaces('logs')],
  ['Server', inNamespaces('plugin', 'ssh-keys', 'events', 'trace')],
  ['Base commands', [...status.keys()].filter(n => !n.includes(':')).sort()],
]
const sections = groups.map(([title, names]) => `### ${title}\n\n${table(names)}`)
const helpNames = [...helpDesc.keys()].sort()
sections.push(`### Alternative proxies (caddy, haproxy, openresty, traefik)\n\n${
  table(helpNames.filter(n => /^(caddy|haproxy|openresty|traefik):/.test(n)), ruled)}`)
sections.push(`### scheduler-k3s\n\n${table(helpNames.filter(n => n.startsWith('scheduler-k3s:')), ruled)}`)
for (const n of status.keys()) if (!placed.has(n)) errors.push(`commands.tsv lists ${n}, which no group places`)

// Datastores: subcommands from each README's "# usage" blocks.
function usageSubcommands(dir: string, plugin: string): Set<string> {
  const readme = readFileSync(join(dir, 'README.md'), 'utf8').split('\n')
  const subs = new Set<string>()
  readme.forEach((l, i) => {
    const m = l === '# usage' && readme[i + 1]?.match(new RegExp(`^dokku ${plugin}:([a-z-]+)`))
    if (m) subs.add(m[1])
  })
  return subs
}
const plugins = { postgres: usageSubcommands(postgresDir, 'postgres'), redis: usageSubcommands(redisDir, 'redis') }
const svcRows = ['| Subcommand | postgres | redis | dokku-compose |', '|---|:-:|:-:|---|']
const svcListed = new Set<string>()
for (const [sub, ...cols] of tsv('datastores.tsv')) {
  svcListed.add(sub)
  const byPlugin = { postgres: { s: cols[0], note: cols[1] }, redis: { s: cols[2], note: cols[3] } }
  for (const [plugin, { s }] of Object.entries(byPlugin)) {
    const has = plugins[plugin as keyof typeof plugins].has(sub)
    if (s === '-' ? has : !(s in ICON)) errors.push(`datastores.tsv: ${sub} has ${plugin} status '${s}'`)
    if (s !== '-' && !has) errors.push(`datastores.tsv lists ${sub}, which dokku-${plugin} does not have`)
    if (s !== '-') count(plugin, s)
  }
  const { postgres: p, redis: r } = byPlugin
  // A redis note starting "Same" reuses the postgres note.
  const note = p.s === '-' ? r.note
    : r.s === '-' || r.note === p.note || r.note.startsWith('Same') ? p.note
    : `postgres: ${p.note}; redis: ${r.note}`
  const mark = (s: string) => (s === '-' ? 'n/a' : ICON[s])
  svcRows.push(`| \`:${sub}\` | ${mark(p.s)} | ${mark(r.s)} | ${note} |`)
}
for (const [plugin, subs] of Object.entries(plugins)) {
  for (const sub of subs) if (!svcListed.has(sub)) errors.push(`no status in datastores.tsv for ${plugin}:${sub}`)
}
sections.push(`### Datastores (dokku-postgres, dokku-redis)\n\n${svcRows.join('\n')}`)

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

const total = { Y: 0, P: 0, N: 0, X: 0 }
const summaryRows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ns, c]) => {
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += c[k]
  const label = ns === '(base)' ? 'base commands' : `\`${ns}\``
  return `| ${label} | ${c.Y || ''} | ${c.P || ''} | ${c.N || ''} | ${c.X || ''} |`
})
const summary = ['| Namespace | ✅ | 🟡 | ❌ | ⛔ |', '|---|--:|--:|--:|--:|', ...summaryRows,
  `| **Total** | **${total.Y}** | **${total.P}** | **${total.N}** | **${total.X}** |`].join('\n')

function replaceBlock(doc: string, name: string, body: string): string {
  const start = `<!-- generated:${name} -->`
  const end = `<!-- /generated:${name} -->`
  const a = doc.indexOf(start)
  const b = doc.indexOf(end)
  if (a < 0 || b < a) throw new Error(`docs/dokku-audit.md is missing the ${start} … ${end} markers`)
  return doc.slice(0, a + start.length) + '\n' + body + '\n' + doc.slice(b)
}
let doc = readFileSync(docPath, 'utf8')
doc = replaceBlock(doc, 'summary', summary)
doc = replaceBlock(doc, 'commands', sections.join('\n\n'))
writeFileSync(docPath, doc)
console.log(`docs/dokku-audit.md: ${total.Y} supported, ${total.P} partial, ${total.N} missing, ${total.X} won't add`)
