import { inflateSync } from 'fflate'

const CAB_HEADER_SIZE = 36
const CAB_MSZIP = 1
const CAB_UNCOMPRESSED = 0

interface CabFolder {
  dataOffset: number
  blockCount: number
  compression: number
  data: Uint8Array
}

interface CabFile {
  name: string
  size: number
  offset: number
  folder: number
}

function u16(data: Uint8Array, offset: number): number {
  if (offset + 2 > data.length) throw new Error('errors.badCab')
  return data[offset]! | (data[offset + 1]! << 8)
}

function u32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) throw new Error('errors.badCab')
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0
}

function readString(data: Uint8Array, offset: number): { value: string, next: number } {
  const end = data.indexOf(0, offset)
  if (end < 0) throw new Error('errors.badCab')
  return { value: new TextDecoder().decode(data.subarray(offset, end)), next: end + 1 }
}

function normalizeCabPath(input: string): string {
  const parts: string[] = []
  for (const part of input.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { parts.pop(); continue }
    parts.push(part)
  }
  return parts.join('/')
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

function decompressFolder(data: Uint8Array, offset: number, blockCount: number, compression: number, reserved: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  let previous = new Uint8Array(0)

  for (let block = 0; block < blockCount; block++) {
    if (offset + 8 + reserved > data.length) throw new Error('errors.badCab')
    const cbData = u16(data, offset + 4)
    const cbUncompressed = u16(data, offset + 6)
    const start = offset + 8 + reserved
    const end = start + cbData
    if (end > data.length) throw new Error('errors.badCab')
    const compressed = data.subarray(start, end)
    let output: Uint8Array

    try {
      if (compression === CAB_UNCOMPRESSED) {
        if (cbData !== cbUncompressed) throw new Error('size mismatch')
        output = compressed.slice()
      }
      else if (compression === CAB_MSZIP) {
        if (compressed.length < 2 || compressed[0] !== 0x43 || compressed[1] !== 0x4b)
          throw new Error('missing MSZIP signature')
        output = inflateSync(compressed.subarray(2), { dictionary: previous.slice(-32768) })
      }
      else {
        throw new Error('unsupported compression')
      }
    }
    catch (error) {
      if (error instanceof Error && error.message === 'unsupported compression')
        throw new Error('errors.unsupportedCabCompression', { cause: error })
      throw new Error('errors.badCab', { cause: error })
    }

    if (output.length !== cbUncompressed) throw new Error('errors.badCab')
    total += output.length
    chunks.push(output)
    previous = output
    offset = end
  }
  return concatChunks(chunks, total)
}

function parseCab(data: Uint8Array): { files: CabFile[], folders: CabFolder[] } {
  if (data.length < CAB_HEADER_SIZE || data[0] !== 0x4d || data[1] !== 0x53 || data[2] !== 0x43 || data[3] !== 0x46)
    throw new Error('errors.badCab')

  const cabinetSize = u32(data, 8)
  const filesOffset = u32(data, 16)
  const folderCount = u16(data, 26)
  const fileCount = u16(data, 28)
  const flags = u16(data, 30)
  if (cabinetSize > data.length || folderCount === 0)
    throw new Error('errors.badCab')

  let offset = CAB_HEADER_SIZE
  let folderReserve = 0
  let dataReserve = 0
  if (flags & 0x0004) {
    const headerReserve = u16(data, offset)
    folderReserve = data[offset + 2]!
    dataReserve = data[offset + 3]!
    offset += 4 + headerReserve
    if (offset > data.length) throw new Error('errors.badCab')
  }

  if (flags & 0x0001) { offset = readString(data, offset).next; offset = readString(data, offset).next }
  if (flags & 0x0002) { offset = readString(data, offset).next; offset = readString(data, offset).next }

  const folders: CabFolder[] = []
  for (let i = 0; i < folderCount; i++) {
    if (offset + 8 + folderReserve > data.length) throw new Error('errors.badCab')
    const folder: CabFolder = { dataOffset: u32(data, offset), blockCount: u16(data, offset + 4), compression: u16(data, offset + 6) & 0x000f, data: new Uint8Array(0) }
    offset += 8 + folderReserve
    folder.data = decompressFolder(data, folder.dataOffset, folder.blockCount, folder.compression, dataReserve)
    folders.push(folder)
  }
  return { folders, files: parseCabFiles(data, filesOffset, fileCount, folders) }
}

function parseCabFiles(data: Uint8Array, offset: number, count: number, folders: CabFolder[]): CabFile[] {
  const files: CabFile[] = []
  for (let i = 0; i < count; i++) {
    if (offset + 16 > data.length) throw new Error('errors.badCab')
    const size = u32(data, offset)
    const fileOffset = u32(data, offset + 4)
    const folder = u16(data, offset + 8)
    offset += 16
    const name = readString(data, offset)
    offset = name.next
    if (folder >= folders.length || fileOffset > folders[folder]!.data.length || size > folders[folder]!.data.length - fileOffset)
      throw new Error('errors.badCab')
    const safeName = normalizeCabPath(name.value)
    if (!safeName) continue
    files.push({ name: safeName, size, offset: fileOffset, folder })
  }
  return files
}

export function listCab(data: Uint8Array): { name: string, size: number }[] {
  try { return parseCab(data).files.map(file => ({ name: file.name, size: file.size })) }
  catch (error) {
    if (error instanceof Error && error.message === 'errors.unsupportedCabCompression') throw error
    throw new Error('errors.badCab', { cause: error })
  }
}

export function extractCabEntry(data: Uint8Array, name: string): Uint8Array | null {
  const { files, folders } = parseCab(data)
  const file = files.find(entry => entry.name === name)
  return file ? folders[file.folder]!.data.slice(file.offset, file.offset + file.size) : null
}
