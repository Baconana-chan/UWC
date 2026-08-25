/**
 * UWC — утилиты для работы с архивами в браузере (ZIP, TAR, TAR.GZ, GZIP, Brotli, LZMA, BZIP2, Zstandard).
 *
 * Библиотеки:
 * - fflate (MIT, ~7KB gz) — ZIP и GZIP, чистый JS, работает в браузере
 * - TAR — свой парсер (~70 строк, формат ustar: 512-байтовые заголовочные блоки)
 * - Brotli — нативный DecompressionStream('br') (Chrome 80+, Safari 16.4+, Firefox 147+);
 *   без зависимостей. Если браузер не умеет — возвращаем понятную ошибку.
 *
 * Не используем JSZip (тяжелее) и серверную сторону (безопаснее для пользователя).
 */

import { gunzipSync, unzipSync } from 'fflate'
import { lzmaDecompress } from '../../shared/lzmaDecoder'
import { bzip2Decompress } from '../../shared/bzip2Decoder'
import { zstdDecompress } from '../../shared/zstdDecoder'
import { xzDecompress } from '../../shared/xzDecoder'
import { extractCabEntry, listCab } from './cabUtils'
import { extractCpioEntry, listCpio } from './cpioUtils'
import { extractArEntry, listAr } from './arUtils'
import { uncompress } from './compressUtils'
import { extractIsoEntry, listIso } from './isoUtils'
import { extractXarEntry, listXar } from './xarUtils'
import { extractPartition, listPartitionTable } from './partitionUtils'


/** Один файл внутри архива. */
export interface ZipEntry {
  name: string
  size: number
}

/** Поддерживаемые форматы архивов. */
export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gz' | 'br' | 'lzma' | 'bzip2' | 'zstd' | 'xz' | 'cab' | 'cpio' | 'ar' | 'compress' | 'iso' | 'xar' | 'partition'

/* ---------------- детект формата по магическим байтам ---------------- */

/** GZIP: 1f 8b */
function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
}

/** BZIP2: ASCII `BZh` followed by block-size digit 1–9. */
function isBzip2(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x42 && data[1] === 0x5a && data[2] === 0x68 && data[3]! >= 0x31 && data[3]! <= 0x39
}

/** Zstandard frame magic: 28 b5 2f fd. */
function isZstd(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd
}

/** XZ stream magic: fd 37 7a 58 5a 00. */
function isXz(data: Uint8Array): boolean {
  return data.length >= 6 && data[0] === 0xfd && data[1] === 0x37 && data[2] === 0x7a
    && data[3] === 0x58 && data[4] === 0x5a && data[5] === 0x00
}

/**
 * Brotli не имеет надёжной магии: контейнер начинается с произвольного
 * WBITS-байта. Распознаём оба вида заголовка:
 * - канонический: первый байт ∈ {0x21, 0x81, 0x91, 0xa1, 0xe1} (+0x3b для словаря)
 * - raw (bits1-3 = 101, т.е. младший полубайт 0xb) — так кодирует Node.js
 *   и многие энкодеры. Сужаем до этих форм — остальное сразу «не brotli».
 */
const BROTLI_FIRST_BYTES = new Set([0x21, 0x81, 0x91, 0xa1, 0xe1, 0x3b])

function mightBeBrotli(data: Uint8Array): boolean {
  if (data.length === 0) return false
  return BROTLI_FIRST_BYTES.has(data[0]!) || (data[0]! & 0x0f) === 0x0b
}

/** ZIP: PK\x03\x04 (пустые/специфичные ZIP могут начинаться с PK\x05\x06 или PK\x07\x08). */
function isZip(data: Uint8Array): boolean {
  return data.length >= 4
    && data[0] === 0x50 && data[1] === 0x4b
    && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)
    && (data[3] === 0x04 || data[3] === 0x06 || data[3] === 0x08)
}

/** TAR: в ustar-заголовке по смещению 257 лежит "ustar". */
function isTar(data: Uint8Array): boolean {
  if (data.length < 262) return false
  return data[257] === 0x75 && data[258] === 0x73 && data[259] === 0x74
    && data[260] === 0x61 && data[261] === 0x72
}

/** Определить формат архива по содержимому. */
export function detectArchiveFormat(data: Uint8Array, fileName = ''): ArchiveFormat {
  if (/\.(?:cpio|img\.cpio)$/i.test(fileName)) return 'cpio'
  if (/\.(?:a|ar|deb)$/i.test(fileName)) return 'ar'
  if (/\.Z$/i.test(fileName)) return 'compress'
  if (/\.(?:iso|iso9660)$/i.test(fileName)) return 'iso'
  if (/\.xar$/i.test(fileName)) return 'xar'
  if (/\.cab$/i.test(fileName)) return 'cab'
  if (/\.(?:xz|tar\.xz)$/i.test(fileName)) return 'xz'
  if (/\.(?:zst|tar\.zst)$/i.test(fileName)) return 'zstd'
  if (/\.(?:lzma|tar\.lz)$/i.test(fileName)) return 'lzma'
  if (/\.(?:bz2|tar\.bz2)$/i.test(fileName)) return 'bzip2'
  if (isZip(data)) return 'zip'
  if (data.length >= 4 && data[0] === 0x78 && data[1] === 0x61 && data[2] === 0x72 && data[3] === 0x21) return 'xar'
  if (data.length >= 4 && data[0] === 0x4d && data[1] === 0x53 && data[2] === 0x43 && data[3] === 0x46) return 'cab'
  const asciiMagic = new TextDecoder().decode(data.subarray(0, 8))
  if (asciiMagic === '!<arch>\n') return 'ar'
  if (asciiMagic.startsWith('070701') || asciiMagic.startsWith('070702') || asciiMagic.startsWith('070707')) return 'cpio'
  if (data.length >= 3 && data[0] === 0x1f && data[1] === 0x9d) return 'compress'
  if (isGzip(data)) {
    // TAR.GZ: после gunzip должен остаться tar — проверяем по имени/содержимому в detectArchive()
    return 'tar.gz'
  }
  if (isBzip2(data)) return 'bzip2'
  if (isZstd(data)) return 'zstd'
  if (isXz(data)) return 'xz'
  if (data.length >= 16 * 2048 + 6 && new TextDecoder().decode(data.subarray(16 * 2048 + 1, 16 * 2048 + 6)) === 'CD001') return 'iso'
  if (data.length >= 512 && data[510] === 0x55 && data[511] === 0xaa) return 'partition'
  if (isTar(data)) return 'tar'
  if (mightBeBrotli(data)) return 'br'
  // .gz без tar внутри (plain gzip) — тоже gzip-контейнер
  throw new Error('errors.badArchive')
}

/* ---------------- TAR (ustar, 512-байтовые блоки) ---------------- */

const TAR_BLOCK = 512

/** Октальное поле TAR → число (пробелы и NUL в конце допустимы). */
function parseOctal(buf: Uint8Array, offset: number, length: number): number {
  let end = offset + length
  // пропускаем ведущие пробелы/NUL
  let start = offset
  while (start < end && (buf[start] === 0x20 || buf[start] === 0x00)) start++
  // обрезаем хвостовые пробелы/NUL
  while (end > start && (buf[end - 1] === 0x20 || buf[end - 1] === 0x00)) end--
  let value = 0
  for (let i = start; i < end; i++) {
    const c = buf[i]!
    if (c === 0x00 || c === 0x20) break
    if (c < 0x30 || c > 0x37) throw new Error('errors.badTar')
    value = value * 8 + (c - 0x30)
  }
  return value
}

/** Прочитать C-строку из TAR-заголовка. */
function tarString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset
  const max = offset + length
  while (end < max && buf[end] !== 0x00) end++
  return new TextDecoder().decode(buf.subarray(offset, end))
}

export interface TarEntry {
  name: string
  size: number
  /** Смещение данных записи от начала tar-потока (для извлечения). */
  dataOffset: number
  typeflag: number
}

/** Нормализовать имя архива так, чтобы оно не могло выйти из корня выдачи. */
export function normalizeArchivePath(input: string): string {
  const parts: string[] = []
  for (const part of input.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/** Распарсить заголовки всех записей TAR-потока (без копирования данных). */
export function listTarEntries(data: Uint8Array): TarEntry[] {
  if (data.length < TAR_BLOCK || data.length % TAR_BLOCK !== 0)
    throw new Error('errors.badTar')

  const entries: TarEntry[] = []
  let offset = 0

  while (offset + TAR_BLOCK <= data.length) {
    const header = data.subarray(offset, offset + TAR_BLOCK)

    // два подряд нулевых блока = конец архива
    let allZero = true
    for (let i = 0; i < TAR_BLOCK; i++) {
      if (header[i] !== 0) { allZero = false; break }
    }
    if (allZero) break
    const name = tarString(header, 0, 100)
    const size = parseOctal(header, 124, 12)
    const typeflag = header[156] ?? 0x30 // '0' = обычный файл

    // префикс ustar (offset 345, 155 байт) — длинные пути
    const prefix = tarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name

    const dataStart = offset + TAR_BLOCK
    if (!Number.isSafeInteger(size) || dataStart + size > data.length)
      throw new Error('errors.badTar')
    // данные + паддинг до кратности 512
    offset = dataStart + size
    if (size % TAR_BLOCK !== 0)
      offset += TAR_BLOCK - (size % TAR_BLOCK)
    if (offset > data.length) throw new Error('errors.badTar')

    // в список попадают только обычные файлы (typeflag '0' и '\0') и симлинки пропускаем
    if (typeflag === 0x30 || typeflag === 0x00) {
      const safeName = normalizeArchivePath(fullName)
      if (safeName) {
        entries.push({ name: safeName, size, dataOffset: dataStart, typeflag })
      }
    }
  }

  return entries
}

/** Извлечь содержимое одной записи TAR. */
export function extractTarEntry(data: Uint8Array, entry: TarEntry): Uint8Array {
  return data.slice(entry.dataOffset, entry.dataOffset + entry.size)
}

/* ---------------- GZIP / Brotli обёртки ---------------- */

/** Распаковать GZIP (синхронно, fflate). */
export function gunzip(data: Uint8Array): Uint8Array {
  try {
    return gunzipSync(data)
  }
  catch {
    throw new Error('errors.badGzip')
  }
}

/**
 * Распаковать Brotli через нативный DecompressionStream.
 * Асинхронно, т.к. Streams API потоковый.
 * Браузеры принимают формат 'br', Node.js — 'brotli': пробуем оба.
 * Бросает errors.badBrotli / errors.noBrotli.
 */
export async function brotliDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('errors.noBrotli')

  // браузеры: 'br'; Node.js/vitest: 'brotli'
  const formatNames = ['br', 'brotli'] as const
  for (const format of formatNames) {
    try {
      const ds = new DecompressionStream(format as CompressionFormat)
      const reader = new Blob([data as BlobPart]).stream().pipeThrough(ds).getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        chunks.push(value)
      }
      const result = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
      return result
    }
    catch {
      // неверное имя формата или битые данные — пробуем следующее имя
    }
  }
  throw new Error('errors.badBrotli')
}

/* ---------------- единый API для студии ---------------- */

/** Распаковать контейнер до «внутреннего» содержимого (для tar.gz → tar, gz → файл, br → файл). */
export async function decompressArchive(data: Uint8Array, format: ArchiveFormat): Promise<Uint8Array> {
  switch (format) {
    case 'tar.gz':
    case 'gz':
      return gunzip(data)
    case 'br':
      return brotliDecompress(data)
    case 'lzma':
      return lzmaDecompress(data)
    case 'bzip2':
      return bzip2Decompress(data)
    case 'zstd':
      return zstdDecompress(data)
    case 'xz':
      return xzDecompress(data)
    case 'compress':
      return uncompress(data)
    default:
      return data
  }
}

/**
 * Список файлов в архиве любого поддерживаемого формата.
 * - ZIP/TAR — читаем напрямую
 * - TAR.GZ — сначала GZIP, потом TAR
 * - GZ/Brotli — одиночный файл: имя = имя архива без суффикса, размер = распакованный
 */
export async function listArchive(data: Uint8Array, fileName: string): Promise<{ format: ArchiveFormat, entries: ZipEntry[] }> {
  const format = detectArchiveFormat(data, fileName)
  const inner = await decompressArchive(data, format)

  if (format === 'zip') {
    return { format, entries: listZip(data) }
  }

  if (format === 'cab') return { format, entries: listCab(data) }
  if (format === 'cpio') return { format, entries: listCpio(data) }
  if (format === 'ar') return { format, entries: listAr(data) }
  if (format === 'iso') return { format, entries: listIso(data) }
  if (format === 'xar') return { format, entries: listXar(data) }
  if (format === 'partition') return { format, entries: listPartitionTable(data) }

  if (format === 'tar' || ((format === 'tar.gz' || format === 'lzma' || format === 'bzip2' || format === 'zstd' || format === 'xz') && isTar(inner))) {
    const entries = listTarEntries(inner).map(e => ({ name: e.name, size: e.size }))
    return { format: format === 'tar.gz' || format === 'lzma' || format === 'bzip2' || format === 'zstd' || format === 'xz' ? format : 'tar', entries }
  }

  // plain gzip или brotli — одиночный файл
  const baseName = fileName
    .replace(/\.(tar\.gz|tgz)$/i, '.tar')
    .replace(/\.(gz|br|lzma|lz|bz2|zst|xz|Z)$/i, '')
  return { format, entries: [{ name: baseName, size: inner.length }] }
}

/** Извлечь одну запись из архива (для кнопки ↓). Возвращает содержимое файла. */
export async function extractArchiveEntry(
  data: Uint8Array,
  fileName: string,
  entryName: string
): Promise<Uint8Array | null> {
  const format = detectArchiveFormat(data, fileName)
  const inner = await decompressArchive(data, format)

  if (format === 'zip') {
    try {
      const result = unzipSync(data, {
        filter: (file) => {
          if (file.name !== entryName) return false
          return true
        }
      })
      return result[entryName] ?? null
    }
    catch {
      return null
    }
  }

  if (format === 'cab') return extractCabEntry(data, entryName)
  if (format === 'cpio') return extractCpioEntry(data, entryName)
  if (format === 'ar') return extractArEntry(data, entryName)
  if (format === 'iso') return extractIsoEntry(data, entryName)
  if (format === 'xar') return extractXarEntry(data, entryName)
  if (format === 'partition') return extractPartition(data, entryName)

  if (format === 'tar' || ((format === 'tar.gz' || format === 'lzma' || format === 'bzip2' || format === 'zstd' || format === 'xz') && isTar(inner))) {
    const entry = listTarEntries(inner).find(e => e.name === entryName)
    return entry ? extractTarEntry(inner, entry) : null
  }

  // одиночный файл
  return inner
}

/* ---------------- ZIP (оставлено как было) ---------------- */

/**
 * List files in a ZIP (browser).
 * Возвращает массив { name, size } — без распаковки содержимого в UI,
 * просто перечисляем. Размер — распакованный (uncompressed).
 */
export function listZip(data: Uint8Array): ZipEntry[] {
  try {
    const result = unzipSync(data, {
      filter: () => true
    })
    const entries: ZipEntry[] = []
    for (const name of Object.keys(result)) {
      const u8 = result[name]
      if (u8) entries.push({ name, size: u8.length })
    }
    return entries
  }
  catch (error) {
    throw new Error('errors.badZip', { cause: error })
  }
}

/** Format bytes using the app's locale. */
export function formatZipSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
