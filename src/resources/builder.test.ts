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
      'builder:report qultr': `=====> qultr builder information
       Builder build dir:               apps/qultr-api
       Builder computed build dir:
       Builder computed selected:
       Builder detected:              dockerfile
       Builder global build dir:
       Builder global selected:
       Builder selected:`,
      'builder-dockerfile:report qultr': `=====> qultr builder-dockerfile information
       Builder dockerfile computed dockerfile path: docker/prod/api/Dockerfile
       Builder dockerfile global dockerfile path: Dockerfile
       Builder dockerfile dockerfile path: docker/prod/api/Dockerfile`,
      'app-json:report qultr': `=====> qultr app-json information
       App json computed selected:    docker/prod/api/app.json
       App json global selected:      app.json
       App json selected:             docker/prod/api/app.json`,
      'docker-options:report qultr': `=====> qultr docker options information
       Docker options build:          --build-arg APP_NAME=qultr --build-arg APP_PATH=apps/qultr-api --link dokku.postgres.qultr-db:dokku-postgres-qultr-db
       Docker options deploy:         --link dokku.postgres.qultr-db:dokku-postgres-qultr-db --restart=on-failure:10
       Docker options run:            --link dokku.postgres.qultr-db:dokku-postgres-qultr-db`,
    })

    const config = await Builder.read(ctx, 'qultr')

    expect(config).toEqual({
      context: 'apps/qultr-api',
      dockerfile: 'docker/prod/api/Dockerfile',
      app_json: 'docker/prod/api/app.json',
      args: { APP_NAME: 'qultr', APP_PATH: 'apps/qultr-api' },
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
      'docker-options:report myapp': `=====> myapp docker options information
       Docker options build:
       Docker options deploy:
       Docker options run:`,
    })

    const config = await Builder.read(ctx, 'myapp')

    expect(config).toEqual({})
  })

  it('filters out --link options from build args', async () => {
    const ctx = makeCtx({
      'builder:report myapp': '=====> myapp builder information',
      'builder-dockerfile:report myapp': '=====> myapp builder-dockerfile information',
      'app-json:report myapp': '=====> myapp app-json information',
      'docker-options:report myapp': `=====> myapp docker options information
       Docker options build:          --link dokku.postgres.db:dokku-postgres-db --build-arg NODE_ENV=production --link dokku.redis.cache:dokku-redis-cache
       Docker options deploy:
       Docker options run:`,
    })

    const config = await Builder.read(ctx, 'myapp')

    expect(config).toEqual({
      args: { NODE_ENV: 'production' },
    })
  })
})

describe('Builder --prune', () => {
  const OPTS = '--build-arg A=1 --build-arg MSG=hello big world --link x:y --build-arg B=2 --build-arg B=3'
  function setup() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...a: string[]) =>
      a[0] === 'docker-options:report' ? `       Docker options build: ${OPTS}\n       Docker options deploy: --shm-size 1g\n` : '')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('removes exactly the stale --build-arg options (every occurrence, spaces kept); other build options stay', async () => {
    const ctx = setup()
    await reconcile(Builder, ctx, 'myapp', { args: { A: '1' } }, undefined, true)
    expect(ctx.commands).toEqual([
      ['docker-options:remove', 'myapp', 'build', '--build-arg MSG=hello big world'],
      ['docker-options:remove', 'myapp', 'build', '--build-arg B=2'],
      ['docker-options:remove', 'myapp', 'build', '--build-arg B=3'],
    ])
  })

  it('without prune, or when every key is declared, nothing is removed', async () => {
    const a = setup()
    await reconcile(Builder, a, 'myapp', { args: { A: '1' } })
    expect(a.commands.some(c => c[0] === 'docker-options:remove')).toBe(false)
    const b = setup()
    await reconcile(Builder, b, 'myapp', { args: { A: '1', MSG: 'x', B: '2' } }, undefined, true)
    expect(b.commands.some(c => c[0] === 'docker-options:remove')).toBe(false)
  })
})
