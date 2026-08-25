import { describe, expect, it } from 'vitest'
import {
  detectArchiveFormat,
  extractArchiveEntry,
  extractTarEntry,
  formatZipSize,
  listArchive,
  listTarEntries,
  listZip,
  normalizeArchivePath
} from '../app/utils/zipUtils'
import { lzmaDecompress } from '../shared/lzmaDecoder'
import { bzip2Decompress } from '../shared/bzip2Decoder'
import { zstdDecompress } from '../shared/zstdDecoder'
import { xzDecompress } from '../shared/xzDecoder'

/** Собрать минимальный ustar-TAR в памяти (512-байтовые блоки). */
function makeTar(files: { name: string, content: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const blocks: Uint8Array[] = []

  for (const f of files) {
    const header = new Uint8Array(512)
    const nameBytes = enc.encode(f.name)
    header.set(nameBytes.subarray(0, 100), 0)
    header.set(enc.encode('0000644'), 100) // mode
    header.set(enc.encode('0000000'), 108) // uid
    header.set(enc.encode('0000000'), 116) // gid
    header.set(enc.encode(f.content.length.toString(8).padStart(11, '0')), 124) // size
    header.set(enc.encode('00000000000'), 136) // mtime
    header.set(enc.encode('        '), 148) // checksum placeholder
    header[156] = 0x30 // typeflag '0'
    header.set(enc.encode('ustar'), 257)
    header.set(enc.encode('00'), 263)
    // checksum: sum всех байтов заголовка с пробелами на месте checksum
    let sum = 0
    for (let i = 0; i < 512; i++) sum += header[i]!
    header.set(enc.encode(sum.toString(8).padStart(6, '0')), 148)
    header[154] = 0x00
    header[155] = 0x20

    blocks.push(header)
    const data = enc.encode(f.content)
    blocks.push(data)
    // паддинг до кратности 512
    const pad = (512 - (data.length % 512)) % 512
    if (pad > 0) blocks.push(new Uint8Array(pad))
  }

  blocks.push(new Uint8Array(1024)) // два нулевых блока — конец архива

  const total = blocks.reduce((acc, b) => acc + b.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const b of blocks) {
    out.set(b, offset)
    offset += b.length
  }
  return out
}

function makeNewc(name: string, content: string): Uint8Array {
  const enc = new TextEncoder()
  const body = enc.encode(content)
  const fileName = enc.encode(`${name}\0`)
  const fields = [
    '070701', '00000001', '000081a4', '00000000', '00000000', '00000001', '00000000',
    body.length.toString(16).padStart(8, '0'), '00000000', '00000000', '00000000', '00000000',
    fileName.length.toString(16).padStart(8, '0'), '00000000'
  ].join('')
  const header = enc.encode(fields)
  const trailer = enc.encode('070701' + '00000000'.repeat(11) + '0000000b' + '00000000')
  const pad = (n: number) => new Uint8Array((4 - (n % 4)) % 4)
  return new Uint8Array([...header, ...fileName, ...pad(header.length + fileName.length), ...body, ...pad(body.length), ...trailer, ...new Uint8Array(110)])
}

function makeAr(name: string, content: string): Uint8Array {
  const enc = new TextEncoder()
  const body = enc.encode(content)
  const header = enc.encode(`${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${body.length.toString().padEnd(10)}\x60\n`)
  return new Uint8Array([...enc.encode('!<arch>\n'), ...header, ...body, ...(body.length & 1 ? [0] : [])])
}

function makeIso(): Uint8Array {
  const enc = new TextEncoder()
  const image = new Uint8Array(22 * 2048)
  const pvd = 16 * 2048
  image[pvd] = 1; image.set(enc.encode('CD001'), pvd + 1); image[pvd + 6] = 1
  const view = new DataView(image.buffer)
  view.setUint32(pvd + 80, 22, true); view.setUint32(pvd + 84, 22, false)
  view.setUint16(pvd + 128, 2048, true); view.setUint16(pvd + 130, 2048, false)
  const record = (at: number, extent: number, size: number, flags: number, name: number[] | Uint8Array) => {
    const bytes = name instanceof Uint8Array ? name : Uint8Array.from(name)
    const length = 33 + bytes.length + (bytes.length & 1 ? 0 : 1)
    image[at] = length; image[at + 1] = 0
    view.setUint32(at + 2, extent, true); view.setUint32(at + 6, extent, false)
    view.setUint32(at + 10, size, true); view.setUint32(at + 14, size, false)
    image[at + 25] = flags; image[at + 32] = bytes.length; image.set(bytes, at + 33)
  }
  record(pvd + 156, 20, 2048, 2, [0])
  record(20 * 2048, 20, 2048, 2, [0])
  record(20 * 2048 + 34, 20, 2048, 2, [1])
  record(20 * 2048 + 68, 21, 5, 0, enc.encode('hello'))
  image.set(enc.encode('hello'), 21 * 2048)
  return image
}

describe('zipUtils (фаза 2: ZIP-архивы)', () => {
  // создаём ZIP в памяти через fflate и проверяем listZip
  it('listZip извлекает имена и размеры файлов из ZIP', async () => {
    const { zipSync } = await import('fflate')
    const zipBuf = zipSync({
      'hello.txt': new TextEncoder().encode('Hello, ZIP!'),
      'data/values.json': new TextEncoder().encode('{"k":1}')
    })

    const entries = listZip(zipBuf)
    expect(entries.length).toBe(2)
    expect(entries.map((e) => e.name).sort()).toEqual(['data/values.json', 'hello.txt'])
    expect(entries.find((e) => e.name === 'hello.txt')?.size).toBe(11)
  })

  it('listZip бросает ошибку на не-ZIP данные', () => {
    expect(() => listZip(new Uint8Array([0x00, 0x01, 0x02]))).toThrow()
  })

})

describe('TAR (ручной парсер, 512-байтовые блоки)', () => {
  it('listTarEntries читает имена и размеры', () => {
    const tar = makeTar([
      { name: 'a.txt', content: 'hello tar' },
      { name: 'dir/b.bin', content: 'x'.repeat(1500) } // не кратна 512 — проверяем паддинг
    ])
    const entries = listTarEntries(tar)
    expect(entries.length).toBe(2)
    expect(entries[0]).toMatchObject({ name: 'a.txt', size: 9 })
    expect(entries[1]).toMatchObject({ name: 'dir/b.bin', size: 1500 })
  })

  it('нормализует TAR path traversal перед выдачей', () => {
    expect(normalizeArchivePath('../../etc/passwd')).toBe('etc/passwd')
    expect(normalizeArchivePath('..\\..\\tmp\\out.txt')).toBe('tmp/out.txt')
    const entries = listTarEntries(makeTar([{ name: '../../escape.txt', content: 'safe' }]))
    expect(entries[0]?.name).toBe('escape.txt')
  })

  it('extractTarEntry возвращает содержимое записи', () => {
    const tar = makeTar([{ name: 'a.txt', content: 'hello tar' }])
    const [entry] = listTarEntries(tar)
    expect(new TextDecoder().decode(extractTarEntry(tar, entry!))).toBe('hello tar')
  })

  it('detectArchiveFormat распознаёт tar по ustar-магии', () => {
    const tar = makeTar([{ name: 'x', content: 'y' }])
    expect(detectArchiveFormat(tar)).toBe('tar')
  })

  it('listArchive для TAR', async () => {
    const tar = makeTar([
      { name: 'one.txt', content: 'first' },
      { name: 'two.txt', content: 'second file' }
    ])
    const { format, entries } = await listArchive(tar, 'one.tar')
    expect(format).toBe('tar')
    expect(entries.map((e) => e.name)).toEqual(['one.txt', 'two.txt'])
    expect(entries[1]?.size).toBe(11)
  })
})

describe('GZIP / TAR.GZ (fflate gunzipSync)', () => {
  it('listArchive распаковывает .tar.gz и показывает содержимое', async () => {
    const { gzipSync } = await import('fflate')
    const tar = makeTar([{ name: 'inner/data.txt', content: 'gzipped tar' }])
    const tgz = gzipSync(tar)

    expect(detectArchiveFormat(tgz)).toBe('tar.gz')
    const { format, entries } = await listArchive(tgz, 'archive.tar.gz')
    expect(format).toBe('tar.gz')
    expect(entries).toEqual([{ name: 'inner/data.txt', size: 11 }])
  })

  it('listArchive распаковывает .tgz', async () => {
    const { gzipSync } = await import('fflate')
    const tgz = gzipSync(makeTar([{ name: 'f.txt', content: 'tgz' }]))
    const { entries } = await listArchive(tgz, 'arch.tgz')
    expect(entries).toEqual([{ name: 'f.txt', size: 3 }])
  })

  it('listArchive для plain .gz возвращает одиночный файл без расширения', async () => {
    const { gzipSync } = await import('fflate')
    const gz = gzipSync(new TextEncoder().encode('plain gzip content'))
    expect(detectArchiveFormat(gz)).toBe('tar.gz') // gzip-контейнер
    const { format, entries } = await listArchive(gz, 'notes.txt.gz')
    expect(format).toBe('tar.gz')
    expect(entries).toEqual([{ name: 'notes.txt', size: 18 }])
  })

  it('extractArchiveEntry достаёт файл из .tar.gz', async () => {
    const { gzipSync } = await import('fflate')
    const tgz = gzipSync(makeTar([
      { name: 'a.txt', content: 'AAA' },
      { name: 'b.txt', content: 'BBB' }
    ]))
    const out = await extractArchiveEntry(tgz, 'x.tar.gz', 'b.txt')
    expect(new TextDecoder().decode(out!)).toBe('BBB')
  })
})

describe('LZMA', () => {
  it('распаковывает raw .lzma и распознаёт расширение .lzma', async () => {
    const encoded = 'XQAAAAT//////////wAqGgiiA1a/7KzZLfzXNdjTjV8GuuwB9c92DQp9VC/RsSUUWEExrI/C0Okwe6///2PVgAA='
    const compressed = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    expect(new TextDecoder().decode(lzmaDecompress(compressed))).toContain('The world says hello world')
    const listed = await listArchive(compressed, 'hello-world.txt.lzma')
    expect(listed.format).toBe('lzma')
    expect(listed.entries[0]?.name).toBe('hello-world.txt')
  })
})

describe('BZIP2', () => {
  it('распаковывает raw .bz2 и распознаёт расширение .bz2', async () => {
    const encoded = 'QlpoOTFBWSZTWfzm0OYAAAUTgGAABAQ2RZ2gIAAxTTIxMTEM/RI8k2p+o9KUb9LV4z4mIIkhapOgc53GFNiBP3YdgtX+LuSKcKEh+c2hzA=='
    const compressed = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    expect(new TextDecoder().decode(bzip2Decompress(compressed))).toContain('The world says hello world to everybody on the world!')
    const listed = await listArchive(compressed, 'hello-world.txt.bz2')
    expect(listed.format).toBe('bzip2')
    expect(listed.entries[0]?.name).toBe('hello-world.txt')
  })
})

describe('Zstandard', () => {
  it('распаковывает .zst через zstd-codec WASM и распознаёт расширение', async () => {
    const encoded = 'KLUv/SAa0QAAenN0ZCBmaXh0dXJlOiDQv9GA0LjQstC10YI='
    const compressed = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    expect(new TextDecoder().decode(await zstdDecompress(compressed))).toBe('zstd fixture: привет')
    expect(detectArchiveFormat(compressed)).toBe('zstd')
    const listed = await listArchive(compressed, 'hello.txt.zst')
    expect(listed.format).toBe('zstd')
    expect(listed.entries).toEqual([{ name: 'hello.txt', size: 26 }])
  })

  it('перечисляет файлы внутри .tar.zst', async () => {
    const { ZstdCodec } = await import('zstd-codec')
    const tar = makeTar([{ name: 'inside.txt', content: 'inside zstd' }])
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      try {
        ZstdCodec.run((zstd) => {
          const output = new zstd.Simple().compress(tar)
          if (!output) reject(new Error('compression failed'))
          else resolve(output)
        })
      }
      catch (error) {
        reject(error)
      }
    })
    const listed = await listArchive(compressed, 'bundle.tar.zst')
    expect(listed.format).toBe('zstd')
    expect(listed.entries).toEqual([{ name: 'inside.txt', size: 11 }])
  })
})

describe('XZ', () => {
  it('распаковывает .xz через xzwasm WASM и распознаёт расширение', async () => {
    ;(globalThis as typeof globalThis & { self?: typeof globalThis }).self ??= globalThis
    const encoded = '/Td6WFoAAATm1rRGBMAcGCEBFgAAAAAAAAAAABrtH3YBABd4eiBmaXh0dXJlOiDQv9GA0LjQstC10YIA+05spzQq4dUAATgYhpF1JB+2830BAAAAAARZWg=='
    const compressed = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    expect(new TextDecoder().decode(await xzDecompress(compressed))).toBe('xz fixture: привет')
    expect(detectArchiveFormat(compressed)).toBe('xz')
    const listed = await listArchive(compressed, 'hello.txt.xz')
    expect(listed.format).toBe('xz')
    expect(listed.entries).toEqual([{ name: 'hello.txt', size: 24 }])
  })

  it('перечисляет файлы внутри .tar.xz', async () => {
    const encoded = '/Td6WFoAAATm1rRGBMBEgBAhARYAAAAAAAAAAMc8mz/gB/8APF0ANJuKzTYDgWXsdI4wxsvAbYfLoKUYa+j7WkHFRQsiJKXjVx+Py9Aa09vjyYACUI1eT8EsJCSsCr8NeEAAAAzSMz50wHGmAAFggBAAAACKPF4qscRn+wIAAAAABFla'
    const compressed = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    const listed = await listArchive(compressed, 'bundle.tar.xz')
    expect(listed.format).toBe('xz')
    expect(listed.entries).toEqual([{ name: 'inside.txt', size: 9 }])
  })
})

describe('CAB', () => {
  it('перечисляет и извлекает MSZIP-файл из CAB', async () => {
    const { deflateSync } = await import('fflate')
    const content = new TextEncoder().encode('CAB MSZIP fixture')
    const compressed = deflateSync(content)
    const name = new TextEncoder().encode('inside.txt')
    const filesOffset = 36 + 8
    const dataOffset = filesOffset + 16 + name.length + 1
    const blockSize = 8 + 2 + compressed.length
    const cab = new Uint8Array(dataOffset + blockSize)
    cab.set([0x4d, 0x53, 0x43, 0x46], 0)
    new DataView(cab.buffer).setUint32(8, cab.length, true)
    new DataView(cab.buffer).setUint32(16, filesOffset, true)
    new DataView(cab.buffer).setUint16(26, 1, true)
    new DataView(cab.buffer).setUint16(28, 1, true)
    new DataView(cab.buffer).setUint32(36, dataOffset, true)
    new DataView(cab.buffer).setUint16(40, 1, true)
    new DataView(cab.buffer).setUint16(42, 1, true)
    new DataView(cab.buffer).setUint32(filesOffset, content.length, true)
    cab.set(name, filesOffset + 16)
    const fileNameEnd = filesOffset + 16 + name.length
    cab[fileNameEnd] = 0
    const block = dataOffset
    new DataView(cab.buffer).setUint16(block + 4, compressed.length + 2, true)
    new DataView(cab.buffer).setUint16(block + 6, content.length, true)
    cab.set([0x43, 0x4b], block + 8)
    cab.set(compressed, block + 10)

    const listed = await listArchive(cab, 'fixture.cab')
    expect(listed.format).toBe('cab')
    expect(listed.entries).toEqual([{ name: 'inside.txt', size: content.length }])
    const extracted = await extractArchiveEntry(cab, 'fixture.cab', 'inside.txt')
    expect(new TextDecoder().decode(extracted!)).toBe('CAB MSZIP fixture')
  })
})

describe('CPIO / AR / Unix compress / ISO9660', () => {
  it('читает CPIO newc', async () => {
    const data = makeNewc('init.txt', 'cpio')
    const listed = await listArchive(data, 'initramfs.cpio')
    expect(listed.format).toBe('cpio')
    expect(listed.entries).toEqual([{ name: 'init.txt', size: 4 }])
  })

  it('читает AR и .deb как AR', async () => {
    const data = makeAr('debian-binary', '2.0\n')
    const listed = await listArchive(data, 'package.deb')
    expect(listed.format).toBe('ar')
    expect(listed.entries[0]).toEqual({ name: 'debian-binary', size: 4 })
  })

  it('распаковывает минимальный Unix compress/LZW-поток', async () => {
    const data = new Uint8Array([0x1f, 0x9d, 0x90, 0x20, 0x80]) // 9-bit code: ASCII A
    const listed = await listArchive(data, 'letter.txt.Z')
    expect(listed.format).toBe('compress')
    expect(listed.entries).toEqual([{ name: 'letter.txt', size: 1 }])
  })

  it('читает ISO9660-каталог и извлекает файл', async () => {
    const data = makeIso()
    const listed = await listArchive(data, 'disk.iso')
    expect(listed.format).toBe('iso')
    expect(listed.entries).toEqual([{ name: 'hello', size: 5 }])
    const extracted = await extractArchiveEntry(data, 'disk.iso', 'hello')
    expect(new TextDecoder().decode(extracted!)).toBe('hello')
  })
})

describe('Brotli (нативный DecompressionStream)', () => {
  it('brotli-данные детектируются как br', () => {
    // первый байт 0x21 — валидное WBITS для brotli-контейнера
    expect(detectArchiveFormat(new Uint8Array([0x21, 0x3c, 0x99]))).toBe('br')
  })

  it('мусор с «brotli-подобным» первым байтом даёт badBrotli, не badArchive', async () => {
    await expect(listArchive(new Uint8Array([0x21, 0x00, 0x00]), 'junk.br')).rejects.toThrow('errors.badBrotli')
  })

  it('распаковывает brotli через DecompressionStream, если он доступен', async () => {
    if (typeof DecompressionStream === 'undefined') return // окружение без Streams API — пропускаем

    const { CompressionStream } = globalThis as unknown as { CompressionStream?: typeof DecompressionStream }
    if (!CompressionStream) return

    const src = new TextEncoder().encode('brotli round trip')
    // Node.js называет формат 'brotli', браузеры — 'br'
    const formatName = (() => {
      try {
        new DecompressionStream('br' as CompressionFormat)
        return 'br' as CompressionFormat
      }
      catch {
        return 'brotli' as CompressionFormat
      }
    })()
    const cs = new CompressionStream(formatName)
    const compressed = new Uint8Array(
      await new Response(new Blob([src as BlobPart]).stream().pipeThrough(cs)).arrayBuffer()
    )

    const { format, entries } = await listArchive(compressed, 'file.txt.br')
    expect(format).toBe('br')
    expect(entries).toEqual([{ name: 'file.txt', size: src.length }])

    const out = await extractArchiveEntry(compressed, 'file.txt.br', 'file.txt')
    expect(new TextDecoder().decode(out!)).toBe('brotli round trip')
  })
})

describe('общие ошибки и утилиты', () => {
  it('listArchive бросает errors.badArchive на неизвестный формат', async () => {
    await expect(listArchive(new Uint8Array([0x00, 0x01, 0x02, 0x03]), 'junk.bin')).rejects.toThrow('errors.badArchive')
  })

  it('formatZipSize форматирует размеры', () => {
    expect(formatZipSize(512)).toBe('512 B')
    expect(formatZipSize(2048)).toBe('2.0 KB')
    expect(formatZipSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
