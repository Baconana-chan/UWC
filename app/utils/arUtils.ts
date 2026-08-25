import { normalizeArchivePath, type ZipEntry } from './zipUtils'

interface ArFile { name: string, size: number, dataOffset: number }

function readAscii(data: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(data.subarray(offset, offset + length)).replace(/[ \0]+$/, '')
}

function parseAr(data: Uint8Array): ArFile[] {
  const signature = new TextDecoder().decode(data.subarray(0, 8))
  if (signature !== '!<arch>\n') throw new Error('errors.badAr')
  const files: ArFile[] = []
  let offset = 8
  let longNames = ''
  while (offset < data.length) {
    if (offset + 60 > data.length) throw new Error('errors.badAr')
    if (data[offset + 58] !== 0x60 || data[offset + 59] !== 0x0a) throw new Error('errors.badAr')
    let name = readAscii(data, offset, 16)
    const size = Number.parseInt(readAscii(data, offset + 48, 10), 10)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 60 + size > data.length) throw new Error('errors.badAr')
    const body = offset + 60
    if (name === '//') longNames = new TextDecoder().decode(data.subarray(body, body + size))
    else if (name.startsWith('/') && /^\/\d+$/.test(name) && longNames) {
      const start = Number.parseInt(name.slice(1), 10)
      const end = longNames.indexOf('\n', start)
      name = longNames.slice(start, end < 0 ? longNames.length : end).replace(/\/$/, '')
    }
    else if (name.endsWith('/')) name = name.slice(0, -1)
    if (name !== '/' && name !== '__.SYMDEF' && name !== '__.SYMDEF SORTED' && name !== '//') {
      const safeName = normalizeArchivePath(name)
      if (safeName) files.push({ name: safeName, size, dataOffset: body })
    }
    offset = body + size + (size & 1)
  }
  return files
}

export function listAr(data: Uint8Array): ZipEntry[] {
  try { return parseAr(data).map(file => ({ name: file.name, size: file.size })) }
  catch (error) { throw new Error('errors.badAr', { cause: error }) }
}

export function extractArEntry(data: Uint8Array, name: string): Uint8Array | null {
  const file = parseAr(data).find(entry => entry.name === name)
  return file ? data.slice(file.dataOffset, file.dataOffset + file.size) : null
}
