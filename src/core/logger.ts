// src/core/logger.ts
import chalk from 'chalk'

export function logAction(context: string, message: string): void {
  process.stdout.write(chalk.blue(`[${context.padEnd(12)}]`) + ` ${message}`)
}

export function logDone(): void {
  console.log(`... ${chalk.green('done')}`)
}

export function logSkip(): void {
  console.log(`... ${chalk.yellow('already configured')}`)
}

export function logError(context: string, message: string): void {
  console.error(chalk.red(`[${context.padEnd(12)}] ERROR: ${message}`))
}

export function logWarn(context: string, message: string): void {
  console.warn(chalk.yellow(`[${context.padEnd(12)}] WARN: ${message}`))
}
