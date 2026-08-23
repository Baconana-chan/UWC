/**
 * UWC — composable: server-side text converters.
 *
 * Стидия fetchit /api/formats при старте и кэширует список серверных конвертеров.
 * Если клиентский конвертер для пары (from, to) недоступен, а серверный есть —
 * текст уходит на сервер через POST /api/convert.
 *
 * Клиентские конвертеры (уровень A) работают без сети — сервер запрашивается
 * только для тех пар, которые реализованы только на сервере (уровень B).
 */

const SERVER_FORMATS_URL = '/api/formats'

/** Метаданные серверных конвертеров (без handler, чтобы не держать в памяти). */
export interface ServerConverterInfo {
  id: string
  from: string
  to: string
  tier: 'b' | 'c'
  inputKind: 'text' | 'binary'
}

let _cache: ServerConverterInfo[] | null = null
let _promise: Promise<ServerConverterInfo[]> | null = null

/** Запрашивает список серверных конвертеров (с кэшированием на сессию). */
export async function fetchServerFormats(): Promise<ServerConverterInfo[]> {
  if (_cache) return _cache
  if (_promise) return _promise
  _promise = $fetch<{ converters: ServerConverterInfo[] }>(SERVER_FORMATS_URL)
    .then((data) => {
      _cache = data.converters
      return _cache
    })
    .catch(() => {
      _promise = null
      return []
    })
  return _promise
}

/** true, если сервер имеет текстовый конвертер для пары (from, to). */
export async function hasServerConverter(from: string, to: string): Promise<boolean> {
  const formats = await fetchServerFormats()
  return formats.some((c) => c.from === from && c.to === to && c.inputKind === 'text')
}

/** true, если серверный конвертер — для текста (не бинарный). */
export function isServerTextConverter(conv: ServerConverterInfo): boolean {
  return conv.inputKind === 'text'
}

/** Отправка текста на серверный конвертер (POST /api/convert). */
export async function convertTextOnServer(from: string, to: string, text: string): Promise<string> {
  const res = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, text })
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message || 'errors.convFailed')
  }
  const data = await res.json()
  return data.output
}
