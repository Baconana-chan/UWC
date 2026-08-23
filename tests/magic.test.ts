import { describe, expect, it } from 'vitest'
import { isBinarySniff, sniffFormat } from '../shared/registry/magic'

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s)
const arr = (...n: number[]) => new Uint8Array(n)

describe('sniffFormat', () => {
  it('определяет ZIP (PK\x03\x04, включая пустые и span-архивы)', () => {
    expect(sniffFormat(arr(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe('zip')
    expect(sniffFormat(arr(0x50, 0x4b, 0x05, 0x06))).toBe('zip')
    expect(sniffFormat(arr(0x50, 0x4b, 0x07, 0x08))).toBe('zip')
  })

  it('определяет PDF, PNG, JPEG, GIF, WebP, WAV, MP3', () => {
    expect(sniffFormat(bytes('%PDF-1.7\n'))).toBe('pdf')
    expect(sniffFormat(arr(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png')
    expect(sniffFormat(arr(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffFormat(bytes('GIF89a...'))).toBe('gif')
    expect(sniffFormat(bytes('RIFF\x00\x00\x00\x00WEBP'))).toBe('webp')
    expect(sniffFormat(bytes('RIFF\x00\x00\x00\x00WAVE'))).toBe('wav')
    expect(sniffFormat(bytes('ID3\x04\x00\x00\x00'))).toBe('mp3')
  })

  it('определяет TIFF (оба endian), ICO, AVIF и HEIC (ftyp-бренды)', () => {
    expect(sniffFormat(arr(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00))).toBe('tiff')
    expect(sniffFormat(arr(0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00))).toBe('tiff')
    expect(sniffFormat(arr(0x00, 0x00, 0x01, 0x00, 0x01, 0x00))).toBe('ico')
    expect(sniffFormat(bytes('\x00\x00\x00\x18ftypavif\x00\x00\x00\x00'))).toBe('avif')
    expect(sniffFormat(bytes('\x00\x00\x00\x18ftypavis\x00\x00\x00\x00'))).toBe('avif')
    expect(sniffFormat(bytes('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00'))).toBe('heic')
    expect(sniffFormat(bytes('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00'))).toBe('heic')
  })

  it('обычный текст и JSON — text', () => {
    expect(sniffFormat(enc.encode('hello world'))).toBe('text')
    expect(sniffFormat(enc.encode('{"a":1}'))).toBe('text')
    expect(sniffFormat(enc.encode('[server]\nport = 8080'))).toBe('text')
  })

  it('XML/SVG — xml (не бинарный)', () => {
    expect(sniffFormat(enc.encode('<?xml version="1.0"?><root/>'))).toBe('xml')
    expect(sniffFormat(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('xml')
  })

  it('пустой файл — text', () => {
    expect(sniffFormat(new Uint8Array(0))).toBe('text')
  })
})

describe('isBinarySniff', () => {
  it('бинарные сигнатуры помечает, текстовые — нет', () => {
    expect(isBinarySniff('zip')).toBe(true)
    expect(isBinarySniff('png')).toBe(true)
    expect(isBinarySniff('mp3')).toBe(true)
    expect(isBinarySniff('avif')).toBe(true)
    expect(isBinarySniff('heic')).toBe(true)
    expect(isBinarySniff('tiff')).toBe(true)
    expect(isBinarySniff('ico')).toBe(true)
    expect(isBinarySniff('xml')).toBe(false)
    expect(isBinarySniff('text')).toBe(false)
  })
})
