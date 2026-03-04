#!/usr/bin/env node
import { Command } from 'commander'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { version } = require('../package.json')
import { loadConfig } from './core/config.js'
import { createRunner } from './core/dokku.js'
import { createContext } from './core/context.js'
import { runUp } from './commands/up.js'
import { runDown } from './commands/down.js'
import { runExport } from './commands/export.js'
import { computeDiff, formatSummary, formatVerbose } from './commands/diff.js'
import { validate } from './commands/validate.js'

const program = new Command()
  .name('dokku-compose')
  .version(version)

function makeRunner(opts: { dryRun?: boolean }) {
  return createRunner({
    host: process.env.DOKKU_HOST,
    dryRun: opts.dryRun ?? false,
  })
}

program
  .command('up [apps...]')
  .description('Create/update apps and services to match config')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .option('--dry-run', 'Print commands without executing')
  .option('--fail-fast', 'Stop on first error')
  .action(async (apps, opts) => {
    const config = loadConfig(opts.file)
    const runner = makeRunner(opts)
    const ctx = createContext(runner)
    try {
      await runUp(ctx, config, apps)
      if (opts.dryRun) {
        console.log('\n# Commands that would run:')
        for (const cmd of runner.dryRunLog) console.log(`dokku ${cmd}`)
      }
    } finally {
      await ctx.close()
    }
  })

program
  .command('down [apps...]')
  .description('Destroy apps and services (requires --force)')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .option('--force', 'Required to destroy apps')
  .action(async (apps, opts) => {
    if (!opts.force) { console.error('--force required'); process.exit(1) }
    const config = loadConfig(opts.file)
    const runner = makeRunner({})
    const ctx = createContext(runner)
    try {
      await runDown(ctx, config, apps, { force: true })
    } finally {
      await ctx.close()
    }
  })

program
  .command('validate [file]')
  .description('Validate dokku-compose.yml without touching the server')
  .action((file = 'dokku-compose.yml') => {
    const result = validate(file)
    for (const w of result.warnings) console.warn(`WARN:  ${w}`)
    for (const e of result.errors) console.error(`ERROR: ${e}`)
    if (result.errors.length > 0) {
      console.error(`\n${result.errors.length} error(s), ${result.warnings.length} warning(s)`)
      process.exit(1)
    }
    if (result.warnings.length > 0) {
      console.log(`\n0 errors, ${result.warnings.length} warning(s)`)
    } else {
      console.log('Valid.')
    }
  })

program
  .command('export')
  .description('Export server state to dokku-compose.yml format')
  .option('--app <app>', 'Export only a specific app')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .action(async (opts) => {
    const runner = makeRunner({})
    const ctx = createContext(runner)
    try {
      const result = await runExport(ctx, {
        appFilter: opts.app ? [opts.app] : undefined
      })
      const out = yaml.dump(result, { lineWidth: 120 })
      if (opts.output) {
        fs.writeFileSync(opts.output, out)
        console.error(`Written to ${opts.output}`)
      } else {
        process.stdout.write(out)
      }
    } finally {
      await ctx.close()
    }
  })

program
  .command('diff')
  .description('Show what is out of sync between config and server')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .option('--verbose', 'Show git-style +/- diff')
  .action(async (opts) => {
    const desired = loadConfig(opts.file)
    const runner = makeRunner({})
    const ctx = createContext(runner)
    try {
      const diff = await computeDiff(ctx, desired)
      const output = opts.verbose ? formatVerbose(diff) : formatSummary(diff)
      process.stdout.write(output)
      process.exit(diff.inSync ? 0 : 1)
    } finally {
      await ctx.close()
    }
  })

program
  .command('ps [apps...]')
  .description('Show status of configured apps')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .action(async (apps, opts) => {
    const config = loadConfig(opts.file)
    const runner = makeRunner({})
    try {
      const { runPs } = await import('./commands/ps.js')
      await runPs(runner, config, apps)
    } finally {
      await runner.close()
    }
  })

program
  .command('init [apps...]')
  .description('Create a starter dokku-compose.yml')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .action(async (apps, opts) => {
    const { runInit } = await import('./commands/init.js')
    runInit(opts.file, apps)
  })

program.parse()
