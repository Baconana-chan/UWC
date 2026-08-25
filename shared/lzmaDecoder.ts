// lzma-js публикует декодер как legacy browser scripts, поэтому адаптер
// собирает его в изолированный объект без загрязнения globalThis.
import decoderSource from 'lzma-js/src/lzma.js?raw'
import shimSource from 'lzma-js/src/lzma.shim.js?raw'


interface LzmaOutput {
  size: number
  writeBytes: (buffer: Uint8Array, size: number) => void
  toUint8Array: () => Uint8Array
}

interface LzmaApi {
  iStream: new (buffer: ArrayBuffer) => unknown
  oStream: new () => LzmaOutput
  decompressFile: (input: unknown, output?: LzmaOutput) => LzmaOutput
}

let api: LzmaApi | undefined

function getLzma(): LzmaApi {
  if (!api) {
    const factory = new Function(`${decoderSource}\n${shimSource}\nreturn LZMA`) as () => LzmaApi
    api = factory()
  }
  return api
}

/** Распаковать .lzma (alone format). */
export function lzmaDecompress(data: Uint8Array): Uint8Array {
  if (data.length < 13) throw new Error('errors.badLzma')
  try {
    const lzma = getLzma()
    const output = new lzma.oStream()
    const input = new lzma.iStream(data.slice().buffer)
    return lzma.decompressFile(input, output).toUint8Array()
  }
  catch (error) {
    throw new Error('errors.badLzma', { cause: error })
  }
}
