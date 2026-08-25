import { normalizeArchivePath, type ZipEntry } from './zipUtils'

interface IsoFile { name: string, size: number, offset: number }
const SECTOR = 2048

function u16(data: Uint8Array, offset: number): number { return data[offset]! | (data[offset + 1]! << 8) }
function u32(data: Uint8Array, offset: number): number { return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0 }

function parseIso(data: Uint8Array): IsoFile[] {
  const pvd = 16 * SECTOR
  if (data.length < pvd + SECTOR || new TextDecoder().decode(data.subarray(pvd + 1, pvd + 6)) !== 'CD001') throw new Error('errors.badIso')
  const sectorSize = u16(data, pvd + 128) || SECTOR
  if (sectorSize < 512 || sectorSize > 4096) throw new Error('errors.badIso')
  const root = pvd + 156
  const rootLength = data[root]
  if (!rootLength || root + rootLength > data.length) throw new Error('errors.badIso')
  const files: IsoFile[] = []
  const visited = new Set<number>()
  function walk(record: number, path: string) {
    const extent = u32(data, record + 2)
    const size = u32(data, record + 10)
    const start = extent * sectorSize
    if (start + size > data.length) throw new Error('errors.badIso')
    if (visited.has(start)) return
    visited.add(start)
    let offset = start
    const end = start + size
    while (offset < end) {
      const length = data[offset]
      if (!length) { offset = Math.ceil((offset + 1) / sectorSize) * sectorSize; continue }
      if (offset + length > end || length < 34) throw new Error('errors.badIso')
      const flags = data[offset + 25]!
      const fileSize = u32(data, offset + 10)
      const nameLength = data[offset + 32]!
      if (33 + nameLength > length) throw new Error('errors.badIso')
      if (nameLength > 1 || data[offset + 33]! > 1) {
        let name = new TextDecoder().decode(data.subarray(offset + 33, offset + 33 + nameLength))
        name = name.replace(/;\d+$/, '').replace(/\.$/, '')
        const safeName = normalizeArchivePath(path ? `${path}/${name}` : name)
        if (safeName) {
          if (flags & 2) walk(offset, safeName)
          else files.push({ name: safeName, size: fileSize, offset: u32(data, offset + 2) * sectorSize })
        }
      }
      offset += length
    }
  }
  walk(root, '')
  return files
}

export function listIso(data: Uint8Array): ZipEntry[] {
  try { return parseIso(data).map(file => ({ name: file.name, size: file.size })) }
  catch (error) { throw new Error('errors.badIso', { cause: error }) }
}

export function extractIsoEntry(data: Uint8Array, name: string): Uint8Array | null {
  const file = parseIso(data).find(entry => entry.name === name)
  return file ? data.slice(file.offset, file.offset + file.size) : null
}
