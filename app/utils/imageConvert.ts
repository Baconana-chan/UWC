import type { ImageFormatDef } from '#shared/registry/formats'

/**
 * Конвертация изображения в другой формат целиком в браузере:
 * createImageBitmap → canvas → toBlob. Сервер не участвует вообще.
 * Поддерживает источники: PNG, JPEG, WebP, GIF (первый кадр), SVG, BMP.
 */
export async function convertImageFile(file: File, target: ImageFormatDef, quality = 0.92): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  }
  catch {
    throw new Error('Браузер не смог открыть этот файл. Возможно, формат HEIC/TIFF — такие появятся на сервере (sharp).')
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D недоступен в этом браузере')

    ctx.drawImage(bitmap, 0, 0)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error(`Не удалось закодировать изображение в ${target.label}`))
      }, target.mime, quality)
    })
  }
  finally {
    bitmap.close()
  }
}

/**
 * Конвертация через сервер (POST /api/convert, multipart): AVIF/HEIC/TIFF/ICO
 * и любые цели, которые canvas не умеет. Ответ — бинарный файл.
 */
export async function convertImageOnServer(file: File, from: string, to: string): Promise<Blob> {
  const fd = new FormData()
  fd.append('from', from)
  fd.append('to', to)
  fd.append('file', file)
  const res = await fetch('/api/convert', { method: 'POST', body: fd })
  if (!res.ok) {
    let msg = 'studio.errors.convFailed'
    try {
      const data = await res.json()
      if (data?.message) msg = data.message
    }
    catch {
      // тело не JSON — оставляем дефолтный ключ
    }
    throw new Error(msg)
  }
  return await res.blob()
}

export function formatBytes(bytes: number, locale = 'en'): string {
  const units = locale.startsWith('ru') ? ['Б', 'КБ', 'МБ'] : ['B', 'KB', 'MB']
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} ${units[0]}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[1]}`
  return `${(bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[2]}`
}
