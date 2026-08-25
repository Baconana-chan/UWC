import { describe, expect, it } from 'vitest'
import { extractArchiveEntry, listArchive } from '../app/utils/zipUtils'

describe('XAR / GPT / MBR', () => {
  it('читает XAR TOC и извлекает файл из data heap', async () => {
    const { zlibSync } = await import('fflate')
    const xml = '<xar><toc><file><name>hello.txt</name><data><offset>0</offset><length>5</length></data></file></toc></xar>'
    const toc = new TextEncoder().encode(xml)
    const compressed = zlibSync(toc)
    const data = new Uint8Array(28 + compressed.length + 5)
    data.set([0x78, 0x61, 0x72, 0x21], 0)
    const view = new DataView(data.buffer)
    view.setUint16(4, 28, false)
    view.setUint16(6, 1, false)
    view.setBigUint64(8, BigInt(compressed.length), false)
    view.setBigUint64(16, BigInt(toc.length), false)
    data.set(compressed, 28)
    data.set(new TextEncoder().encode('hello'), 28 + compressed.length)
    const listed = await listArchive(data, 'hello.xar')
    expect(listed.format).toBe('xar')
    expect(listed.entries).toEqual([{ name: 'hello.txt', size: 5 }])
    const extracted = await extractArchiveEntry(data, 'hello.xar', 'hello.txt')
    expect(new TextDecoder().decode(extracted!)).toBe('hello')
  })

  it('читает MBR partition table', async () => {
    const data = new Uint8Array(1024)
    data[510] = 0x55; data[511] = 0xaa
    data[446 + 4] = 0x83
    const view = new DataView(data.buffer)
    view.setUint32(446 + 8, 1, true)
    view.setUint32(446 + 12, 1, true)
    const listed = await listArchive(data, 'disk.img')
    expect(listed.format).toBe('partition')
    expect(listed.entries[0]?.size).toBe(512)
  })
})
