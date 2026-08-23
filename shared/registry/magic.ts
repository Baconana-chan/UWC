/**
 * Детект формата файла по магическим байтам — общий для клиента и сервера.
 *
 * Правило безопасности «загруженное = просто байты» (TODO.md, раздел 4):
 * сервер НЕ доверяет MIME/расширению от клиента — формат определяется по сигнатуре,
 * а файл с бинарной сигнатурой нельзя скормить текстовому конвертеру.
 */

export type SniffedFormat =
  | 'zip' | 'pdf' | 'png' | 'jpeg' | 'webp' | 'gif' | 'mp3' | 'wav'
  | 'avif' | 'heic' | 'tiff' | 'ico'
  | 'xml'
  | 'text'

const dec = new TextDecoder()

/** Определяет формат по первым байтам; всё нераспознанное — 'text'. */
export function sniffFormat(data: Uint8Array): SniffedFormat {
  if (data.length === 0) return 'text'
  const head = data.subarray(0, 16)
  const s = dec.decode(head)

  // бинарные сигнатуры
  if (data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07))
    return 'zip' // PK\x03\x04 (также пустые/span-архивы)
  if (s.startsWith('%PDF-')) return 'pdf'
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
    return 'png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'jpeg'
  if (s.startsWith('RIFF')) {
    if (s.slice(8, 12) === 'WEBP') return 'webp'
    if (s.slice(8, 12) === 'WAVE') return 'wav'
  }
  if (s.startsWith('GIF87a') || s.startsWith('GIF89a')) return 'gif'
  if (s.startsWith('ID3') || (data[0] === 0xff && (data[1] === 0xfb || data[1] === 0xf3 || data[1] === 0xf2)))
    return 'mp3' // ID3-тег или синхро-фрейм

  // TIFF: little-endian «II*\0» или big-endian «MM\0*»
  if (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00)
    return 'tiff'
  if (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a)
    return 'tiff'

  // ICO: reserved=0, type=1 (иконка), count>0 — всегда LE
  if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00)
    return 'ico'

  // ISO BMFF (HEIC/AVIF): box «ftyp» на offset 4, major brand на offset 8
  if (s.slice(4, 8) === 'ftyp') {
    const brand = s.slice(8, 12)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    // heic/heix/hevc/hevx/msf1/mif1 — iPhone и пр. (mif1 — общий HEIF, чаще HEIC)
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx' || brand === 'msf1' || brand === 'mif1')
      return 'heic'
  }

  // текстовые: XML/SVG
  const trimmed = s.replace(/^\uFEFF/, '').trimStart()
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) return 'xml'

  return 'text'
}

/** Сигнатуры, которые точно не являются текстом — таким файлам нельзя в текстовые конвертеры. */
const BINARY_SNIFFS: ReadonlySet<SniffedFormat> = new Set(['zip', 'pdf', 'png', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'avif', 'heic', 'tiff', 'ico'])

export function isBinarySniff(f: SniffedFormat): boolean {
  return BINARY_SNIFFS.has(f)
}
