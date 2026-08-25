import { ZstdCodec } from 'zstd-codec'

let zstdPromise: Promise<{
  Simple: new () => { decompress(data: Uint8Array): Uint8Array | null }
  Generic: new () => { contentSize(data: Uint8Array): number | null }
}> | undefined

function getZstd() {
  zstdPromise ??= new Promise((resolve, reject) => {
    try {
      ZstdCodec.run(resolve)
    }
    catch (error) {
      reject(error)
    }
  })
  return zstdPromise
}

/** Распаковать Zstandard frame в браузере через WASM. */
export async function zstdDecompress(data: Uint8Array): Promise<Uint8Array> {
  try {
    const zstd = await getZstd()
    const output = new zstd.Simple().decompress(data)
    if (!output) throw new Error('invalid zstd frame')
    return output
  }
  catch (error) {
    throw new Error('errors.badZstd', { cause: error })
  }
}
