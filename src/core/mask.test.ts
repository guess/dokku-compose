import { describe, it, expect } from 'vitest'
import { maskSensitiveArgs } from './mask.js'

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
})
