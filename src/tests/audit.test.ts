// docs/dokku-audit.md is the project's tracker, so these tests keep it honest: every
// Dokku command the code runs is marked supported in scripts/dokku-audit/*.tsv, every
// command marked supported is still in the code, and the generated tables in the doc
// match the .tsv files (edit the .tsv and rerun the generator, never the tables).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const tsv = (p: string) => read(p).split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'))

const core = new Map(tsv('scripts/dokku-audit/commands.tsv').map(([n, s, note]) => [n, { s, note }]))
const stores = tsv('scripts/dokku-audit/datastores.tsv').map(([sub, ps, pn, rs, rn]) => ({ sub, ps, pn, rs, rn }))
const SUPPORTED = new Set(['Y', 'R', 'P'])
const ICON: Record<string, string> = { Y: '✅', R: '✅', P: '🟡', N: '❌', X: '⛔', '-': 'n/a' }

/** Source files the CLI ships: src/**\/*.ts without tests. */
function sources(dir = 'src'): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) return p === 'src/tests' ? [] : sources(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}
const code = sources().map(read).join('\n')

/** Status of a datastore subcommand for one plugin, or undefined when datastores.tsv has no row. */
function storeStatus(plugin: string, sub: string): string | undefined {
  const row = stores.find(r => r.sub === sub)
  return row && (plugin === 'postgres' ? row.ps : row.rs)
}

describe('dokku-audit status files', () => {
  it('mark every Dokku command the code runs as supported', () => {
    const wrong: string[] = []
    for (const m of code.matchAll(/\.(?:run|query|queryStrict|check)\(\s*['`]([^'`]+)['`]/g)) {
      const cmd = m[1]
      const templated = cmd.match(/^\$\{(?:\w+\.)?plugin\}:([a-z-]+)$/)
      if (templated) {
        // `${plugin}:link` and the like run against postgres and redis services.
        if (!['postgres', 'redis'].some(p => SUPPORTED.has(storeStatus(p, templated[1]) ?? ''))) wrong.push(cmd)
        continue
      }
      // Any other template (`${opts.namespace}:report`) is a namespace the second test covers.
      if (!/^[a-z0-9-]+(:[a-z0-9:-]+)?$/.test(cmd)) continue
      const [ns, ...rest] = cmd.split(':')
      const s = (ns === 'postgres' || ns === 'redis') ? storeStatus(ns, rest.join(':')) : core.get(cmd)?.s
      if (!SUPPORTED.has(s ?? '')) wrong.push(`${cmd} (${s ?? 'no row'})`)
    }
    expect([...new Set(wrong)]).toEqual([])
  })

  it('mark as supported only commands the code still names', () => {
    const quoted = new Set([...code.matchAll(/['`]([a-z0-9-]+:[a-z0-9:-]+)['`]/g)].map(m => m[1]))
    const stale = [...core].filter(([n, { s }]) => n.includes(':') && SUPPORTED.has(s) && !quoted.has(n)).map(([n]) => n)
    expect(stale).toEqual([])
  })
})

describe('docs/dokku-audit.md generated tables', () => {
  const doc = read('docs/dokku-audit.md')
  const block = doc.slice(doc.indexOf('<!-- generated:commands -->'), doc.indexOf('<!-- /generated:commands -->'))
  const cells = (line: string) => line.slice(1, -1).split(' | ').map(c => c.trim())

  it('match commands.tsv', () => {
    const rows = block.split('\n').filter(l => /^\| `[a-z0-9-]+(:[a-z0-9:-]+)?` \|/.test(l)).map(cells)
    const differ = rows.flatMap(([name, , icon, note]) => {
      const st = core.get(name.slice(1, -1))
      return st && (ICON[st.s] !== icon || st.note !== note) ? [`${name}: doc "${icon} ${note}", tsv "${ICON[st.s]} ${st.note}"`] : []
    })
    expect(differ).toEqual([])
  })

  it('match datastores.tsv', () => {
    const rows = new Map(block.split('\n').filter(l => l.startsWith('| `:')).map(cells).map(([sub, ...rest]) => [sub.slice(2, -1), rest]))
    const differ = stores.flatMap(({ sub, ps, pn, rs, rn }) => {
      // As the generator writes it: a redis note starting "Same" reuses the postgres note.
      const note = ps === '-' ? rn : rs === '-' || rn === pn || rn.startsWith('Same') ? pn : `postgres: ${pn}; redis: ${rn}`
      const want = [ICON[ps], ICON[rs], note]
      const got = rows.get(sub)
      return JSON.stringify(got) === JSON.stringify(want) ? [] : [`:${sub}: doc ${JSON.stringify(got)}, tsv ${JSON.stringify(want)}`]
    })
    expect(differ).toEqual([])
  })
})
