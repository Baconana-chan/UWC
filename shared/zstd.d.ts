declare module 'zstd-codec' {
  export interface ZstdSimple {
    decompress(data: Uint8Array): Uint8Array | null
  }

  export interface ZstdGeneric {
    contentSize(data: Uint8Array): number | null
  }

  export interface ZstdApi {
    Simple: new () => ZstdSimple
    Generic: new () => ZstdGeneric
  }

  export const ZstdCodec: {
    run(callback: (zstd: ZstdApi) => void): void
  }
}
