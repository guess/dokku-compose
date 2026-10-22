import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { DockerOptions } from './docker-options.js'

describe('DockerOptions resource', () => {
  function makeCtx(queryResponses: Record<string, string>) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      const cmd = args.join(' ')
      return queryResponses[cmd] ?? ''
    })
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('reads docker options filtering out --link and --build-arg', async () => {
    const ctx = makeCtx({
      'docker-options:report myapp': `=====> myapp docker options information
       Docker options build:          --build-arg APP_NAME=myapp --link dokku.postgres.db:dokku-postgres-db --shm-size 256m
       Docker options deploy:         --link dokku.postgres.db:dokku-postgres-db --restart=on-failure:10
       Docker options run:            --link dokku.postgres.db:dokku-postgres-db`,
    })

    const config = await DockerOptions.read(ctx, 'myapp')

    expect(config).toEqual({
      build: ['--shm-size 256m'],
      deploy: ['--restart=on-failure:10'],
    })
  })

  it('returns empty config when only managed options exist', async () => {
    const ctx = makeCtx({
      'docker-options:report myapp': `=====> myapp docker options information
       Docker options build:          --build-arg NODE_ENV=production --link dokku.postgres.db:dokku-postgres-db
       Docker options deploy:         --link dokku.postgres.db:dokku-postgres-db
       Docker options run:`,
    })

    const config = await DockerOptions.read(ctx, 'myapp')

    expect(config).toEqual({})
  })

  it('returns empty config when nothing is set', async () => {
    const ctx = makeCtx({
      'docker-options:report myapp': `=====> myapp docker options information
       Docker options build:
       Docker options deploy:
       Docker options run:`,
    })

    const config = await DockerOptions.read(ctx, 'myapp')

    expect(config).toEqual({})
  })

  it('onChange adds new and removes old options without clearing', async () => {
    const ctx = makeCtx({})
    const before = { deploy: ['--restart=on-failure:10', '--shm-size 256m'] }
    const after = { deploy: ['--restart=on-failure:10', '--memory 512m'] }

    await DockerOptions.onChange!(ctx, 'myapp', { before, after, changed: true })

    const calls = (ctx.runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    expect(calls).toContain('docker-options:add myapp deploy --memory 512m')
    expect(calls).toContain('docker-options:remove myapp deploy --shm-size 256m')
    expect(calls).not.toContainEqual(expect.stringContaining('docker-options:clear'))
  })
})
