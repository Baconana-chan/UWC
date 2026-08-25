import bzip2 from 'bzip2'

/** Распаковать BZIP2. */
export function bzip2Decompress(data: Uint8Array): Uint8Array {
  try {
    const bits = bzip2.array(data)
    const blockSize = bzip2.header(bits)
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const chunk = bzip2.decompress(bits, blockSize)
      if (chunk === -1) break
      total += chunk.length
      chunks.push(chunk)
    }
    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
    return result
  }
  catch (error) {
    throw new Error('errors.badBzip2', { cause: error })
  }
}
