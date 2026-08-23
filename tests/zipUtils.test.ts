import { describe, expect, it } from 'vitest'
import {
  detectArchiveFormat,
  extractArchiveEntry,
  extractTarEntry,
  formatZipSize,
  listArchive,
  listTarEntries,
  listZip
} from '../app/utils/zipUtils'

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
