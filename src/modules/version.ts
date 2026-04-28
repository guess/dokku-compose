const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/

function parseSemver(input: string): [number, number, number] {
  const m = input.match(SEMVER_RE)
  if (!m) throw new Error(`Cannot parse version: ${input}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPatch] = parseSemver(a)
  const [bMaj, bMin, bPatch] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  return 0
}
