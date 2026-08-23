/**
 * UWC — серверные конвертеры изображений (фаза 3, уровень C).
 *
 * sharp (libvips) покрывает PNG/JPEG/WebP/GIF/SVG/AVIF/TIFF. Три пробела
 * пребилда закрываем руками/библиотеками:
 *   - HEIC (декод) — в официальных пребилдах sharp нет libde265 (HEVC),
 *     «bad seek» на пиксельном декоде. Берём heic-convert (libheif WASM).
 *   - ICO — в libvips 8.18 пребилда нет вовсе. ICO = контейнер PNG или BMP
 *     (DIB): парсим заголовок, достаём лучший кадр, а запись — PNG-обёртка
 *     (поддерживается Vista+ всеми современными ОС).
 *   - BMP — sharp 0.35 пребилд тоже не умеет; свой декодер BI_RGB (24/32 bpp).
 *
 * Правила безопасности (TODO.md, раздел 4): вход — только байты, никаких путей
 * и имён от юзера; размер/таймаут гасятся в endpoint; concurrency = 1.
 */

import sharp from 'sharp'
import convert from 'heic-convert'

// libvips сам многопоточен — снаружи не даём ему съесть весь VPS.
sharp.concurrency(1)

/* ------------------------------------------------------------------ */
/* HEIC → PNG (libheif WASM; только декод, энкод HEVC не нужен/нет)    */
/* ------------------------------------------------------------------ */

async function decodeHeic(buffer: Buffer): Promise<Buffer> {
  const png = await convert({ buffer, format: 'PNG' })
  return Buffer.from(png as unknown as ArrayBuffer)
}

/* ------------------------------------------------------------------ */
/* BMP-декодер (BI_RGB, 24/32 bpp) — нужен и для standalone BMP,       */
/* и для ICO-кадров, где DIB хранятся с удвоенной высотой (XOR+AND).   */
/* ------------------------------------------------------------------ */

interface DecodedBmp {
  width: number
  height: number
  rgba: Buffer
}

function decodeBmp(dib: Uint8Array, heightDoubled: boolean): DecodedBmp {
  // standalone .bmp — с 14-байтовым BITMAPFILEHEADER («BM»), ICO-кадр — голый DIB
  const fileHeader = dib[0] === 0x42 && dib[1] === 0x4d ? 14 : 0
  const view = new DataView(dib.buffer, dib.byteOffset + fileHeader, dib.byteLength - fileHeader)
  if (dib.length - fileHeader < 40)
    throw new Error('errors.badBmp')
  const headerSize = view.getUint32(0, true)
  if (headerSize < 40)
    throw new Error('errors.badBmp') // только BITMAPINFOHEADER
  const widthRaw = view.getInt32(4, true)
  const heightRaw = view.getInt32(8, true)
  const bpp = view.getUint16(14, true)
  const compression = view.getUint32(16, true)
  if (compression !== 0 || (bpp !== 24 && bpp !== 32))
    throw new Error('errors.badBmp') // только несжатый BI_RGB

  const width = Math.abs(widthRaw)
  const height = Math.floor(Math.abs(heightRaw) / (heightDoubled ? 2 : 1))
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384)
    throw new Error('errors.badBmp')
  const topDown = heightRaw < 0
  const bytesPerPixel = bpp / 8
  const rowBytes = Math.ceil((width * bpp) / 32) * 4
  if (fileHeader + headerSize + rowBytes * (heightDoubled ? height * 2 : height) > dib.length)
    throw new Error('errors.badBmp')

  const rgba = Buffer.alloc(width * height * 4)
  const base = fileHeader + headerSize
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y
    const src = base + srcRow * rowBytes
    for (let x = 0; x < width; x++) {
      const p = src + x * bytesPerPixel
      const o = (y * width + x) * 4
      rgba[o] = dib[p + 2]!       // R (BGR порядок)
      rgba[o + 1] = dib[p + 1]!   // G
      rgba[o + 2] = dib[p]!       // B
      rgba[o + 3] = bpp === 32 ? (dib[p + 3] ?? 255) : 255
    }
  }
  return { width, height, rgba }
}

/* ------------------------------------------------------------------ */
/* ICO: контейнер PNG или BMP(DIB)                                     */
/* ------------------------------------------------------------------ */

interface IcoFrame {
  width: number
  height: number
  kind: 'png' | 'bmp'
  bytes: Uint8Array
}

/** Достаёт самый крупный (и цветной) кадр иконки. */
function parseIco(data: Uint8Array): IcoFrame {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 6 || view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1)
    throw new Error('errors.badIco')
  const count = view.getUint16(4, true)
  if (count === 0 || data.length < 6 + count * 16)
    throw new Error('errors.badIco')

  let best = -1
  let bestScore = 0
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    const w = view.getUint8(e) || 256
    const h = view.getUint8(e + 1) || 256
    const bitcount = view.getUint16(e + 6, true)
    const score = w * h * (bitcount || 32)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }

  const e = 6 + best * 16
  const size = view.getUint32(e + 8, true)
  const offset = view.getUint32(e + 12, true)
  if (offset + size > data.length)
    throw new Error('errors.badIco')
  const bytes = data.subarray(offset, offset + size)
  const kind: 'png' | 'bmp' = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : 'bmp'
  return { width: view.getUint8(e) || 256, height: view.getUint8(e + 1) || 256, kind, bytes }
}

/** Записывает ICO как PNG-кадр (Vista+; работает во всех современных ОС). */
function pngToIco(png: Buffer): Buffer {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const out = Buffer.alloc(6 + 16 + png.length)
  out.writeUInt16LE(0, 0) // reserved
  out.writeUInt16LE(1, 2) // type = icon
  out.writeUInt16LE(1, 4) // count
  out[6] = width >= 256 ? 0 : width
  out[7] = height >= 256 ? 0 : height
  out[8] = 0 // colors
  out[9] = 0 // reserved
  out.writeUInt16LE(1, 10)  // planes
  out.writeUInt16LE(32, 12) // bitcount
  out.writeUInt32LE(png.length, 14)
  out.writeUInt32LE(22, 18) // offset до PNG
  png.copy(out, 22)
  return out
}

/* ------------------------------------------------------------------ */
/* Основной пайплайн: байты in → байты out                             */
/* ------------------------------------------------------------------ */

export async function convertImage(input: Uint8Array, from: string, to: string): Promise<Buffer> {
  // 1) нормализуем вход в то, что умеет sharp
  let pipeline: sharp.Sharp
  if (from === 'heic') {
    pipeline = sharp(await decodeHeic(Buffer.from(input)))
  }
  else if (from === 'ico') {
    const frame = parseIco(input)
    if (frame.kind === 'png') {
      pipeline = sharp(Buffer.from(frame.bytes))
    }
    else {
      const bmp = decodeBmp(frame.bytes, true)
      pipeline = sharp(bmp.rgba, { raw: { width: bmp.width, height: bmp.height, channels: 4 } })
    }
  }
  else if (from === 'bmp') {
    const bmp = decodeBmp(Buffer.from(input), false)
    pipeline = sharp(bmp.rgba, { raw: { width: bmp.width, height: bmp.height, channels: 4 } })
  }
  else {
    pipeline = sharp(Buffer.from(input))
  }

  // 2) ICO-выход: PNG-кадр (классический лимит 256px, больше не надо)
  if (to === 'ico') {
    const png = await pipeline
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return pngToIco(png)
  }

  // JPEG не умеет прозрачность — белая подложка вместо чёрной
  if (to === 'jpeg')
    pipeline = pipeline.flatten({ background: '#ffffff' })

  switch (to) {
    case 'png':
      return pipeline.png().toBuffer()
    case 'jpeg':
      return pipeline.jpeg({ quality: 85 }).toBuffer()
    case 'webp':
      return pipeline.webp({ quality: 82 }).toBuffer()
    case 'avif':
      return pipeline.avif({ quality: 55 }).toBuffer()
    case 'tiff':
      return pipeline.tiff().toBuffer()
    default:
      throw new Error('errors.unknownPair')
  }
}
