import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureDockerAuth, pruneDockerAuth, readDockerAuthDrift } from './docker-auth.js'

function fake(statusByServer: Record<string, number>, globalServers = '') {
  const runner = createRunner({ dryRun: true })
  const statusCalls: { args: string[]; input?: string }[] = []
  runner.status = vi.fn(async (args: string[], input?: string) => {
    statusCalls.push({ args, input })
    return statusByServer[args[3]] ?? 1
  })
  runner.query = vi.fn(async (...args: string[]) => {
    if (args.join(' ') === 'registry:report --global --registry-global-auth-servers') return globalServers
    throw new Error(`unexpected query ${args.join(' ')}`)
  })
  return { ctx: createContext(runner), runner, statusCalls }
}

const AUTH = {
  'ghcr.io': { username: 'octocat', password: 'ghp_secret' },
  'registry.example.com': { username: 'svc', password: 'pw' },
}

describe('ensureDockerAuth', () => {
  it('asks registry:auth-status with the password on stdin', async () => {
    const { ctx, statusCalls } = fake({ 'ghcr.io': 0, 'registry.example.com': 0 })
    await ensureDockerAuth(ctx, AUTH)
    expect(statusCalls).toEqual([
      { args: ['registry:auth-status', '--global', '--password-stdin', 'ghcr.io', 'octocat'], input: 'ghp_secret' },
      { args: ['registry:auth-status', '--global', '--password-stdin', 'registry.example.com', 'svc'], input: 'pw' },
    ])
  })

  it('skips a login that matches (exit 0)', async () => {
    const { ctx, runner } = fake({ 'ghcr.io': 0, 'registry.example.com': 0 })
    await ensureDockerAuth(ctx, AUTH)
    expect(runner.dryRunLog).toEqual([])
  })

  for (const code of [1, 2, 4]) {
    it(`logs in on exit ${code}, password on stdin only`, async () => {
      const { ctx, runner } = fake({ 'ghcr.io': code, 'registry.example.com': 0 })
      const login = vi.spyOn(runner, 'runWithInput')
      await ensureDockerAuth(ctx, AUTH)
      expect(runner.dryRunLog).toEqual(['registry:login --global --password-stdin ghcr.io octocat'])
      expect(login).toHaveBeenCalledWith('ghp_secret', 'registry:login', '--global', '--password-stdin', 'ghcr.io', 'octocat')
    })
  }

  it('throws on exit 3 (bad arguments) without the password', async () => {
    const { ctx } = fake({ 'ghcr.io': 3 })
    const err = await ensureDockerAuth(ctx, AUTH).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('ghcr.io')
    expect(err.message).not.toContain('ghp_secret')
  })

  it('throws on any other exit code', async () => {
    const { ctx } = fake({ 'ghcr.io': 20 })
    await expect(ensureDockerAuth(ctx, AUTH)).rejects.toThrow(/exit 20/)
  })

  it('does nothing for an empty config', async () => {
    const { ctx, runner, statusCalls } = fake({})
    await ensureDockerAuth(ctx, {})
    expect(statusCalls).toEqual([])
    expect(runner.dryRunLog).toEqual([])
  })
})

describe('pruneDockerAuth', () => {
  it('logs out of a global server the file does not list', async () => {
    const { ctx, runner } = fake({}, 'docker.io,ghcr.io,old.example.com,registry.example.com')
    await pruneDockerAuth(ctx, { ...AUTH, 'https://index.docker.io/v1/': { username: 'u', password: 'p' } })
    expect(runner.dryRunLog).toEqual(['registry:logout --global old.example.com'])
  })

  it('matches Docker Hub aliases to the docker.io the report prints', async () => {
    const { ctx, runner } = fake({}, 'docker.io')
    await pruneDockerAuth(ctx, { 'hub.docker.com': { username: 'u', password: 'p' } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('does nothing when no server is logged in', async () => {
    const { ctx, runner } = fake({}, '')
    await pruneDockerAuth(ctx, AUTH)
    expect(runner.dryRunLog).toEqual([])
  })
})

describe('readDockerAuthDrift', () => {
  it('lists the servers whose login is missing or differs, never a password', async () => {
    const { ctx } = fake({ 'ghcr.io': 2, 'registry.example.com': 0 }, 'ghcr.io,registry.example.com,old.example.com')
    expect(await readDockerAuthDrift(ctx, AUTH)).toEqual({ stale: ['ghcr.io'], extra: ['old.example.com'] })
  })
})
