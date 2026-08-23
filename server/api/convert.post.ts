/**
 * POST /api/convert — единый endpoint конвертации (фаза 0).
 *
 * Вход: `{ from, to, text }` (JSON) или multipart с полями `from`, `to`, `file`.
 * Выход: текст — `{ output }`, бинарный формат (фаза 2+) — файл с content-disposition.
 *
 * Правила безопасности раздела 4 (TODO.md): лимит размера ДО чтения тела,
 * таймаут, from/to — только id из серверного реестра, файлы проверяются
 * по магическим байтам (бинарную сигнатуру не кормим текстовому конвертеру).
 */

import { isBinarySniff, sniffFormat } from '../../shared/registry/magic'
import { getServerConverter } from '../utils/registry'

function runWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(createError({ statusCode: 504, statusMessage: 'Timeout', message: 'errors.timeout' })),
      ms
    )
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const maxBytes = Number(config.maxInputMb) * 1024 * 1024
  const timeoutMs = Number(config.convertTimeoutMs)

  // 1) грубый лимит по заголовку — до того, как тело окажется в памяти
  const contentLength = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (contentLength > maxBytes)
    throw createError({ statusCode: 413, message: 'errors.tooLarge' })

  const contentType = getRequestHeader(event, 'content-type') ?? ''
  const isMultipart = contentType.startsWith('multipart/form-data')

  let from: string | undefined
  let to: string | undefined
  let inputText: string | undefined
  let inputBytes: Uint8Array | undefined
  let sniffed: ReturnType<typeof sniffFormat> | undefined

  if (isMultipart) {
    const parts = await readMultipartFormData(event)
    if (!parts || parts.length === 0)
      throw createError({ statusCode: 400, message: 'errors.noInput' })
    for (const part of parts) {
      if (part.name === 'from') from = part.data.toString('utf-8').trim()
      else if (part.name === 'to') to = part.data.toString('utf-8').trim()
      else if (part.name === 'file') {
        if (part.data.length > maxBytes)
          throw createError({ statusCode: 413, message: 'errors.tooLarge' })
        sniffed = sniffFormat(new Uint8Array(part.data))
        inputBytes = new Uint8Array(part.data)
        inputText = part.data.toString('utf-8')
      }
    }
  }
  else {
    const body = await readBody<{ from?: string; to?: string; text?: string }>(event)
    from = body?.from
    to = body?.to
    inputText = body?.text
  }

  if (!from || !to)
    throw createError({ statusCode: 400, message: 'errors.noInput' })

  // белый список: from/to — только зарегистрированные пары
  const conv = getServerConverter(from, to)
  if (!conv)
    throw createError({ statusCode: 400, message: 'errors.unknownPair' })

  // «загруженное = просто байты»: бинарная сигнатура — отказ текстовому конвертеру.
  // Для бинарных конвертеров (картинки) снафф — только подсказка: формат
  // валидирует сам sharp, а лимиты размера/таймаут уже применены выше.
  if (conv.inputKind === 'text') {
    if (inputText == null)
      throw createError({ statusCode: 400, message: 'errors.noInput' })
    if (sniffed && isBinarySniff(sniffed))
      throw createError({ statusCode: 400, message: 'errors.binaryFile' })
    if (Buffer.byteLength(inputText, 'utf-8') > maxBytes)
      throw createError({ statusCode: 413, message: 'errors.tooLarge' })
  }
  else if (inputBytes == null) {
    throw createError({ statusCode: 400, message: 'errors.noInput' })
  }

  const output = await runWithTimeout(
    Promise.resolve(conv.handler(conv.inputKind === 'binary' ? inputBytes! : inputText!)),
    timeoutMs
  ).catch((e) => {
    // уже h3-ошибка (таймаут) — пробрасываем как есть
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    throw createError({ statusCode: 400, message: e instanceof Error ? e.message : 'errors.convFailed' })
  })

  if (typeof output === 'string')
    return { output }

  // бинарный вывод: файл с attachment, а не «живой» ответ
  setResponseHeader(event, 'content-type', conv.mime)
  setResponseHeader(event, 'content-disposition', `attachment; filename="uwc-${conv.id}.${conv.ext}"`)
  return Buffer.from(output)
})
