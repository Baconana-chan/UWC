import { unzlibSync } from 'fflate'
import { normalizeArchivePath, type ZipEntry } from './zipUtils'

interface XarFile { name: string, size: number, offset: number }

function u16(data: Uint8Array, offset: number): number { return (data[offset]! << 8) | data[offset + 1]! }
function u64(data: Uint8Array, offset: number): number {
  const high = (data[offset]! * 0x1000000 + data[offset + 1]! * 0x10000 + data[offset + 2]! * 0x100 + data[offset + 3]!)
  const low = (data[offset + 4]! * 0x1000000 + data[offset + 5]! * 0x10000 + data[offset + 6]! * 0x100 + data[offset + 7]!)
  const value = high * 0x100000000 + low
  if (!Number.isSafeInteger(value)) throw new Error('errors.badXar')
  return value
}

function xmlText(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!match) throw new Error('errors.badXar')
  return match[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

function parseXar(data: Uint8Array): XarFile[] {
  if (data.length < 28 || new TextDecoder().decode(data.subarray(0, 4)) !== 'xar!') throw new Error('errors.badXar')
  const headerSize = u16(data, 4)
  const tocCompressed = u64(data, 8)
  const tocUncompressed = u64(data, 16)
  if (headerSize < 28 || headerSize + tocCompressed > data.length || tocUncompressed > 256 * 1024 * 1024) throw new Error('errors.badXar')
  const toc = unzlibSync(data.subarray(headerSize, headerSize + tocCompressed))
  if (toc.length !== tocUncompressed) throw new Error('errors.badXar')
  const xml = new TextDecoder().decode(toc)
  const heap = headerSize + tocCompressed
  const files: XarFile[] = []
  for (const block of xml.matchAll(/<file>([\s\S]*?)<\/file>/g)) {
    const entry = block[1]!
    const name = normalizeArchivePath(xmlText(entry, 'name'))
    if (!name) continue
    const dataXml = xmlText(entry, 'data')
    const offset = Number.parseInt(xmlText(dataXml, 'offset'), 10)
    const size = Number.parseInt(xmlText(dataXml, 'length'), 10)
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || heap + offset + size > data.length)
      throw new Error('errors.badXar')
    files.push({ name, size, offset: heap + offset })
  }
  return files
}

export function listXar(data: Uint8Array): ZipEntry[] {
  try { return parseXar(data).map(file => ({ name: file.name, size: file.size })) }
  catch (error) { throw new Error('errors.badXar', { cause: error }) }
}

export function extractXarEntry(data: Uint8Array, name: string): Uint8Array | null {
  const file = parseXar(data).find(entry => entry.name === name)
  return file ? data.slice(file.offset, file.offset + file.size) : null
}
