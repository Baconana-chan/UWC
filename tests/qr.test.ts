import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

/**
 * Проверяем связку «qrcode → jsqr» без браузера: рендерим матрицу QRCode.create
 * в RGBA-пиксели (как это сделал бы canvas) и декодируем jsQR'ом.
 */

type QrImage = { data: Uint8ClampedArray; width: number; height: number }

function renderQr(qr: ReturnType<typeof QRCode.create>): QrImage {
  const size = qr.modules.size
  const scale = 4
  const dim = size * scale
  const data = new Uint8ClampedArray(dim * dim * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = qr.modules.get(x, y) ? 0 : 255
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y * scale + dy) * dim + (x * scale + dx)) * 4
          data[px] = v
          data[px + 1] = v
          data[px + 2] = v
          data[px + 3] = 255
        }
      }
    }
  }
  return { data, width: dim, height: dim }
}

function roundTrip(text: string): string | undefined {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { data, width, height } = renderQr(qr)
  return jsQR(data, width, height)?.data
}

describe('QR round-trip (qrcode.create + jsqr)', () => {
  it('декодирует URL обратно', () => {
    const text = 'https://example.com/uwc?from=ini&to=toml'
    expect(roundTrip(text)).toBe(text)
  })

  it('кириллица проходит без потерь', () => {
    const text = 'привет, UWC! Это ссылка: https://uwc.example/конвертер'
    expect(roundTrip(text)).toBe(text)
  })

  it('длинный текст (v40) декодируется', () => {
    const text = 'A'.repeat(900)
    expect(roundTrip(text)).toBe(text)
  })
})
