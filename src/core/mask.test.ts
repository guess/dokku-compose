import { describe, it, expect } from 'vitest'
import { maskSensitiveArgs, maskSensitiveArgsList, maskSecretsInText, maskSensitiveData } from './mask.js'

describe('maskSensitiveArgs', () => {
  it('masks TOKEN values showing last 4 chars', () => {
    expect(maskSensitiveArgs('config:set --global OP_SERVICE_ACCOUNT_TOKEN=ops_abc123'))
      .toBe('config:set --global OP_SERVICE_ACCOUNT_TOKEN=****c123')
  })

  it('masks AUTH values showing last 4 chars', () => {
    expect(maskSensitiveArgs('docker-options:add myapp build --build-arg SENTRY_AUTH_TOKEN=sntrys_xyz789'))
      .toBe('docker-options:add myapp build --build-arg SENTRY_AUTH_TOKEN=****z789')
  })

  it('masks SECRET values', () => {
    expect(maskSensitiveArgs('config:set myapp MY_SECRET=hunter2go'))
      .toBe('config:set myapp MY_SECRET=****r2go')
  })

  it('masks PASSWORD values', () => {
    expect(maskSensitiveArgs('config:set myapp DB_PASSWORD=s3cur3'))
      .toBe('config:set myapp DB_PASSWORD=****cur3')
  })

  it('masks KEY values', () => {
    expect(maskSensitiveArgs('config:set myapp API_KEY=abc12345'))
      .toBe('config:set myapp API_KEY=****2345')
  })

  it('masks CREDENTIAL values', () => {
    expect(maskSensitiveArgs('config:set myapp GCP_CREDENTIAL=long_json_string'))
      .toBe('config:set myapp GCP_CREDENTIAL=****ring')
  })

  it('fully masks short values (4 chars or less)', () => {
    expect(maskSensitiveArgs('config:set myapp API_KEY=ab'))
      .toBe('config:set myapp API_KEY=****')
    expect(maskSensitiveArgs('config:set myapp API_KEY=abcd'))
      .toBe('config:set myapp API_KEY=****')
  })

  it('does not mask non-sensitive values', () => {
    expect(maskSensitiveArgs('config:set myapp APP_ENV=staging NODE_ENV=production'))
      .toBe('config:set myapp APP_ENV=staging NODE_ENV=production')
  })

  it('masks multiple sensitive values in one command', () => {
    expect(maskSensitiveArgs('config:set myapp API_KEY=abc12345 SECRET_TOKEN=xyz98765 APP_ENV=prod'))
      .toBe('config:set myapp API_KEY=****2345 SECRET_TOKEN=****8765 APP_ENV=prod')
  })

  it('is case insensitive', () => {
    expect(maskSensitiveArgs('config:set myapp api_token=abc12345'))
      .toBe('config:set myapp api_token=****2345')
  })

  it('masks values containing equals signs (base64)', () => {
    expect(maskSensitiveArgs('config:set myapp AUTH_TOKEN=eyJhbGciOiJIUzI1NiJ9=='))
      .toBe('config:set myapp AUTH_TOKEN=****J9==')
    expect(maskSensitiveArgs('docker-options:add myapp build --build-arg SENTRY_AUTH_TOKEN=sntrys_eyJpYXQ6MTc3MDUxNjQ1OH0==_RraBT0jEz6e2/uqIAYW0'))
      .toBe('docker-options:add myapp build --build-arg SENTRY_AUTH_TOKEN=****AYW0')
  })

  it('leaves commands without env vars unchanged', () => {
    expect(maskSensitiveArgs('apps:create myapp'))
      .toBe('apps:create myapp')
  })

  it('masks positional password in registry:login --global', () => {
    expect(maskSensitiveArgs('registry:login --global ghcr.io octocat ghp_abcdefgh'))
      .toBe('registry:login --global ghcr.io octocat ****efgh')
  })

  it('masks short positional password in registry:login --global', () => {
    expect(maskSensitiveArgs('registry:login --global ghcr.io octocat pw'))
      .toBe('registry:login --global ghcr.io octocat ****')
  })

  it('masks positional password in registry:login without --global', () => {
    expect(maskSensitiveArgs('registry:login ghcr.io octocat ghp_abcdefgh'))
      .toBe('registry:login ghcr.io octocat ****efgh')
  })

  it('does not affect other registry: subcommands', () => {
    expect(maskSensitiveArgs('registry:set myapp server registry.example.com'))
      .toBe('registry:set myapp server registry.example.com')
  })

  it('masks positional credentials in postgres:backup-auth', () => {
    expect(maskSensitiveArgs('postgres:backup-auth mydb AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY us-east-1 v4 s3.amazonaws.com'))
      .toBe('postgres:backup-auth mydb ****MPLE ****EKEY us-east-1 v4 s3.amazonaws.com')
  })

  it('masks positional credentials in redis:backup-auth', () => {
    expect(maskSensitiveArgs('redis:backup-auth mycache AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY us-east-1 v4 s3.amazonaws.com'))
      .toBe('redis:backup-auth mycache ****MPLE ****EKEY us-east-1 v4 s3.amazonaws.com')
  })
})

describe('maskSensitiveArgsList', () => {
  it('masks positional credentials in a backup-auth argv, reporting the secrets', () => {
    const { masked, secrets } = maskSensitiveArgsList([
      'postgres:backup-auth', 'mydb',
      'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'us-east-1', 'v4', 's3.amazonaws.com',
    ])
    expect(masked).toEqual([
      'postgres:backup-auth', 'mydb',
      '****MPLE', '****EKEY',
      'us-east-1', 'v4', 's3.amazonaws.com',
    ])
    expect(secrets).toEqual(['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY'])
  })

  it('masks positional password in registry:login argv', () => {
    const { masked, secrets } = maskSensitiveArgsList(['registry:login', '--global', 'ghcr.io', 'octocat', 'ghp_abcdefgh'])
    expect(masked).toEqual(['registry:login', '--global', 'ghcr.io', 'octocat', '****efgh'])
    expect(secrets).toEqual(['ghp_abcdefgh'])
  })

  it('masks KEY=VALUE args regardless of position', () => {
    const { masked, secrets } = maskSensitiveArgsList(['config:set', 'myapp', 'API_KEY=abc12345', 'APP_ENV=prod'])
    expect(masked).toEqual(['config:set', 'myapp', 'API_KEY=****2345', 'APP_ENV=prod'])
    expect(secrets).toEqual(['abc12345'])
  })

  it('leaves non-sensitive argv untouched', () => {
    const { masked, secrets } = maskSensitiveArgsList(['apps:create', 'myapp'])
    expect(masked).toEqual(['apps:create', 'myapp'])
    expect(secrets).toEqual([])
  })
})

describe('maskSecretsInText', () => {
  it('scrubs a secret value that got echoed back in free text', () => {
    expect(maskSecretsInText('invalid access key AKIAIOSFODNN7EXAMPLE for region', ['AKIAIOSFODNN7EXAMPLE']))
      .toBe('invalid access key ****MPLE for region')
  })

  it('leaves text unchanged when no secret is present', () => {
    expect(maskSecretsInText('connection refused', ['AKIAIOSFODNN7EXAMPLE'])).toBe('connection refused')
  })

  it('ignores empty secret values', () => {
    expect(maskSecretsInText('some text', [''])).toBe('some text')
  })
})

describe('maskSensitiveData', () => {
  it('masks sensitive keys in flat objects', () => {
    expect(maskSensitiveData({
      API_KEY: 'abc12345',
      APP_ENV: 'staging',
      SECRET_TOKEN: 'xyz98765',
    })).toEqual({
      API_KEY: '****2345',
      APP_ENV: 'staging',
      SECRET_TOKEN: '****8765',
    })
  })

  it('masks sensitive keys in nested objects', () => {
    expect(maskSensitiveData({
      env: { DB_PASSWORD: 's3cur3pass', NODE_ENV: 'production' },
      build: { args: { SENTRY_AUTH_TOKEN: 'sntrys_abc123' } },
    })).toEqual({
      env: { DB_PASSWORD: '****pass', NODE_ENV: 'production' },
      build: { args: { SENTRY_AUTH_TOKEN: '****c123' } },
    })
  })

  it('handles arrays', () => {
    expect(maskSensitiveData(['http:80:3000', 'https:443:3000']))
      .toEqual(['http:80:3000', 'https:443:3000'])
  })

  it('handles null and primitives', () => {
    expect(maskSensitiveData(null)).toBe(null)
    expect(maskSensitiveData(42)).toBe(42)
    expect(maskSensitiveData('hello')).toBe('hello')
  })

  it('fully masks short sensitive values', () => {
    expect(maskSensitiveData({ API_KEY: 'ab' }))
      .toEqual({ API_KEY: '****' })
  })
})
