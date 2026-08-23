/**
 * heic-convert (CJS, без .d.ts) — декод HEIC через libheif WASM.
 * Используется только на сервере (server/utils/imageConverters.ts).
 */
declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: ArrayBuffer | Buffer
    format: 'JPEG' | 'PNG'
    quality?: number
    thumbnail?: { size: number }
  }
  interface HeicConvert {
    (opts: HeicConvertOptions): Promise<ArrayBuffer>
    all: (opts: HeicConvertOptions) => Promise<ArrayBuffer[]>
  }
  const convert: HeicConvert
  export default convert
}
