declare module 'bzip2' {
  interface Bzip2Decoder {
    array(bytes: Uint8Array): (bits: number) => number
    header(bits: (bits: number) => number): number
    decompress(bits: (bits: number) => number, blockSize: number, length?: number): Uint8Array | -1
  }
  const decoder: Bzip2Decoder
  export default decoder
}
