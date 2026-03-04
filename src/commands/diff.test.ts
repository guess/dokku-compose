import { describe, it, expect } from 'vitest'
import { computeDiff, formatSummary, formatVerbose } from './diff.js'
import type { Config } from '../core/schema.js'

const desired: Config = {
  apps: {
    api: {
      ports: ['http:80:3000'],
      domains: ['api.example.com'],
    }
  }
}

const current: Config = {
  apps: {
    api: {
      ports: ['http:80:4000'],  // different
      // domains missing from server
    }
  }
}

describe('computeDiff', () => {
  it('detects port change', () => {
    const diff = computeDiff(desired, current)
    expect(diff.apps['api'].ports?.status).toBe('changed')
  })

  it('detects missing domain', () => {
    const diff = computeDiff(desired, current)
    expect(diff.apps['api'].domains?.status).toBe('missing')
  })

  it('reports in-sync when identical', () => {
    const diff = computeDiff(desired, desired)
    expect(diff.inSync).toBe(true)
  })
})

describe('formatSummary', () => {
  it('shows changed and missing items', () => {
    const diff = computeDiff(desired, current)
    const output = formatSummary(diff)
    expect(output).toContain('api')
    expect(output).toContain('ports')
    expect(output).toContain('domains')
  })
})

describe('formatVerbose', () => {
  it('shows +/- lines', () => {
    const diff = computeDiff(desired, current)
    const output = formatVerbose(diff)
    expect(output).toContain('+')
    expect(output).toContain('-')
  })
})
