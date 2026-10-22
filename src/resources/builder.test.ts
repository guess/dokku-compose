import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Builder } from './builder.js'

describe('Builder resource', () => {
  function makeCtx(queryResponses: Record<string, string>) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      const cmd = args.join(' ')
      return queryResponses[cmd] ?? ''
    })
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('reads build config from real dokku reports', async () => {
    const ctx = makeCtx({
      'builder:report myapp': `=====> myapp builder information
       Builder build dir:               apps/myapp-api
       Builder computed build dir:
       Builder computed selected:
       Builder detected:              dockerfile
       Builder global build dir:
       Builder global selected:
       Builder selected:`,
      'builder-dockerfile:report myapp': `=====> myapp builder-dockerfile information
       Builder dockerfile computed dockerfile path: docker/prod/api/Dockerfile
       Builder dockerfile global dockerfile path: Dockerfile
       Builder dockerfile dockerfile path: docker/prod/api/Dockerfile`,
      'app-json:report myapp': `=====> myapp app-json information
       App json computed selected:    docker/prod/api/app.json
       App json global selected:      app.json
       App json selected:             docker/prod/api/app.json`,
      'docker-options:report myapp --format json': JSON.stringify({ 'build-list': ['--build-arg APP_NAME=myapp', '--build-arg APP_PATH=apps/myapp-api', '--link dokku.postgres.myapp-db:dokku-postgres-myapp-db'] }),
    })

    const config = await Builder.read(ctx, 'myapp')

    expect(config).toEqual({
      context: 'apps/myapp-api',
      dockerfile: 'docker/prod/api/Dockerfile',
      app_json: 'docker/prod/api/app.json',
      args: { APP_NAME: 'myapp', APP_PATH: 'apps/myapp-api' },
    })
  })

  it('returns empty config when nothing is set', async () => {
    const ctx = makeCtx({
      'builder:report myapp': `=====> myapp builder information
       Builder build dir:
       Builder computed build dir:
       Builder computed selected:        herokuish
       Builder selected:`,
      'builder-dockerfile:report myapp': `=====> myapp builder-dockerfile information
       Builder dockerfile dockerfile path:
       Builder dockerfile computed dockerfile path: Dockerfile`,
      'app-json:report myapp': `=====> myapp app-json information
       App json selected:
       App json computed selected:
       App json global selected:      app.json`,
      'docker-options:report myapp --format json': JSON.stringify({ 'build-list': [] }),
    })

    const config = await Builder.read(ctx, 'myapp')

    expect(config).toEqual({})
  })

  it('filters out --link options from build args', async () => {
    const ctx = makeCtx({
      'builder:report myapp': '=====> myapp builder information',
      'builder-dockerfile:report myapp': '=====> myapp builder-dockerfile information',
      'app-json:report myapp': '=====> myapp app-json information',
      'docker-options:report myapp --format json': JSON.stringify({ 'build-list': ['--link dokku.postgres.db:dokku-postgres-db', '--build-arg NODE_ENV=production', '--link dokku.redis.cache:dokku-redis-cache'] }),
    })

    const config = await Builder.read(ctx, 'myapp')

    expect(config).toEqual({
      args: { NODE_ENV: 'production' },
    })
  })
})

// Entries are the forms Dokku 0.38 stores (docker-options:add shell-splits its
// arguments, starts a new option at each `-` token and single-quotes words with
// shell characters), e.g. `--label key="hello world"` is stored as `--label 'key=hello world'`.
const BUILD_LIST = ['--build-arg A=1', "--build-arg 'MSG=hello big world'", '--link x:y', '--build-arg B=2', '--build-arg B=3']

describe('Builder --prune', () => {
  function setup(list: string[] = BUILD_LIST) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...a: string[]) =>
      a.join(' ') === 'docker-options:report myapp --format json' ? JSON.stringify({ 'build-list': list, 'deploy-list': ['--shm-size 1g'] }) : '')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('removes exactly the stale --build-arg options (every occurrence, stored text kept); other build options stay', async () => {
    const ctx = setup()
    await reconcile(Builder, ctx, 'myapp', { args: { A: '1' } }, undefined, true)
    expect(ctx.commands).toEqual([
      ['docker-options:remove', 'myapp', 'build', "--build-arg 'MSG=hello big world'"],
      ['docker-options:remove', 'myapp', 'build', '--build-arg B=2'],
      ['docker-options:remove', 'myapp', 'build', '--build-arg B=3'],
    ])
  })

  it('without prune, or when every key is declared, nothing is removed', async () => {
    const a = setup()
    await reconcile(Builder, a, 'myapp', { args: { A: '1' } })
    expect(a.commands.some(c => c[0] === 'docker-options:remove')).toBe(false)
    const b = setup()
    await reconcile(Builder, b, 'myapp', { args: { A: '1', MSG: 'hello big world', B: '2' } }, undefined, true)
    expect(b.commands.some(c => c[0] === 'docker-options:remove')).toBe(false)
  })

  // What Dokku stores for: ' --x' in a value, a short flag after a build arg, a double space,
  // '?', '$' and a single quote in values.
  const UNUSUAL = [
    "--build-arg 'FLAGS=-a --x --y'",
    '--build-arg KEEP=1',
    '-t img',
    "--build-arg 'SPACED=a  b'",
    "--build-arg 'URL=https://x?a=1&b=$HOME'",
    "--build-arg 'Q=it'\\''s'",
  ]
  const DECLARED = { FLAGS: '-a --x --y', KEEP: '1', SPACED: 'a  b', URL: 'https://x?a=1&b=$HOME', Q: "it's" }

  it('unusual values are read as written and a declared quoted arg is neither re-added nor pruned', async () => {
    const current = await Builder.read(setup(UNUSUAL), 'myapp')
    expect(current.args).toEqual(DECLARED)

    const same = setup(UNUSUAL)
    await reconcile(Builder, same, 'myapp', { args: DECLARED }, undefined, true)
    expect(same.commands).toEqual([])
  })

  it('prune removes a stale quoted arg by its stored text and keeps declared quoted ones', async () => {
    const prune = setup(UNUSUAL)
    const { SPACED: _s, URL: _u, ...rest } = DECLARED
    await reconcile(Builder, prune, 'myapp', { args: rest }, undefined, true)
    expect(prune.commands).toEqual([
      ['docker-options:remove', 'myapp', 'build', "--build-arg 'SPACED=a  b'"],
      ['docker-options:remove', 'myapp', 'build', "--build-arg 'URL=https://x?a=1&b=$HOME'"],
    ])
  })

  it('adds a changed arg as one shell word so Dokku stores it intact', async () => {
    const ctx = setup([])
    await reconcile(Builder, ctx, 'myapp', { args: { FLAGS: '-a --x', URL: 'https://x?a=1', Q: "it's", PLAIN: 'v-1' } })
    expect(ctx.commands).toEqual([
      ['docker-options:add', 'myapp', 'build', "--build-arg 'FLAGS=-a --x'"],
      ['docker-options:add', 'myapp', 'build', "--build-arg 'URL=https://x?a=1'"],
      ['docker-options:add', 'myapp', 'build', "--build-arg 'Q=it'\\''s'"],
      ['docker-options:add', 'myapp', 'build', '--build-arg PLAIN=v-1'],
    ])
  })

  it('a report without build-list fails instead of reading as empty', async () => {
    const ctx = setup()
    ;(ctx.runner.query as any).mockResolvedValue('Docker options build: --build-arg A=1')
    await expect(Builder.read(ctx, 'myapp')).rejects.toThrow('build-list')
  })
})
