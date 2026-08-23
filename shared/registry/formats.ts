/**
 * UWC — общий реестр форматов и клиентских конвертеров.
 *
 * Этот модуль живёт в `shared/` и доступен и на клиенте, и на сервере (Nitro).
 * Текстовые конвертеры — чистые функции, ничего не тянут за собой,
 * поэтому их можно вызывать прямо в браузере: сервер не участвует.
 *
 * ВАЖНО: реестр языконезависим. Человекочитаемые строки живут в
 * `i18n/locales/*.json` и резолвятся в компонентах по ключам:
 *   - группы:      t(`groups.${group.id}.label`)
 *   - конвертеры:  t(`conv.${id}.from` | `.to` | `.description`)
 *   - категории:   t(`cats.${cat.id}.title` | `.description`)
 *   - ошибки:      выбрасываются как ключи (например `errors.badHex`),
 *                  компонент делает t(message)
 */

import { parseDelimited, serializeDelimited } from './delimited'
import { IR_FORMATS } from './irFormats'
import { makeIrPair, isPlainObject, type IrFormat } from './ir'

export type TranslateFn = (key: string) => string

/* ------------------------------------------------------------------ */
/* Текстовые конвертеры (уровень A — выполняются в браузере)           */
/* ------------------------------------------------------------------ */

export type ConverterGroupId = 'case' | 'encoding' | 'json' | 'string' | 'fun' | 'markup'

export interface TextConverter {
  /** Уникальный id, используется как value в селекте и как ключ в i18n */
  id: string
  icon: string
  /** id обратного преобразования (для кнопки swap) */
  reverseId?: string
  run: (input: string) => string | Promise<string>
  /**
   * Локализованный вариант run — нужен конвертерам, чей вывод содержит текст
   * (например «Статистика»). Получает функцию перевода и резолвит строки сам.
   */
  runL?: (input: string, t: TranslateFn) => string | Promise<string>
}

export interface ConverterGroup {
  id: ConverterGroupId
  items: TextConverter[]
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '').replace(/^0x/i, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('errors.badHex')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function wordsOf(input: string): string[] {
  return input.split(/[^a-zA-Zа-яА-ЯёЁ0-9]+/).filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Хелперы для конвертеров уровня A                                    */
/* ------------------------------------------------------------------ */

/** MD5 (RFC 1321) — чистый JS, ~40 строк. WebCrypto MD5 не умеет. */
export function md5Digest(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64)
  padded.set(bytes)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(len / 2 ** 29), true)

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ]
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let off = 0; off < padded.length; off += 64) {
    const M = new Array<number>(16)
    for (let i = 0; i < 16; i++)
      M[i] = view.getUint32(off + i * 4, true)

    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      }
      else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      }
      else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      }
      else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const k = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
      f = (f + a + k + M[g]!) >>> 0
      a = d
      d = c
      c = b
      b = (b + ((f << S[i]!) | (f >>> (32 - S[i]!)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  // дайджест — слова в little-endian (байты каждого слова развёрнуты)
  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return out
}

function md5Hex(bytes: Uint8Array): string {
  return bytesToHex(md5Digest(bytes))
}

/** SHA-1 (FIPS 180-4) — чистый JS, нужен генератору UUID v5 (WebCrypto асинхронный). */
export function sha1Digest(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64)
  padded.set(bytes)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  // длина в битах — 64-битное BIG-endian поле
  view.setUint32(padded.length - 8, Math.floor(len / 2 ** 29), false)
  view.setUint32(padded.length - 4, (len * 8) >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  for (let off = 0; off < padded.length; off += 64) {
    const w = new Array<number>(80)
    for (let i = 0; i < 16; i++)
      w[i] = view.getUint32(off + i * 4, false)
    for (let i = 16; i < 80; i++) {
      const t = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!
      w[i] = ((t << 1) | (t >>> 31)) >>> 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      }
      else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      }
      else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      }
      else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const v = new DataView(out.buffer)
  v.setUint32(0, h0, false)
  v.setUint32(4, h1, false)
  v.setUint32(8, h2, false)
  v.setUint32(12, h3, false)
  v.setUint32(16, h4, false)
  return out
}

function jsonToJsonp(s: string): string {
  const json = s.trim()
  JSON.parse(json) // валидируем
  return `callback(${json})`
}

function jsonpToJson(s: string): string {
  const trimmed = s.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim()
  const open = trimmed.indexOf('(')
  const close = trimmed.lastIndexOf(')')
  if (open === -1 || close === -1 || close < open)
    throw new Error('errors.badJsonp')
  const inner = trimmed.slice(open + 1, close).trim()
  JSON.parse(inner) // валидируем
  return inner
}

/** Markdown ↔ HTML через Tiptap (@tiptap/markdown). Тянется лениво, только при вызове. */
async function mdToHtml(md: string): Promise<string> {
  const { Editor } = await import('@tiptap/core')
  const { default: StarterKit } = await import('@tiptap/starter-kit')
  const { Markdown } = await import('@tiptap/markdown')
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Markdown]
  })
  try {
    // Markdown-команда парсит контент только при явном contentType
    await editor.commands.setContent(md, { contentType: 'markdown' } as never)
    return editor.getHTML()
  }
  finally {
    editor.destroy()
  }
}

async function htmlToMd(html: string): Promise<string> {
  const { Editor } = await import('@tiptap/core')
  const { default: StarterKit } = await import('@tiptap/starter-kit')
  const { Markdown } = await import('@tiptap/markdown')
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Markdown]
  })
  try {
    await editor.commands.setContent(html)
    return editor.getMarkdown()
  }
  finally {
    editor.destroy()
  }
}

function capitalize(word: string): string {
  return word.length ? word[0]!.toUpperCase() + word.slice(1) : word
}

const RU_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

// QWERTY → ЙЦУКЕН (и обратно): «текст», набранный не той раскладкой.
// Клавиша → символ той же физической клавиши в другой раскладке.
const EN_TO_RU_LAYOUT: Record<string, string> = {
  '`': 'ё', q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д',
  ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б',
  '.': 'ю', '/': '.'
}
const RU_TO_EN_LAYOUT: Record<string, string> = Object.fromEntries(Object.entries(EN_TO_RU_LAYOUT).map(([k, v]) => [v, k]))

function convertLayout(input: string, map: Record<string, string>): string {
  return [...input].map((ch) => {
    const lower = ch.toLowerCase()
    const mapped = map[lower]
    if (!mapped) return ch
    return ch === lower ? mapped : mapped.toUpperCase()
  }).join('')
}

const LEET_MAP: Record<string, string> = {
  a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', g: '9', b: '8'
}

/* ------------------------------------------------------------------ */
/* Данные: IR-пары (уровень B → клиент, «быстрые победы»)               */
/* Каждая пара — serialize_to(parse_from(x)) над общим IrNode, см. ir.ts */
/* Список курируем: INI↔CSV пока не включаем (семантика мусорная).      */
/* ------------------------------------------------------------------ */

function fmt(id: string): IrFormat {
  const f = IR_FORMATS.find((x) => x.id === id)
  if (!f) throw new Error(`Unknown IR format: ${id}`)
  return f
}

export const DATA_CONVERTERS: TextConverter[] = [
  makeIrPair(fmt('ini'), fmt('json')),
  makeIrPair(fmt('json'), fmt('ini')),
  makeIrPair(fmt('csv'), fmt('json')),
  makeIrPair(fmt('json'), fmt('csv')),
  makeIrPair(fmt('ini'), fmt('yaml')),
  makeIrPair(fmt('ini'), fmt('toml')),
  makeIrPair(fmt('csv'), fmt('yaml')),
  makeIrPair(fmt('csv'), fmt('toml')),
  makeIrPair(fmt('json'), fmt('yaml')),
  makeIrPair(fmt('json'), fmt('toml')),
  // фаза 2: YAML стал двусторонним (парсинг), плюс vCard/iCal
  makeIrPair(fmt('yaml'), fmt('json')),
  makeIrPair(fmt('yaml'), fmt('ini')),
  makeIrPair(fmt('yaml'), fmt('toml')),
  makeIrPair(fmt('yaml'), fmt('csv')),
  makeIrPair(fmt('vcard'), fmt('json')),
  makeIrPair(fmt('json'), fmt('vcard')),
  makeIrPair(fmt('ical'), fmt('json')),
  makeIrPair(fmt('json'), fmt('ical')),
  // фаза 2: TOML стал двусторонним (парсинг)
  makeIrPair(fmt('toml'), fmt('json')),
  makeIrPair(fmt('toml'), fmt('ini')),
  makeIrPair(fmt('toml'), fmt('yaml')),
  makeIrPair(fmt('toml'), fmt('csv')),
  // фаза 2: XML ↔ JSON
  makeIrPair(fmt('xml'), fmt('json')),
  makeIrPair(fmt('json'), fmt('xml')),
  // geo: KML/GPX → GeoJSON и GeoJSON → KML/GPX/CSV
  makeIrPair(fmt('kml'), fmt('geojson')),
  makeIrPair(fmt('gpx'), fmt('geojson')),
  makeIrPair(fmt('geojson'), fmt('json')),
  makeIrPair(fmt('json'), fmt('geojson')),
  makeIrPair(fmt('geojson'), fmt('kml')),
  makeIrPair(fmt('geojson'), fmt('gpx')),
  // GeoJSON → CSV: извлекаем features в таблицу (сделаем руками, т.к. serializeCsv ждёт массив)
  {
    id: 'geojson-to-csv',
    icon: 'i-lucide-arrow-right-left',
    run: geojsonToCsv
  }
]

export const TEXT_CONVERTER_GROUPS: ConverterGroup[] = [
  {
    id: 'case',
    items: [
      { id: 'upper', icon: 'i-lucide-arrow-up', run: (s) => s.toUpperCase() },
      { id: 'lower', icon: 'i-lucide-arrow-down', run: (s) => s.toLowerCase() },
      { id: 'title', icon: 'i-lucide-type', run: (s) => wordsOf(s).map(capitalize).join(' ') },
      { id: 'camel', icon: 'i-lucide-text-cursor', run: (s) => wordsOf(s).map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w.toLowerCase()))).join('') },
      { id: 'snake', icon: 'i-lucide-text-cursor', run: (s) => wordsOf(s).map((w) => w.toLowerCase()).join('_') },
      { id: 'kebab', icon: 'i-lucide-text-cursor', run: (s) => wordsOf(s).map((w) => w.toLowerCase()).join('-') }
    ]
  },
  {
    id: 'encoding',
    items: [
      { id: 'base64-encode', icon: 'i-lucide-hash', reverseId: 'base64-decode', run: (s) => bytesToBase64(enc.encode(s)) },
      { id: 'base64-decode', icon: 'i-lucide-hash', reverseId: 'base64-encode', run: (s) => dec.decode(base64ToBytes(s)) },
      { id: 'hex-encode', icon: 'i-lucide-hash', reverseId: 'hex-decode', run: (s) => bytesToHex(enc.encode(s)) },
      { id: 'hex-decode', icon: 'i-lucide-hash', reverseId: 'hex-encode', run: (s) => dec.decode(hexToBytes(s)) },
      { id: 'url-encode', icon: 'i-lucide-link', reverseId: 'url-decode', run: (s) => encodeURIComponent(s) },
      { id: 'url-decode', icon: 'i-lucide-link', reverseId: 'url-encode', run: (s) => decodeURIComponent(s) },
      { id: 'html-escape', icon: 'i-lucide-code', run: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
    ]
  },
  {
    id: 'json',
    items: [
      { id: 'json-pretty', icon: 'i-lucide-braces', reverseId: 'json-minify', run: (s) => JSON.stringify(JSON.parse(s), null, 2) },
      { id: 'json-minify', icon: 'i-lucide-braces', reverseId: 'json-pretty', run: (s) => JSON.stringify(JSON.parse(s)) },
      { id: 'json-sort', icon: 'i-lucide-arrow-up-narrow-wide', run: (s) => JSON.stringify(sortObject(JSON.parse(s)), null, 2) },
      { id: 'json-to-jsonp', icon: 'i-lucide-braces', reverseId: 'jsonp-to-json', run: jsonToJsonp },
      { id: 'jsonp-to-json', icon: 'i-lucide-braces', reverseId: 'json-to-jsonp', run: jsonpToJson }
    ]
  },
  {
    id: 'string',
    items: [
      { id: 'reverse', icon: 'i-lucide-replace', reverseId: 'reverse', run: (s) => [...s].reverse().join('') },
      { id: 'rot13', icon: 'i-lucide-rotate-ccw', reverseId: 'rot13', run: (s) => s.replace(/[a-zA-Z]/g, (c) => { const base = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base) }) },
      { id: 'collapse-space', icon: 'i-lucide-space', run: (s) => s.replace(/\s+/g, ' ').trim() },
      { id: 'crlf-to-lf', icon: 'i-lucide-corner-down-left', run: (s) => s.replace(/\r\n/g, '\n') },
      { id: 'lf-to-crlf', icon: 'i-lucide-corner-down-left', run: (s) => s.replace(/\r?\n/g, '\r\n') },
      { id: 'cr-to-lf', icon: 'i-lucide-corner-down-left', reverseId: 'lf-to-cr', run: (s) => s.replace(/\r(?!\n)/g, '\n') },
      { id: 'lf-to-cr', icon: 'i-lucide-corner-down-left', reverseId: 'cr-to-lf', run: (s) => s.replace(/\r?\n/g, '\r') },
      { id: 'csv-to-tsv', icon: 'i-lucide-table', reverseId: 'tsv-to-csv', run: (s) => serializeDelimited(parseDelimited(s, ','), '\t') },
      { id: 'tsv-to-csv', icon: 'i-lucide-table', reverseId: 'csv-to-tsv', run: (s) => serializeDelimited(parseDelimited(s, '\t'), ',') },
      {
        id: 'text-stats',
        icon: 'i-lucide-bar-chart-3',
        run: (s) => `chars: ${s.length}\nwords: ${wordsOf(s).length}\nlines: ${s.split('\n').length}`,
        runL: (s, t) => `${t('stats.chars')}: ${s.length}\n${t('stats.words')}: ${wordsOf(s).length}\n${t('stats.lines')}: ${s.split('\n').length}`
      }
    ]
  },
  {
    id: 'fun',
    items: [
      { id: 'translit', icon: 'i-lucide-text-cursor', run: (s) => [...s].map((ch) => {
        const lower = ch.toLowerCase()
        const repl = RU_TRANSLIT[lower]
        if (!repl) return ch
        return ch === lower ? repl : capitalize(repl)
      }).join('') },
      { id: 'layout-to-ru', icon: 'i-lucide-keyboard', reverseId: 'layout-to-en', run: (s) => convertLayout(s, EN_TO_RU_LAYOUT) },
      { id: 'layout-to-en', icon: 'i-lucide-keyboard', reverseId: 'layout-to-ru', run: (s) => convertLayout(s, RU_TO_EN_LAYOUT) },
      { id: 'leet', icon: 'i-lucide-flame', run: (s) => s.replace(/[a-zA-Z]/g, (c) => LEET_MAP[c.toLowerCase()] ?? c) },
      { id: 'sha256', icon: 'i-lucide-shield-check', run: async (s) => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))) },
      { id: 'sha1', icon: 'i-lucide-shield', run: async (s) => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(s)))) },
      { id: 'md5', icon: 'i-lucide-shield', run: (s) => md5Hex(enc.encode(s)) },
      { id: 'emoji-to-codes', icon: 'i-lucide-smile', reverseId: 'codes-to-emoji', run: (s) => [...s].map((ch) => {
        const cp = ch.codePointAt(0)!
        return cp > 0xffff ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : ch
      }).join('') },
      { id: 'codes-to-emoji', icon: 'i-lucide-smile', reverseId: 'emoji-to-codes', run: (s) => s.replace(/\bU\+([0-9a-fA-F]{4,6})\b/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16))) }
    ]
  },
  {
    id: 'markup',
    items: [
      { id: 'md-to-html', icon: 'i-lucide-file-code', reverseId: 'html-to-md', run: mdToHtml },
      { id: 'html-to-md', icon: 'i-lucide-file-code', reverseId: 'md-to-html', run: htmlToMd }
    ]
  },
  {
    id: 'data',
    items: DATA_CONVERTERS
  }
]

export const TEXT_CONVERTERS: TextConverter[] = TEXT_CONVERTER_GROUPS.flatMap((g) => g.items)

export function getTextConverter(id: string): TextConverter | undefined {
  return TEXT_CONVERTERS.find((c) => c.id === id)
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortObject(v)]))
  }
  return value
}

/** GeoJSON FeatureCollection → CSV: каждая feature = строка, geometry → lon/lat. */
export function geojsonToCsv(input: string): string {
  const parsed = JSON.parse(input) as unknown
  if (!isPlainObject(parsed) || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features))
    throw new Error('errors.badGeoJson')

  const rows: Record<string, string>[] = []
  for (const feat of parsed.features) {
    if (!isPlainObject(feat)) continue
    const geom = isPlainObject(feat.geometry) ? (feat.geometry as Record<string, unknown>) : {}
    const props = isPlainObject(feat.properties) ? (feat.properties as Record<string, string>) : {}
    const coords = Array.isArray(geom.coordinates) ? geom.coordinates : []
    const row: Record<string, string> = { ...props }
    if (typeof geom.type === 'string') row.geom_type = geom.type
    // координаты: Point = [lon, lat], LineString = [[lon, lat], ...], Polygon = [[[lon, lat], ...]]
    if (coords.length > 0) {
      const first = Array.isArray(coords[0]) ? coords[0] as number[] : coords as number[]
      if (!Array.isArray(coords[0])) {
        // Point: [lon, lat]
        row.lon = String(first[0])
        row.lat = String(first[1])
      }
      else {
        // LineString/Polygon: [[lon, lat, ...]]
        const points = coords as number[][]
        row.lon = String(points[0]?.[0] ?? '')
        row.lat = String(points[0]?.[1] ?? '')
      }
    }
    rows.push(row)
  }

  // сериализуем в CSV через serializeDelimited
  if (rows.length === 0) return ''
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  const table = rows.map((r) => headers.map((h) => r[h] ?? ''))
  return serializeDelimited([headers, ...table], ',')
}

/* ------------------------------------------------------------------ */
/* Витрина форматов (для UI и будущего серверного реестра)              */
/* ------------------------------------------------------------------ */

export interface FormatDef {
  name: string
  icon: string
  /** если имя нужно локализовать (не акроним): t(`formatNames.${nameKey}`) */
  nameKey?: string
}

export interface FormatCategory {
  id: string
  icon: string
  formats: FormatDef[]
}

export const FORMAT_CATEGORIES: FormatCategory[] = [
  {
    id: 'text',
    icon: 'i-lucide-file-code',
    formats: [
      { name: 'JSON', icon: 'vscode-icons:file-type-json' },
      { name: 'YAML', icon: 'vscode-icons:file-type-yaml' },
      { name: 'TOML', icon: 'vscode-icons:file-type-toml' },
      { name: 'XML', icon: 'vscode-icons:file-type-xml' },
      { name: 'CSV', icon: 'i-lucide-table' },
      { name: 'TSV', icon: 'i-lucide-table' },
      { name: 'Markdown', icon: 'vscode-icons:file-type-markdown' },
      { name: 'HTML', icon: 'vscode-icons:file-type-html' },
      { name: 'TXT', icon: 'i-lucide-file-text' },
      { name: 'INI', icon: 'i-lucide-file-code' }
    ]
  },
  {
    id: 'image',
    icon: 'i-lucide-file-image',
    formats: [
      { name: 'PNG', icon: 'i-lucide-file-image' },
      { name: 'JPEG', icon: 'i-lucide-file-image' },
      { name: 'WebP', icon: 'vscode-icons:file-type-webp' },
      { name: 'GIF', icon: 'i-lucide-file-image' },
      { name: 'SVG', icon: 'vscode-icons:file-type-svg' },
      { name: 'AVIF', icon: 'vscode-icons:file-type-avif' },
      { name: 'TIFF', icon: 'i-lucide-file-image' },
      { name: 'HEIC', icon: 'i-lucide-file-image' },
      { name: 'ICO', icon: 'i-lucide-file-image' },
      { name: 'BMP', icon: 'i-lucide-file-image' }
    ]
  },
  {
    id: 'doc',
    icon: 'i-lucide-file-text',
    formats: [
      { name: 'PDF', icon: 'vscode-icons:file-type-pdf2' },
      { name: 'DOCX', icon: 'vscode-icons:file-type-word' },
      { name: 'HTML', icon: 'vscode-icons:file-type-html' },
      { name: 'XLSX', icon: 'vscode-icons:file-type-excel' },
      { name: 'PPTX', icon: 'vscode-icons:file-type-powerpoint' },
      { name: 'EPUB', icon: 'vscode-icons:file-type-epub' },
      { name: 'RTF', icon: 'i-lucide-file-text' },
      { name: 'TXT', icon: 'vscode-icons:file-type-text' }
    ]
  },
  {
    id: 'audio',
    icon: 'i-lucide-music',
    formats: [
      { name: 'MP3', icon: 'vscode-icons:file-type-audio' },
      { name: 'WAV', icon: 'vscode-icons:file-type-audio' },
      { name: 'OGG', icon: 'vscode-icons:file-type-audio' },
      { name: 'FLAC', icon: 'vscode-icons:file-type-audio' },
      { name: 'AIFF', icon: 'vscode-icons:file-type-audio' },
      { name: 'CAF', icon: 'vscode-icons:file-type-audio' },
      { name: 'Opus', icon: 'vscode-icons:file-type-audio' },
      { name: 'WebM', icon: 'vscode-icons:file-type-audio' },
      { name: 'M4A', icon: 'vscode-icons:file-type-audio' },
      { name: 'QOA', icon: 'vscode-icons:file-type-audio' }
    ]
  },
  {
    id: 'data',
    icon: 'i-lucide-database',
    formats: [
      { name: 'Base64', icon: 'i-lucide-hash' },
      { name: 'Hex', icon: 'i-lucide-hash' },
      { name: 'QR', icon: 'i-lucide-qr-code' },
      { name: 'vCard', icon: 'i-lucide-contact' },
      { name: 'iCal', icon: 'i-lucide-calendar' },
      { name: 'GeoJSON', icon: 'vscode-icons:file-type-geojson' },
      { name: 'KML', icon: 'i-lucide-map' },
      { name: 'GPX', icon: 'i-lucide-map' },
      { name: 'SQL', icon: 'vscode-icons:file-type-sql' },
      { name: 'ZIP', icon: 'vscode-icons:file-type-zip' },
      { name: 'GZIP', icon: 'i-lucide-archive' },
      { name: 'UUID', icon: 'i-lucide-key-round' }
    ]
  },
  {
    id: 'useless',
    icon: 'i-lucide-sparkles',
    formats: [
      { name: 'ROT13', icon: 'i-lucide-rotate-ccw' },
      { name: 'Leet', icon: 'i-lucide-flame' },
      { name: 'Translit', nameKey: 'formatNames.translit', icon: 'i-lucide-text-cursor' },
      { name: 'SHA-256', icon: 'i-lucide-shield-check' },
      { name: 'UUID v4', icon: 'i-lucide-key-round' },
      { name: 'Reverse', icon: 'i-lucide-replace' },
      { name: 'Stats', nameKey: 'formatNames.stats', icon: 'i-lucide-bar-chart-3' }
    ]
  }
]

export const ALL_FORMATS: FormatDef[] = FORMAT_CATEGORIES.flatMap((c) => c.formats)

/* ------------------------------------------------------------------ */
/* Изображения: что можно открыть и во что конвертировать (клиент)      */
/* ------------------------------------------------------------------ */

export interface ImageFormatDef {
  value: string
  label: string
  mime: string
  /** дополнительные MIME-типы для детекта (встречаются в дикой природе) */
  mimes?: string[]
  ext: string
  /** дополнительные расширения для детекта по имени файла */
  exts?: string[]
  icon: string
}

/** Форматы, которые canvas открывает и кодирует прямо в браузере. */
export const IMAGE_CLIENT_SOURCES: ImageFormatDef[] = [
  { value: 'png', label: 'PNG', mime: 'image/png', ext: 'png', icon: 'i-lucide-file-image' },
  { value: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', exts: ['jpeg'], icon: 'i-lucide-file-image' },
  { value: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', icon: 'vscode-icons:file-type-webp' },
  { value: 'gif', label: 'GIF', mime: 'image/gif', ext: 'gif', icon: 'i-lucide-file-image' },
  { value: 'svg', label: 'SVG', mime: 'image/svg+xml', ext: 'svg', icon: 'vscode-icons:file-type-svg' },
  { value: 'bmp', label: 'BMP', mime: 'image/bmp', ext: 'bmp', icon: 'i-lucide-file-image' }
]

/** Источники, которые сервер (sharp + heic-convert + руки) открывает: всё + HEIC/TIFF/ICO/AVIF. */
export const IMAGE_SERVER_SOURCES: ImageFormatDef[] = [
  ...IMAGE_CLIENT_SOURCES,
  { value: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', icon: 'vscode-icons:file-type-avif' },
  { value: 'heic', label: 'HEIC', mime: 'image/heic', exts: ['heif'], ext: 'heic', icon: 'i-lucide-file-image' },
  { value: 'tiff', label: 'TIFF', mime: 'image/tiff', exts: ['tif'], ext: 'tiff', icon: 'i-lucide-file-image' },
  { value: 'ico', label: 'ICO', mime: 'image/x-icon', mimes: ['image/vnd.microsoft.icon', 'image/ico'], exts: ['icon'], ext: 'ico', icon: 'i-lucide-file-image' }
]

export const IMAGE_SOURCE_FORMATS: ImageFormatDef[] = IMAGE_SERVER_SOURCES

/** Цели клиента: только то, что умеет canvas.toBlob. */
export const IMAGE_TARGET_FORMATS: ImageFormatDef[] = [
  { value: 'png', label: 'PNG', mime: 'image/png', ext: 'png', icon: 'i-lucide-file-image' },
  { value: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', icon: 'i-lucide-file-image' },
  { value: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', icon: 'vscode-icons:file-type-webp' }
]

/** Цели сервера: всё, что умеет sharp + ICO-обёртка. */
export const IMAGE_SERVER_TARGETS: ImageFormatDef[] = [
  ...IMAGE_TARGET_FORMATS,
  { value: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', icon: 'vscode-icons:file-type-avif' },
  { value: 'tiff', label: 'TIFF', mime: 'image/tiff', ext: 'tiff', icon: 'i-lucide-file-image' },
  { value: 'ico', label: 'ICO', mime: 'image/x-icon', ext: 'ico', icon: 'i-lucide-file-image' }
]

/** Пара считается клиентской, только если оба формата умеет canvas. */
export function isClientImagePair(from: string, to: string): boolean {
  return from !== to
    && IMAGE_CLIENT_SOURCES.some((f) => f.value === from)
    && IMAGE_TARGET_FORMATS.some((f) => f.value === to)
}

/* ------------------------------------------------------------------ */
/* Аудио: WAV ↔ MP3 прямо в браузере (Web Audio + lamejs, без ffmpeg)  */
/* ------------------------------------------------------------------ */

export interface AudioFormatDef {
  value: string
  label: string
  mime: string
  /** дополнительные MIME-типы для детекта (встречаются в дикой природе) */
  mimes?: string[]
  ext: string
  /** дополнительные расширения для детекта по имени файла */
  exts?: string[]
  icon: string
}

export const AUDIO_SOURCE_FORMATS: AudioFormatDef[] = [
  { value: 'mp3', label: 'MP3', mime: 'audio/mpeg', ext: 'mp3', exts: ['mp3'], icon: 'vscode-icons:file-type-audio' },
  { value: 'wav', label: 'WAV', mime: 'audio/wav', mimes: ['audio/x-wav', 'audio/wave', 'audio/vnd.wave'], ext: 'wav', exts: ['wave'], icon: 'vscode-icons:file-type-audio' },
  { value: 'ogg', label: 'OGG/Vorbis', mime: 'audio/ogg', mimes: ['audio/ogg; codecs=vorbis'], ext: 'ogg', exts: ['oga', 'ogg'], icon: 'vscode-icons:file-type-audio' },
  { value: 'opus', label: 'Opus', mime: 'audio/ogg', mimes: ['audio/ogg; codecs=opus'], ext: 'opus', icon: 'vscode-icons:file-type-audio' },
  { value: 'flac', label: 'FLAC', mime: 'audio/flac', ext: 'flac', icon: 'vscode-icons:file-type-audio' },
  { value: 'aiff', label: 'AIFF', mime: 'audio/aiff', mimes: ['audio/x-aiff'], ext: 'aiff', exts: ['aif', 'aifc'], icon: 'vscode-icons:file-type-audio' },
  { value: 'caf', label: 'CAF', mime: 'audio/x-caf', ext: 'caf', icon: 'vscode-icons:file-type-audio' },
  { value: 'webm', label: 'WebM', mime: 'audio/webm', ext: 'webm', icon: 'vscode-icons:file-type-audio' },
  { value: 'm4a', label: 'M4A/AAC', mime: 'audio/mp4', mimes: ['audio/aac', 'audio/x-m4a'], ext: 'm4a', exts: ['mp4', 'aac', 'alac'], icon: 'vscode-icons:file-type-audio' },
  { value: 'qoa', label: 'QOA', mime: 'audio/qoa', ext: 'qoa', icon: 'vscode-icons:file-type-audio' }
]

export const AUDIO_TARGET_FORMATS: AudioFormatDef[] = [
  { value: 'wav', label: 'WAV', mime: 'audio/wav', ext: 'wav', icon: 'vscode-icons:file-type-audio' },
  { value: 'mp3', label: 'MP3', mime: 'audio/mpeg', ext: 'mp3', icon: 'vscode-icons:file-type-audio' },
  { value: 'ogg', label: 'OGG/Vorbis', mime: 'audio/ogg', ext: 'ogg', icon: 'vscode-icons:file-type-audio' },
  { value: 'opus', label: 'Opus', mime: 'audio/ogg', ext: 'opus', exts: ['ogg'], icon: 'vscode-icons:file-type-audio' },
  { value: 'flac', label: 'FLAC', mime: 'audio/flac', ext: 'flac', icon: 'vscode-icons:file-type-audio' },
  { value: 'aiff', label: 'AIFF', mime: 'audio/aiff', ext: 'aiff', icon: 'vscode-icons:file-type-audio' },
  { value: 'caf', label: 'CAF', mime: 'audio/x-caf', ext: 'caf', icon: 'vscode-icons:file-type-audio' },
  { value: 'm4a', label: 'M4A/AAC', mime: 'audio/mp4', ext: 'm4a', icon: 'vscode-icons:file-type-audio' },
  { value: 'webm', label: 'WebM', mime: 'audio/webm', ext: 'webm', icon: 'vscode-icons:file-type-audio' },
  { value: 'qoa', label: 'QOA', mime: 'audio/qoa', ext: 'qoa', icon: 'vscode-icons:file-type-audio' }
]

/* ------------------------------------------------------------------ */
/* Детект исходного формата по файлу (mime, затем расширение)          */
/* ------------------------------------------------------------------ */

function matchesExt(name: string, def: { ext: string; exts?: string[] }): boolean {
  const lower = name.toLowerCase()
  return [def.ext, ...(def.exts ?? [])].some((e) => lower.endsWith(`.${e}`))
}

/** Пытается определить исходный формат изображения; undefined — не поддерживается. */
export function guessImageSource(file: { name: string; type: string }): ImageFormatDef | undefined {
  return IMAGE_SOURCE_FORMATS.find((f) => f.mime === file.type || f.mimes?.includes(file.type))
    ?? IMAGE_SOURCE_FORMATS.find((f) => matchesExt(file.name, f))
}

/** Пытается определить исходный аудио-формат; undefined — не поддерживается. */
export function guessAudioSource(file: { name: string; type: string }): AudioFormatDef | undefined {
  return AUDIO_SOURCE_FORMATS.find((f) => f.mime === file.type || f.mimes?.includes(file.type))
    ?? AUDIO_SOURCE_FORMATS.find((f) => matchesExt(file.name, f))
}
