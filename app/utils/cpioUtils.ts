import { normalizeArchivePath, type ZipEntry } from './zipUtils'

interface CpioFile { name: string, size: number, dataOffset: number }

function hex(data: Uint8Array, offset: number, length: number): number {
  const value = Number.parseInt(new TextDecoder().decode(data.subarray(offset, offset + length)), 16)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('errors.badCpio')
  return value
}

function octal(data: Uint8Array, offset: number, length: number): number {
  const value = Number.parseInt(new TextDecoder().decode(data.subarray(offset, offset + length)).trim(), 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('errors.badCpio')
  return value
}

function align(value: number, boundary: number): number { return (value + boundary - 1) & ~(boundary - 1) }

function parseCpio(data: Uint8Array): CpioFile[] {
  const magic = new TextDecoder().decode(data.subarray(0, 6))
  const newc = magic === '070701' || magic === '070702'
  const odc = magic === '070707'
  if (!newc && !odc) throw new Error('errors.badCpio')

  const files: CpioFile[] = []
  let offset = 0
  while (offset + (newc ? 110 : 76) <= data.length) {
    const header = offset
    let nameSize: number, fileSize: number, mode: number
    if (newc) {
      if (new TextDecoder().decode(data.subarray(header, header + 6)) !== magic) throw new Error('errors.badCpio')
      mode = hex(data, header + 14, 8)
      fileSize = hex(data, header + 54, 8)
      nameSize = hex(data, header + 94, 8)
      offset = header + 110
    }
    else {
      if (new TextDecoder().decode(data.subarray(header, header + 6)) !== '070707') throw new Error('errors.badCpio')
      mode = octal(data, header + 18, 6)
      nameSize = octal(data, header + 59, 6)
      fileSize = octal(data, header + 65, 11)
      offset = header + 76
    }
    if (nameSize < 1 || offset + nameSize > data.length) throw new Error('errors.badCpio')
    const nameEnd = offset + nameSize - 1
    const name = new TextDecoder().decode(data.subarray(offset, nameEnd))
    offset = newc ? align(offset + nameSize, 4) : offset + nameSize
    if (name === 'TRAILER!!!') break
    if (offset + fileSize > data.length) throw new Error('errors.badCpio')
    const type = mode & 0xf000
    if (type === 0x8000) {
      const safeName = normalizeArchivePath(name)
      if (safeName) files.push({ name: safeName, size: fileSize, dataOffset: offset })
    }
    offset = newc ? align(offset + fileSize, 4) : offset + fileSize
  }
  return files
}

export function listCpio(data: Uint8Array): ZipEntry[] {
  try { return parseCpio(data).map(file => ({ name: file.name, size: file.size })) }
  catch (error) { throw new Error('errors.badCpio', { cause: error }) }
}

export function extractCpioEntry(data: Uint8Array, name: string): Uint8Array | null {
  const file = parseCpio(data).find(entry => entry.name === name)
  return file ? data.slice(file.dataOffset, file.dataOffset + file.size) : null
}
