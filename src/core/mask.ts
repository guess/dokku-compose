export function maskSensitiveArgs(cmd: string): string {
  return cmd.replace(/([^\s=]*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL)[^\s=]*)=(\S+)/gi, (_, key, value) => {
    if (value.length <= 4) return `${key}=****`
    return `${key}=****${value.slice(-4)}`
  })
}
