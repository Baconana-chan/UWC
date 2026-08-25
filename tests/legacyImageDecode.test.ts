import { describe, expect, it } from 'vitest'
import { decodeLegacyImage } from '../app/utils/legacyImageDecode'

const file = (data: Uint8Array | string, name: string) => new File([typeof data === 'string' ? data : data as BlobPart], name)

describe('legacy image formats', () => {
  it('decodes Netpbm P6', async () => {
    const image = await decodeLegacyImage(file(new Uint8Array([0x50, 0x36, 10, 49, 32, 49, 10, 50, 53, 53, 10, 255, 0, 0]), 'pixel.ppm'))
    expect([image?.width, image?.height, ...image!.pixels.slice(0, 4)]).toEqual([1, 1, 255, 0, 0, 255])
  })

  it('decodes XBM and WBMP', async () => {
    const xbm = await decodeLegacyImage(file('#define icon_width 1\n#define icon_height 1\nstatic char icon_bits[] = { 0x01 };', 'pixel.xbm'))
    expect(xbm?.pixels.slice(0, 4)).toEqual(new Uint8ClampedArray([0, 0, 0, 255]))
    const wbmp = await decodeLegacyImage(file(new Uint8Array([0, 0, 1, 1, 0x80]), 'pixel.wbmp'))
    expect(wbmp?.pixels.slice(0, 4)).toEqual(new Uint8ClampedArray([0, 0, 0, 255]))
  })

  it('decodes raw TGA and PCX RLE', async () => {
    const tga = new Uint8Array(18 + 3); tga[2] = 2; tga[12] = 1; tga[14] = 1; tga[16] = 24; tga[17] = 0x20; tga.set([0, 0, 255], 18)
    const tgaImage = await decodeLegacyImage(file(tga, 'pixel.tga'))
    expect(tgaImage?.pixels.slice(0, 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    const pcx = new Uint8Array(128 + 2); pcx[0] = 10; pcx[2] = 1; pcx[3] = 8; pcx[8] = 0; pcx[10] = 0; pcx[65] = 1; pcx[66] = 1; pcx.set([0xc1, 5], 128)
    const pcxImage = await decodeLegacyImage(file(pcx, 'pixel.pcx'))
    expect(pcxImage?.pixels.slice(0, 4)).toEqual(new Uint8ClampedArray([5, 5, 5, 255]))
  })
})
