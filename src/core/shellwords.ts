/**
 * Dokku stores each docker option as shell-quoted text: `docker-options:add`
 * joins its arguments with spaces, shell-splits them (quotes group words, no
 * expansion), starts a new option at every token that begins with `-`, and
 * re-quotes each token with `quoteShellArg`'s rules (Dokku 0.38,
 * plugins/docker-options). These two functions mirror that.
 */

/** Split like Dokku's shellwords: quotes and backslashes group, nothing expands. Returns undefined on an unterminated quote. */
export function shellSplit(input: string): string[] | undefined {
  const words: string[] = []
  let cur = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else cur += c
    } else if (c === '\\') {
      if (i + 1 >= input.length) return undefined
      cur += input[++i]
      inWord = true
    } else if (quote === '"') {
      if (c === '"') quote = null
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      inWord = true
    } else if (/\s/.test(c)) {
      if (inWord) { words.push(cur); cur = ''; inWord = false }
    } else {
      cur += c
      inWord = true
    }
  }
  if (quote) return undefined
  if (inWord) words.push(cur)
  return words
}

/** Single-quote a word the way Dokku does when storing it; plain words stay as they are. */
export function quoteShellArg(s: string): string {
  if (s === '') return "''"
  if (!/[ \t\n"'$`\\*?\[\]<>|&;(){}!#~]/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}
