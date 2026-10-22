// src/resources/parsers.test.ts
import { describe, it, expect } from 'vitest'
import { parseReport, parseBulkReport } from './parsers.js'

describe('parseReport', () => {
  it('parses nginx report format', () => {
    const raw = `=====> myapp nginx information
       Nginx access log format:
       Nginx access log path:           /var/log/nginx/myapp-access.log
       Nginx bind address IPv4:
       Nginx bind address IPv6:         ::
       Nginx client max body size:      1m
       Nginx disable custom config:     false
       Nginx error log path:            /var/log/nginx/myapp-error.log
       Nginx global hsts:               true
       Nginx hsts:                       true
       Nginx hsts include subdomains:   true
       Nginx hsts max age:              15724800
       Nginx hsts preload:              false
       Nginx last visited at:           1709561234
       Nginx proxy buffer size:         4096
       Nginx proxy buffering:           on
       Nginx proxy buffers:             8 4096
       Nginx proxy read timeout:        60s`
    const result = parseReport(raw, 'nginx')
    expect(result['client-max-body-size']).toBe('1m')
    expect(result['proxy-read-timeout']).toBe('60s')
    expect(result['hsts']).toBe('true')
    // Should skip computed/meta keys
    expect(result['last-visited-at']).toBeUndefined()
    // Should skip empty values
    expect(result['access-log-format']).toBeUndefined()
    expect(result['bind-address-ipv4']).toBeUndefined()
  })

  it('parses scheduler report format', () => {
    const raw = `=====> myapp scheduler information
       Scheduler computed selected:     docker-local
       Scheduler global selected:       docker-local
       Scheduler selected:              docker-local`
    const result = parseReport(raw, 'scheduler')
    expect(result['selected']).toBe('docker-local')
    // Should skip computed/global keys
    expect(result['computed-selected']).toBeUndefined()
    expect(result['global-selected']).toBeUndefined()
  })

  it('parses logs report format', () => {
    const raw = `=====> myapp logs information
       Logs computed max size:          10m
       Logs global max size:
       Logs max size:                   10m
       Logs computed vector sink:
       Logs global vector sink:
       Logs vector sink:`
    const result = parseReport(raw, 'logs')
    expect(result['max-size']).toBe('10m')
    expect(result['computed-max-size']).toBeUndefined()
  })

  it('handles header line gracefully', () => {
    const raw = `=====> myapp nginx information
       Nginx client max body size:      50m`
    const result = parseReport(raw, 'nginx')
    expect(result['client-max-body-size']).toBe('50m')
    expect(Object.keys(result)).not.toContain('=====> myapp nginx information')
  })

  it('returns empty object for empty input', () => {
    expect(parseReport('', 'nginx')).toEqual({})
  })
})

describe('parseBulkReport', () => {
  it('splits multi-app output into per-app maps', () => {
    const raw = `=====> app1 nginx information
       Nginx client max body size:      1m
       Nginx proxy read timeout:        60s
=====> app2 nginx information
       Nginx client max body size:      50m`
    const result = parseBulkReport(raw, 'nginx')
    expect(result.size).toBe(2)
    expect(result.get('app1')).toEqual({
      'client-max-body-size': '1m',
      'proxy-read-timeout': '60s',
    })
    expect(result.get('app2')).toEqual({
      'client-max-body-size': '50m',
    })
  })

  it('handles hyphenated app names', () => {
    const raw = `=====> my-cool-app logs information
       Logs max size:                   10m`
    const result = parseBulkReport(raw, 'logs')
    expect(result.get('my-cool-app')).toEqual({ 'max-size': '10m' })
  })

  it('returns empty map for empty input', () => {
    expect(parseBulkReport('', 'nginx').size).toBe(0)
  })

  it('handles multi-word namespaces like docker-options', () => {
    const raw = `=====> myapp docker options information
       Docker options build:          --shm-size 256m
       Docker options deploy:         --restart=on-failure:10
       Docker options run:`
    const result = parseBulkReport(raw, 'docker-options')
    expect(result.get('myapp')).toEqual({
      'build': '--shm-size 256m',
      'deploy': '--restart=on-failure:10',
    })
  })

  it('skips computed and global keys same as parseReport', () => {
    const raw = `=====> app1 nginx information
       Nginx computed hsts:             true
       Nginx global hsts:              true
       Nginx hsts:                      true`
    const result = parseBulkReport(raw, 'nginx')
    expect(result.get('app1')).toEqual({ 'hsts': 'true' })
  })
})
