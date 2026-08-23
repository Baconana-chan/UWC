/**
 * QR-коды в браузере (фаза 1): генерация `qrcode`, декодирование `jsqr` по canvas.
 * Всё client-side — сервер не участвует и файлы никуда не уходят.
 */

import QRCode from 'qrcode'
import jsQR from 'jsqr'

const QR_SIZE = 512
/** не даём jsQR жевать мегапиксельные скриншоты — уменьшаем до разумного */
const MAX_DIM = 1600

/** Текст → PNG data URL (чёрные модули на прозрачном фоне). */
export async function generateQrPng(text: string, size = QR_SIZE): Promise<string> {
  return QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: 'M' })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('studio.qr.decodeFailed'))
    img.src = url
  })
}

/** QR-картинка → текст (jsQR по пикселям canvas). */
export async function decodeQrFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('studio.qr.decodeFailed')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(data, width, height)
    if (!result) throw new Error('studio.qr.decodeFailed')
    return result.data
  }
  finally {
    URL.revokeObjectURL(url)
  }
}
