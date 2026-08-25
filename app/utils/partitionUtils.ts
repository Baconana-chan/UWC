import { normalizeArchivePath, type ZipEntry } from './zipUtils'

interface Partition { name: string, size: number, offset: number }
const sector = 512

function u32(data: Uint8Array, offset: number): number { return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0 }
function u64(data: Uint8Array, offset: number): number { const low = u32(data, offset); const high = u32(data, offset + 4); const value = high * 0x100000000 + low; if (!Number.isSafeInteger(value)) throw new Error('errors.badPartitionTable'); return value }
function guid(data: Uint8Array, offset: number): string { return Array.from(data.subarray(offset, offset + 16), b => b.toString(16).padStart(2, '0')).join('') }
function utf16(data: Uint8Array, offset: number, length: number): string { return new TextDecoder('utf-16le').decode(data.subarray(offset, offset + length)).replace(/\0+$/, '') }

function parsePartitions(data: Uint8Array): Partition[] {
  const isGpt = data.length >= 520 && new TextDecoder().decode(data.subarray(512, 520)) === 'EFI PART'
  if (isGpt) {
    const header = 512
    const entryLba = u64(data, header + 72)
    const count = u32(data, header + 80)
    const entrySize = u32(data, header + 84)
    if (entrySize < 128 || entrySize > 4096 || entryLba * sector + count * entrySize > data.length) throw new Error('errors.badPartitionTable')
    const files: Partition[] = []
    for (let i = 0; i < count; i++) {
      const at = entryLba * sector + i * entrySize
      if (guid(data, at) === '00000000000000000000000000000000') continue
      const first = u64(data, at + 32), last = u64(data, at + 40)
      if (last < first || last * sector >= data.length) throw new Error('errors.badPartitionTable')
      const name = utf16(data, at + 56, Math.min(72, entrySize - 56)) || `Partition ${i + 1}`
      files.push({ name: normalizeArchivePath(name), offset: first * sector, size: (last - first + 1) * sector })
    }
    return files
  }
  if (data.length < sector || data[510] !== 0x55 || data[511] !== 0xaa) throw new Error('errors.badPartitionTable')
  const files: Partition[] = []
  for (let i = 0; i < 4; i++) {
    const at = 446 + i * 16
    const type = data[at + 4]!
    const start = u32(data, at + 8), count = u32(data, at + 12)
    if (!type || !count) continue
    if ((start + count) * sector > data.length) throw new Error('errors.badPartitionTable')
    files.push({ name: `Partition ${i + 1} (type 0x${type.toString(16).padStart(2, '0')})`, offset: start * sector, size: count * sector })
  }
  return files
}

export function listPartitionTable(data: Uint8Array): ZipEntry[] {
  try { return parsePartitions(data).map(({ name, size }) => ({ name, size })) }
  catch (error) { throw new Error('errors.badPartitionTable', { cause: error }) }
}

export function extractPartition(data: Uint8Array, name: string): Uint8Array | null {
  const file = parsePartitions(data).find(entry => entry.name === name)
  return file ? data.slice(file.offset, file.offset + file.size) : null
}
