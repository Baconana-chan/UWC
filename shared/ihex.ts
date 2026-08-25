export function ihexDecode(input: string): string {
  const records = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const bytes: number[] = []
  let base = 0
  let eof = false
  for (const line of records) {
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length < 11) throw new Error('errors.badIhex')
    const raw = Uint8Array.from(line.slice(1).match(/../g)!.map(pair => Number.parseInt(pair, 16)))
    if (raw.length !== raw[0]! + 5 || raw.reduce((sum, value) => sum + value, 0) % 256 !== 0) throw new Error('errors.badIhex')
    const length = raw[0]!, address = (raw[1]! << 8) | raw[2]!, type = raw[3]!
    if (type === 0) {
      const start = base + address
      while (bytes.length < start) bytes.push(0)
      for (let i = 0; i < length; i++) bytes[start + i] = raw[4 + i]!
    }
    else if (type === 1) { eof = true; break }
    else if (type === 2) base = ((raw[4]! << 8) | raw[5]!) << 4
    else if (type === 4) base = ((raw[4]! << 8) | raw[5]!) << 16
  }
  if (!eof) throw new Error('errors.badIhex')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000))
  return btoa(binary)
}

export function ihexEncode(input: string): string {
  const binary = atob(input.trim())
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16)
    const values = [chunk.length, (offset >> 8) & 255, offset & 255, 0, ...chunk]
    const checksum = (-values.reduce((sum, value) => sum + value, 0)) & 255
    lines.push(`:${values.map(value => value.toString(16).padStart(2, '0')).join('')}${checksum.toString(16).padStart(2, '0')}`.toUpperCase())
  }
  lines.push(':00000001FF')
  return lines.join('\n')
}
