import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { convertImage } from '../server/utils/imageConverters'

/** Тестовая картинка-источник: 8×6, полупрозрачный градиент. */
async function sourcePng(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 4,
      background: { r: 255, g: 0, b: 128, alpha: 0.5 }
    }
  }).png().toBuffer()
}

async function meta(buf: Buffer) {
  return await sharp(buf).metadata()
}

function buildIcoWithPng(png: Buffer): Buffer {
  const ico = Buffer.alloc(6 + 16 + png.length)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico[6] = 8
  ico[7] = 6
  ico[8] = 0
  ico[9] = 0
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(png.length, 14)
  ico.writeUInt32LE(22, 18)
  png.copy(ico, 22)
  return ico
}

/** BMP 2×2, 24 bpp, BI_RGB, bottom-up, с паддингом строк. */
function buildBmp(): Buffer {
  const W = 2
  const H = 2
  const row = W * 3
  const pad = (4 - (row % 4)) % 4
  const bmp = Buffer.alloc(54 + (row + pad) * H)
  bmp.write('BM', 0, 2)
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(W, 18)
  bmp.writeInt32LE(H, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(0, 30)
  bmp.writeUInt32LE((row + pad) * H, 34)
  bmp.writeInt32LE(2835, 38)
  bmp.writeInt32LE(2835, 42)
  // пиксели (BGR): нижняя строка сначала — красный/зелёный, верхняя — синий/белый
  const px = (y: number, x: number, b: number, g: number, r: number) => {
    const off = 54 + (H - 1 - y) * (row + pad) + x * 3
    bmp[off] = b
    bmp[off + 1] = g
    bmp[off + 2] = r
  }
  px(0, 0, 0, 0, 255)
  px(0, 1, 0, 255, 0)
  px(1, 0, 255, 0, 0)
  px(1, 1, 255, 255, 255)
  return bmp
}

describe('convertImage (фаза 3, sharp + руки)', () => {
  it('png → avif и обратно (avif → png)', async () => {
    const avif = await convertImage(await sourcePng(), 'png', 'avif')
    const m = await meta(avif)
    expect(m.format).toBe('heif') // sharp отдаёт AVIF как heif
    expect([m.width, m.height]).toEqual([8, 6])

    const png = await convertImage(avif, 'avif', 'png')
    const back = await meta(png)
    expect(back.format).toBe('png')
    expect([back.width, back.height]).toEqual([8, 6])
  })

  it('png → tiff и tiff → png', async () => {
    const tiff = await convertImage(await sourcePng(), 'png', 'tiff')
    expect((await meta(tiff)).format).toBe('tiff')
    const png = await convertImage(tiff, 'tiff', 'png')
    expect((await meta(png)).format).toBe('png')
  })

  it('png → jpeg даёт непрозрачный JPEG (flatten)', async () => {
    const jpeg = await convertImage(await sourcePng(), 'png', 'jpeg')
    const m = await meta(jpeg)
    expect(m.format).toBe('jpeg')
    expect(m.hasAlpha).toBe(false)
  })

  it('svg → png', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="#0f0"/></svg>')
    const png = await convertImage(svg, 'svg', 'png')
    const m = await meta(png)
    expect(m.format).toBe('png')
    expect([m.width, m.height]).toEqual([10, 5])
  })

  it('gif → webp (анимированный источник — первый кадр)', async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).gif().toBuffer()
    const webp = await convertImage(gif, 'gif', 'webp')
    expect((await meta(webp)).format).toBe('webp')
  })

  it('ico → png (PNG-кадр внутри контейнера)', async () => {
    const ico = buildIcoWithPng(await sourcePng())
    const png = await convertImage(ico, 'ico', 'png')
    const m = await meta(png)
    expect(m.format).toBe('png')
    expect([m.width, m.height]).toEqual([8, 6])
  })

  it('png → ico и обратно (PNG-обёртка)', async () => {
    const ico = await convertImage(await sourcePng(), 'png', 'ico')
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1) // type = icon
    expect(ico.readUInt16LE(4)).toBe(1) // один кадр
    expect(ico[22]).toBe(0x89)          // PNG-магия на offset 22
    expect(ico[23]).toBe(0x50)

    const back = await convertImage(ico, 'ico', 'png')
    expect((await meta(back)).format).toBe('png')
  })

  it('bmp → png (рукописный декодер BI_RGB)', async () => {
    const png = await convertImage(buildBmp(), 'bmp', 'png')
    const m = await meta(png)
    expect(m.format).toBe('png')
    expect([m.width, m.height]).toEqual([2, 2])
  })

  it('ICO с BMP-кадром (DIB с удвоенной высотой) декодируется', async () => {
    // ICO-кадр: BITMAPINFOHEADER + XOR (32bpp) + AND-маска; высота ×2
    const W = 2
    const H = 2
    const dibH = H * 2
    const xor = W * 4 // 32 bpp, уже выровнен
    const andMask = Math.ceil(W / 32) * 4 * H
    const dib = Buffer.alloc(40 + xor * dibH + andMask)
    dib.writeUInt32LE(40, 0)
    dib.writeInt32LE(W, 4)
    dib.writeInt32LE(dibH, 8)
    dib.writeUInt16LE(1, 12)
    dib.writeUInt16LE(32, 14)
    dib.writeUInt32LE(0, 16) // BI_RGB
    // пиксели: BGRA, bottom-up (нижняя строка первой), 2 ряда подряд
    for (let y = 0; y < H; y++) {
      const rowOff = 40 + y * xor
      for (let x = 0; x < W; x++) {
        const p = rowOff + x * 4
        dib[p] = 255 // B
        dib[p + 1] = 0
        dib[p + 2] = 0
        dib[p + 3] = 255 // A
      }
    }
    const ico = Buffer.alloc(6 + 16 + dib.length)
    ico.writeUInt16LE(0, 0)
    ico.writeUInt16LE(1, 2)
    ico.writeUInt16LE(1, 4)
    ico[6] = W
    ico[7] = H
    ico.writeUInt16LE(1, 10)
    ico.writeUInt16LE(32, 12)
    ico.writeUInt32LE(dib.length, 14)
    ico.writeUInt32LE(22, 18)
    dib.copy(ico, 22)

    const png = await convertImage(ico, 'ico', 'png')
    const m = await meta(png)
    expect(m.format).toBe('png')
    expect([m.width, m.height]).toEqual([2, 2])
  })

  it('неизвестная цель — ошибка unknownPair', async () => {
    await expect(convertImage(await sourcePng(), 'png', 'heic')).rejects.toThrow('errors.unknownPair')
  })
})

// HEIC-фикстура лежит локально (tests/fixtures/sample.heic) — настоящий iPhone-HEIC.
const heicPath = join(import.meta.dirname, 'fixtures', 'sample.heic')
const hasHeic = existsSync(heicPath)

describe.skipIf(!hasHeic)('heic → * (libheif WASM)', () => {
  it('heic → jpeg и heic → png', async () => {
    const heic = readFileSync(heicPath)
    const jpeg = await convertImage(heic, 'heic', 'jpeg')
    const m = await meta(jpeg)
    expect(m.format).toBe('jpeg')
    expect(m.width).toBeGreaterThan(0)

    const png = await convertImage(heic, 'heic', 'png')
    expect((await meta(png)).format).toBe('png')
  })
})
