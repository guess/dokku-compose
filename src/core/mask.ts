export function maskSensitiveArgs(cmd: string): string {
  return cmd.replace(/(\S*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)\S*)=(\S+)/gi, (_, key, value) => {
    if (value.length <= 4) return `${key}=****`
    return `${key}=****${value.slice(-4)}`
  })
}
