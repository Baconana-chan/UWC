import type { ZipEntry } from './zipUtils'

function readBits(data: Uint8Array, state: { bit: number }, count: number): number | null {
  if (state.bit + count > data.length * 8) return null
  let value = 0
  for (let i = 0; i < count; i++) {
    value = (value << 1) | ((data[state.bit >> 3]! >> (7 - (state.bit & 7))) & 1)
    state.bit++
  }
  return value
}

export function uncompress(data: Uint8Array): Uint8Array {
  if (data.length < 3 || data[0] !== 0x1f || data[1] !== 0x9d) throw new Error('errors.badCompress')
  const flags = data[2]!
  const maxBits = flags & 0x1f
  if (maxBits < 9 || maxBits > 16) throw new Error('errors.badCompress')
  const blockMode = (flags & 0x80) !== 0
  const clearCode = 256
  let codeSize = 9
  let nextCode = blockMode ? 257 : 256
  let maxCode = (1 << codeSize) - 1
  const prefix = new Int32Array(1 << maxBits)
  const suffix = new Uint8Array(1 << maxBits)
  const stack = new Uint8Array(1 << maxBits)
  const output: number[] = []
  const state = { bit: 24 }
  let oldCode: number | null = null
  let first = 0

  while (true) {
    const code = readBits(data, state, codeSize)
    if (code === null) break
    if (blockMode && code === clearCode) {
      codeSize = 9; nextCode = 257; maxCode = (1 << codeSize) - 1; oldCode = null
      continue
    }
    if (oldCode === null) {
      if (code > 255) throw new Error('errors.badCompress')
      output.push(code); first = code; oldCode = code; continue
    }
    let current = code
    let stackSize = 0
    if (current === nextCode) { stack[stackSize++] = first; current = oldCode }
    if (current >= nextCode) throw new Error('errors.badCompress')
    while (current > 255) {
      if (stackSize >= stack.length) throw new Error('errors.badCompress')
      stack[stackSize++] = suffix[current]!
      current = prefix[current]!
    }
    first = current
    output.push(current)
    while (stackSize) output.push(stack[--stackSize]!)
    if (nextCode < (1 << maxBits)) {
      prefix[nextCode] = oldCode
      suffix[nextCode] = first
      nextCode++
      if (nextCode > maxCode && codeSize < maxBits) { codeSize++; maxCode = (1 << codeSize) - 1 }
    }
    oldCode = code
  }
  return Uint8Array.from(output)
}

export function listCompress(data: Uint8Array, name: string): ZipEntry[] {
  const output = uncompress(data)
  return [{ name: name.replace(/\.Z$/i, ''), size: output.length }]
}
