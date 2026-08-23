/**
 * UWC — утилиты для работы с архивами в браузере (ZIP, TAR, TAR.GZ, GZIP, Brotli).
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

/** Один файл внутри архива. */
export interface ZipEntry {
  name: string
  size: number
}

/** Поддерживаемые форматы архивов. */
export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gz' | 'br'

/* ---------------- детект формата по магическим байтам ---------------- */

/** GZIP: 1f 8b */
function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
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
export function detectArchiveFormat(data: Uint8Array): ArchiveFormat {
  if (isZip(data)) return 'zip'
  if (isGzip(data)) {
    // TAR.GZ: после gunzip должен остаться tar — проверяем по имени/содержимому в detectArchive()
    return 'tar.gz'
  }
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
    // данные + паддинг до кратности 512
    offset = dataStart + size
    if (size % TAR_BLOCK !== 0)
      offset += TAR_BLOCK - (size % TAR_BLOCK)

    // в список попадают только обычные файлы (typeflag '0' и '\0') и симлинки пропускаем
    if (typeflag === 0x30 || typeflag === 0x00) {
      if (name) entries.push({ name: fullName, size, dataOffset: dataStart, typeflag })
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
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
      const buf = await new Response(stream).arrayBuffer()
      return new Uint8Array(buf)
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
  const format = detectArchiveFormat(data)
  const inner = await decompressArchive(data, format)

  if (format === 'zip') {
    return { format, entries: listZip(data) }
  }

  if (format === 'tar' || (format === 'tar.gz' && isTar(inner))) {
    const entries = listTarEntries(inner).map(e => ({ name: e.name, size: e.size }))
    return { format: format === 'tar.gz' ? 'tar.gz' : 'tar', entries }
  }

  // plain gzip или brotli — одиночный файл
  const baseName = fileName
    .replace(/\.(tar\.gz|tgz)$/i, '.tar')
    .replace(/\.(gz|br)$/i, '')
  return { format, entries: [{ name: baseName, size: inner.length }] }
}

/** Извлечь одну запись из архива (для кнопки ↓). Возвращает содержимое файла. */
export async function extractArchiveEntry(
  data: Uint8Array,
  fileName: string,
  entryName: string
): Promise<Uint8Array | null> {
  const format = detectArchiveFormat(data)
  const inner = await decompressArchive(data, format)

  if (format === 'zip') {
    const { unzip } = await import('fflate')
    return new Promise((resolve) => {
      unzip(data, (err, result) => {
        if (err) return resolve(null)
        resolve(result[entryName] ?? null)
      })
    })
  }

  if (format === 'tar' || (format === 'tar.gz' && isTar(inner))) {
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
    const result = unzipSync(data)
    const entries: ZipEntry[] = []
    for (const name of Object.keys(result)) {
      const u8 = result[name]
      if (u8) entries.push({ name, size: u8.length })
    }
    return entries
  }
  catch {
    throw new Error('errors.badZip')
  }
}

/** Format bytes using the app's locale. */
export function formatZipSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
