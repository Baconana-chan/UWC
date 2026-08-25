
/** Распаковать XZ-поток через browser/WASM-декодер xzwasm. */
export async function xzDecompress(data: Uint8Array): Promise<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    // xzwasm is browser-only and expects the global `self` while loading.
    const { XzReadableStream } = await import('xzwasm')
    const stream = new XzReadableStream(new Blob([data as BlobPart]).stream())
    reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      chunks.push(value)
    }

    const output = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    return output
  }
  catch (error) {
    throw new Error('errors.badXz', { cause: error })
  }
  finally {
    reader?.releaseLock()
  }
}
