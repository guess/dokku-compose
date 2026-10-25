// The top-level blocks (Dokku's `--global` settings) take exactly the keys Dokku 0.38.31
// accepts with `--global`. The key sets come from real `<ns>:report --format json` output
// in fixtures/dokku-0.38.31/reports (its `global-` keys), so a key added to or dropped
// from a table here (or by a Dokku upgrade) fails these tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '../core/schema.js'
import { GLOBAL_SPECS, GLOBAL_NAMES, globalYamlKeys, type GlobalName } from '../modules/global.js'

const reportKeys = (ns: string): string[] =>
  Object.keys(JSON.parse(readFileSync(new URL(`./fixtures/dokku-0.38.31/reports/${ns}-report.json`, import.meta.url), 'utf8')))
const globalKeys = (ns: string) => reportKeys(ns).filter(k => k.startsWith('global-')).map(k => k.slice(7))
const sorted = (keys: readonly string[]) => [...keys].sort()
const dokkuKeys = (name: GlobalName, report: string) =>
  GLOBAL_SPECS[name].keys.filter(k => k.report === report).map(k => k.key)

/** The error message of parsing `{ apps: {}, ...cfg }`, or '' when it parses. */
function message(cfg: object): string {
  try {
    parseConfig({ apps: {}, ...cfg })
    return ''
  } catch (e: any) {
    return String(e.message)
  }
}

describe('the tables equal the keys a real Dokku 0.38.31 reports with --global', () => {
  it.each([
    ['nginx', 'nginx'], ['logs', 'logs'], ['scheduler', 'scheduler'], ['ps', 'ps'], ['network', 'network'],
    ['git', 'git'], ['checks', 'checks'], ['build', 'builder'],
  ] as const)('%s', (name, report) => {
    expect(sorted(dokkuKeys(name, report))).toEqual(sorted(globalKeys(report)))
  })

  it('registry takes the global- keys except the report-only auth-servers', () => {
    expect(sorted(dokkuKeys('registry', 'registry'))).toEqual(sorted(globalKeys('registry').filter(k => k !== 'auth-servers')))
  })

  it('build also sets the builder-dockerfile and app-json paths', () => {
    // Their reports print global-dockerfile-path / global-appjson-path (plugins/builder-dockerfile/report.go, plugins/app-json/report.go).
    expect(dokkuKeys('build', 'builder-dockerfile')).toEqual(['dockerfile-path'])
    expect(dokkuKeys('build', 'app-json')).toEqual(['appjson-path'])
  })

  it('there is no table for proxy: dokku-compose runs the nginx proxy only', () => {
    expect(GLOBAL_NAMES).not.toContain('proxy')
    expect(message({ proxy: { type: 'nginx' } })).toMatch(/proxy/)
  })
})

describe('validate: the schema takes what the tables list', () => {
  const sample = (name: GlobalName): object => Object.fromEntries(GLOBAL_SPECS[name].keys.map(k => [k.yaml,
    k.kind === 'list' ? ['backend-net']
      : k.kind === 'flag' || k.yaml === 'skip_cleanup' || k.yaml === 'keep_git_dir' || k.yaml === 'skip-deploy' || k.yaml === 'push-on-release' ? true
        : 'x']))

  it.each(GLOBAL_NAMES.filter(n => n !== 'scheduler'))('%s accepts every key in its table', name => {
    expect(message({ [name]: sample(name) })).toBe('')
  })

  it.each(GLOBAL_NAMES.filter(n => n !== 'scheduler'))('%s refuses a key outside its table', name => {
    expect(message({ [name]: { bogus: 'x' } })).toMatch(/bogus/)
  })

  it('scheduler takes a string or selected/shell', () => {
    expect(message({ scheduler: 'docker-local' })).toBe('')
    expect(message({ scheduler: { selected: 'docker-local', shell: 'bash' } })).toBe('')
    expect(message({ scheduler: { bogus: 'x' } })).toMatch(/bogus/)
  })

  it('refuses a per-app-only key with the reason', () => {
    expect(message({ registry: { 'image-repo': 'x/y' } })).toMatch(/image-repo/)
    expect(message({ git: { rev_env_var: 'REV' } })).toMatch(/rev_env_var.*per-app/)
    expect(message({ git: { source_image: 'img' } })).toMatch(/source_image.*per-app/)
    expect(message({ ps: { restore: true } })).toMatch(/restore.*per-app/)
    expect(message({ ps: { 'start-cmd': 'x' } })).toMatch(/start-cmd.*per-app/)
    expect(message({ checks: { disabled: ['web'] } })).toMatch(/disabled.*per-app/)
    expect(message({ checks: false })).toMatch(/false disables the checks/)
    expect(message({ build: { args: { A: 'b' } } })).toMatch(/args.*no global form/)
    expect(message({ network: { static_web_listener: 'x' } })).toMatch(/static_web_listener.*per-app/)
  })

  it('takes the global-only git limits at the top level and refuses them per app', () => {
    expect(message({ git: { archive_max_files: 20000, archive_max_size: '2147483648' } })).toBe('')
    expect(message({ apps: { myapp: { git: { archive_max_files: 5 } } } })).toMatch(/top-level git:/)
  })

  it('network: points a list or a property in the wrong key to the right one', () => {
    expect(message({ networks: { tld: 'internal' } })).toMatch(/global network properties go under network:/)
    expect(message({ network: ['backend-net'] })).toMatch(/list of shared networks to create goes under networks:/)
    expect(message({ network: { networks: ['backend-net'] } })).toMatch(/sits beside network:/)
    expect(message({ apps: { myapp: { networks: { tld: 'internal' } } } })).toMatch(/properties such as tld go under network:/)
    expect(message({ apps: { myapp: { network: ['backend-net'] } } })).toMatch(/list of networks to attach goes under networks:/)
    expect(message({ apps: { myapp: { network: { attach_post_deploy: ['backend-net'] } } } })).toMatch(/under networks:/)
  })

  it('every yaml key of a table is accepted and nothing else is (compare with globalYamlKeys)', () => {
    expect(globalYamlKeys('git')).toEqual(['deploy_branch', 'keep_git_dir', 'archive_max_files', 'archive_max_size'])
    expect(globalYamlKeys('network')).toEqual(['attach_post_create', 'attach_post_deploy', 'initial_network', 'bind_all_interfaces', 'tld'])
  })
})
