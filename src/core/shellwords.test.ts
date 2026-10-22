import { describe, it, expect } from 'vitest'
import { shellSplit, quoteShellArg } from './shellwords.js'

// Expectations are Dokku 0.38's own (plugins/docker-options dockeroptions_test.go).
describe('quoteShellArg', () => {
  it.each([
    ['', "''"],
    ['hello', 'hello'],
    ['hello world', "'hello world'"],
    ["it's", "'it'\\''s'"],
    ['$VAR', "'$VAR'"],
    ['a|b', "'a|b'"],
    ['k=a b', "'k=a b'"],
    ['URL=https://x:1/p-q_r.s,t@u=v', 'URL=https://x:1/p-q_r.s,t@u=v'],
  ])('%j -> %s', (input, want) => expect(quoteShellArg(input)).toBe(want))
})

describe('shellSplit', () => {
  it.each([
    ['--label key="hello world"', ['--label', 'key=hello world']],
    ["--label 'x=$(id)'", ['--label', 'x=$(id)']],
    ['--label "k=a\\$b"', ['--label', 'k=a$b']],
    ["a 'it'\\''s'  b", ['a', "it's", 'b']],
    ["'a  b'", ['a  b']],
  ])('%s', (input, want) => expect(shellSplit(input)).toEqual(want))

  it('an unterminated quote is undefined', () => expect(shellSplit("--label 'unbalanced")).toBeUndefined())
  it('round-trips quoteShellArg', () => {
    for (const w of ['a b', "x'y", '$(id)', 'p?q*r', 'a  b', '-a --x'])
      expect(shellSplit(quoteShellArg(w))).toEqual([w])
  })
})
