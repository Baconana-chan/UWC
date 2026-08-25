// lzma-js публикует декодер как legacy browser scripts без точки входа,
// поэтому раньше он подтягивался через import '?raw' + new Function.
// Серверная сборка Nitro не поддерживает '?raw' для файлов из node_modules,
// так что оба скрипта вендорены в ./lzmaCore.js (один IIFE-модуль, без eval).
import LZMA from './lzmaCore'

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

const api = LZMA as unknown as LzmaApi

/** Распаковать .lzma (alone format). */
export function lzmaDecompress(data: Uint8Array): Uint8Array {
  if (data.length < 13) throw new Error('errors.badLzma')
  try {
    const output = new api.oStream()
    const input = new api.iStream(data.slice().buffer)
    return api.decompressFile(input, output).toUint8Array()
  }
  catch (error) {
    throw new Error('errors.badLzma', { cause: error })
  }
}
