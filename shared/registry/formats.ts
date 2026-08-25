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
import { ihexDecode, ihexEncode } from '../ihex'

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

const PUNYCODE_BASE = 36
const PUNYCODE_TMIN = 1
const PUNYCODE_TMAX = 26
const PUNYCODE_SKEW = 38
const PUNYCODE_DAMP = 700
const PUNYCODE_INITIAL_BIAS = 72
const PUNYCODE_INITIAL_N = 128

function punycodeDigit(char: string): number {
  const code = char.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 22
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 97
  return -1
}

function punycodeAdapt(delta: number, points: number, first: boolean): number {
  delta = first ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1
  delta += Math.floor(delta / points)
  let k = 0
  while (delta > Math.floor(((PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX) / 2)) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN))
    k += PUNYCODE_BASE
  }
  return k + Math.floor(((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta) / (delta + PUNYCODE_SKEW))
}

function decodePunycodeLabel(label: string): string {
  if (!label.startsWith('xn--')) return label
  const input = label.slice(4)
  const delimiter = input.lastIndexOf('-')
  const output = delimiter >= 0 ? [...input.slice(0, delimiter)] : []
  let index = delimiter >= 0 ? delimiter + 1 : 0
  let n = PUNYCODE_INITIAL_N
  let i = 0
  let bias = PUNYCODE_INITIAL_BIAS
  while (index < input.length) {
    const oldi = i
    let w = 1
    for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
      if (index >= input.length) throw new Error('errors.badIdn')
      const digit = punycodeDigit(input[index++]!)
      if (digit < 0) throw new Error('errors.badIdn')
      i += digit * w
      const threshold = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias
      if (digit < threshold) break
      w *= PUNYCODE_BASE - threshold
    }
    const points = output.length + 1
    bias = punycodeAdapt(i - oldi, points, oldi === 0)
    n += Math.floor(i / points)
    i %= points
    output.splice(i, 0, String.fromCodePoint(n))
    i++
  }
  return output.join('')
}

function mapIdn(input: string, decode: boolean): string {
  const value = input.trim()
  if (!value) throw new Error('errors.badIdn')
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  const protocolRelative = value.startsWith('//')
  const bare = !hasScheme && !protocolRelative
  let url: URL
  try { url = new URL(bare ? `http://${value}` : protocolRelative ? `http:${value}` : value) }
  catch { throw new Error('errors.badIdn') }
  const host = decode ? url.hostname.split('.').map(decodePunycodeLabel).join('.') : url.hostname
  const credentials = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  const authority = `${credentials}${host}${url.port ? `:${url.port}` : ''}`
  const suffix = `${url.pathname === '/' && bare && !/[/?#]/.test(value.slice(value.indexOf(host) + host.length)) ? '' : url.pathname}${url.search}${url.hash}`
  return `${bare ? '' : protocolRelative ? '//' : `${url.protocol}//`}${authority}${suffix}`
}

function quotedPrintableEncode(input: string): string {
  const bytes = enc.encode(input)
  let out = ''
  let column = 0
  const add = (token: string) => {
    if (column + token.length > 75) { out += '=\r\n'; column = 0 }
    out += token
    column += token.length
  }
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!
    if (byte === 13 || byte === 10) {
      if (byte === 13 && bytes[i + 1] === 10) i++
      out += '\r\n'
      column = 0
    }
    else if (byte >= 33 && byte <= 60 || byte >= 62 && byte <= 126 || byte === 32 || byte === 9) {
      add(String.fromCharCode(byte))
    }
    else {
      add(`=${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    }
  }
  return out
}

function quotedPrintableDecode(input: string): string {
  const clean = input.replace(/=(?:\r\n|\n|\r)/g, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '=') { bytes.push(clean.charCodeAt(i)); continue }
    const hex = clean.slice(i + 1, i + 3)
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error('errors.badQuotedPrintable')
    bytes.push(Number.parseInt(hex, 16))
    i += 2
  }
  return dec.decode(new Uint8Array(bytes))
}

function uuencode6(value: number): string {
  return String.fromCharCode(value === 0 ? 96 : 32 + value)
}

function uuencode(input: string): string {
  const bytes = enc.encode(input)
  const lines = ['begin 644 file.bin']
  for (let offset = 0; offset < bytes.length; offset += 45) {
    const chunk = bytes.slice(offset, offset + 45)
    let line = uuencode6(chunk.length)
    for (let i = 0; i < chunk.length; i += 3) {
      const a = chunk[i]!
      const b = chunk[i + 1] ?? 0
      const c = chunk[i + 2] ?? 0
      line += uuencode6((a >>> 2) & 63) + uuencode6(((a << 4) | (b >>> 4)) & 63)
        + uuencode6(((b << 2) | (c >>> 6)) & 63) + uuencode6(c & 63)
    }
    lines.push(line)
  }
  lines.push('`', 'end')
  return lines.join('\n')
}

function uudecode(input: string): string {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const begin = lines.findIndex((line) => /^begin(?:-base64)?\s+/i.test(line))
  const body = begin >= 0 ? lines.slice(begin + 1) : lines
  const bytes: number[] = []
  for (const line of body) {
    if (line.trim().toLowerCase() === 'end') break
    if (!line) continue
    const lengthChar = line.charCodeAt(0) - 32 & 63
    if (lengthChar === 0) continue
    if (line.length < 1 + Math.ceil(lengthChar / 3) * 4) throw new Error('errors.badUuencode')
    let produced = 0
    for (let i = 1; produced < lengthChar && i < line.length; i += 4) {
      const values = line.slice(i, i + 4).split('').map((char) => {
        const value = char.charCodeAt(0) - 32 & 63
        if (value < 0 || value > 63) throw new Error('errors.badUuencode')
        return value
      })
      if (values.length < 4) throw new Error('errors.badUuencode')
      bytes.push((values[0]! << 2) | (values[1]! >>> 4)); produced++
      if (produced < lengthChar) { bytes.push(((values[1]! << 4) | (values[2]! >>> 2)) & 255); produced++ }
      if (produced < lengthChar) { bytes.push(((values[2]! << 6) | values[3]!) & 255); produced++ }
    }
  }
  return dec.decode(new Uint8Array(bytes))
}

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  А: '.-', Б: '-...', В: '.--', Г: '--.', Д: '-..', Е: '.', Ж: '...-', З: '--..', И: '..', Й: '.---', К: '-.-', Л: '.-..', М: '--', Н: '-.', О: '---', П: '.--.', Р: '.-.', С: '...', Т: '-', У: '..-', Ф: '..-.', Х: '....', Ц: '-.-.', Ч: '---.', Ш: '----', Щ: '--.-', Ъ: '.--.-.', Ы: '-.--', Ь: '-..-', Э: '..-..', Ю: '..--', Я: '.-.-',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
}
// International Morse is shared by Latin and Cyrillic in many cases; prefer
// the internationally standard Latin spelling when a code is ambiguous.
const MORSE_REVERSE = new Map<string, string>()
for (const [char, code] of Object.entries(MORSE).reverse()) MORSE_REVERSE.set(code, char)

function morseEncode(input: string): string {
  return [...input].map((char) => char === ' ' ? '/' : MORSE[char.toUpperCase()] ?? (() => { throw new Error('errors.badMorse') })()).join(' ')
}

function morseDecode(input: string): string {
  return input.trim().split(/\s*\/\s*/).map((word) => word.trim().split(/\s+/).filter(Boolean).map((code) => {
    const char = MORSE_REVERSE.get(code)
    if (!char) throw new Error('errors.badMorse')
    return char
  }).join('')).join(' ')
}

function rot47(input: string): string {
  return [...input].map((char) => {
    const code = char.charCodeAt(0)
    return code >= 33 && code <= 126 ? String.fromCharCode(33 + ((code - 33 + 47) % 94)) : char
  }).join('')
}

function atbash(input: string): string {
  return input.replace(/[A-Za-zА-Яа-яЁё]/g, (char) => {
    if (/[A-Za-z]/.test(char)) {
      const base = char <= 'Z' ? 65 : 97
      return String.fromCharCode(base + 25 - (char.charCodeAt(0) - base))
    }
    const lower = char.toLowerCase()
    const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
    const index = alphabet.indexOf(lower)
    const result = alphabet[alphabet.length - 1 - index]
    return char === char.toUpperCase() ? result!.toUpperCase() : result!
  })
}

function caesar(input: string, shift: number): string {
  return input.replace(/[A-Za-z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97
    return String.fromCharCode(base + (char.charCodeAt(0) - base + shift + 26) % 26)
  })
}

function xorWithKey(input: string, decode: boolean): string {
  const separator = input.indexOf('\n')
  if (separator < 1) throw new Error('errors.badXor')
  const key = enc.encode(input.slice(0, separator).replace(/\r$/, ''))
  if (!key.length) throw new Error('errors.badXor')
  if (decode) {
    const bytes = hexToBytes(input.slice(separator + 1))
    return dec.decode(new Uint8Array(bytes.map((byte, index) => byte ^ key[index % key.length]!)))
  }
  const bytes = enc.encode(input.slice(separator + 1))
  return bytesToHex(new Uint8Array(bytes.map((byte, index) => byte ^ key[index % key.length]!)))
}

const A1Z26_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function a1z26Encode(input: string): string {
  return [...input].map((char) => {
    if (char === ' ') return '/'
    const index = A1Z26_ALPHABET.indexOf(char.toUpperCase())
    if (index < 0) throw new Error('errors.badA1z26')
    return String(index + 1)
  }).join(' ')
}

function a1z26Decode(input: string): string {
  return input.trim().split(/\s+/).map((token) => {
    if (token === '/') return ' '
    const value = Number(token)
    if (!Number.isInteger(value) || value < 1 || value > 26) throw new Error('errors.badA1z26')
    return A1Z26_ALPHABET[value - 1]
  }).join('')
}

const BACON_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function baconEncode(input: string): string {
  return [...input].map((char) => {
    if (char === ' ') return '/'
    const index = BACON_ALPHABET.indexOf(char.toUpperCase())
    if (index < 0) throw new Error('errors.badBacon')
    return index.toString(2).padStart(5, '0').replace(/0/g, 'a').replace(/1/g, 'b')
  }).join(' ')
}

function baconDecode(input: string): string {
  return input.trim().split(/\s+/).map((token) => {
    if (token === '/') return ' '
    if (!/^[ab]{5}$/i.test(token)) throw new Error('errors.badBacon')
    const value = Number.parseInt(token.toLowerCase().replace(/a/g, '0').replace(/b/g, '1'), 2)
    if (value >= 26) throw new Error('errors.badBacon')
    return BACON_ALPHABET[value]
  }).join('')
}

const TAP_ALPHABET = 'ABCDEFGHIKLMNOPQRSTUVWXYZ'

function tapEncode(input: string): string {
  return [...input].map((char) => {
    if (char === ' ') return '/'
    const index = TAP_ALPHABET.indexOf(char.toUpperCase().replace('J', 'I'))
    if (index < 0) throw new Error('errors.badTapCode')
    return `${Math.floor(index / 5) + 1}${index % 5 + 1}`
  }).join(' ')
}

function tapDecode(input: string): string {
  return input.trim().split(/\s+/).map((token) => {
    if (token === '/') return ' '
    if (!/^[1-5]{2}$/.test(token)) throw new Error('errors.badTapCode')
    const index = (Number(token[0]) - 1) * 5 + Number(token[1]) - 1
    return TAP_ALPHABET[index]
  }).join('')
}

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '')
}

function unfuckPaste(input: string): string {
  return input
    .replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/[‐‑‒–—―−﹘﹣－]/g, '-')
    .replace(/…/g, '...')
}

function takeTimestampOptions(input: string): { value: string; unit?: 's' | 'ms'; local: boolean } {
  let value = input.trim()
  let unit: 's' | 'ms' | undefined
  let local = false
  let changed = true
  while (changed) {
    changed = false
    if (value.startsWith('local:')) { local = true; value = value.slice(6); changed = true }
    else if (value.startsWith('utc:')) { local = false; value = value.slice(4); changed = true }
    else if (value.startsWith('ms:')) { unit = 'ms'; value = value.slice(3); changed = true }
    else if (value.startsWith('s:')) { unit = 's'; value = value.slice(2); changed = true }
  }
  return { value: value.trim(), unit, local }
}

function formatLocalIso(date: Date): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function unixToIso(input: string): string {
  const options = takeTimestampOptions(input)
  const number = Number(options.value)
  if (!options.value || !Number.isFinite(number)) throw new Error('errors.badTimestamp')
  const unit = options.unit ?? (Math.abs(number) < 100_000_000_000 ? 's' : 'ms')
  const date = new Date(unit === 's' ? number * 1000 : number)
  if (Number.isNaN(date.getTime())) throw new Error('errors.badTimestamp')
  return options.local ? formatLocalIso(date) : date.toISOString()
}

function isoToUnix(input: string): string {
  const options = takeTimestampOptions(input)
  const time = Date.parse(options.value)
  if (!options.value || Number.isNaN(time)) throw new Error('errors.badTimestamp')
  return String(options.unit === 'ms' ? time : Math.trunc(time / 1000))
}

function normalizeMac(input: string): string {
  const clean = input.trim().replace(/^0x/i, '').replace(/[\s.:-]/g, '')
  if (!/^[0-9a-fA-F]{12}$/.test(clean)) throw new Error('errors.badMac')
  return clean.toLowerCase()
}

function formatMac(input: string, style: 'colon' | 'dash' | 'cisco' | 'plain'): string {
  const mac = normalizeMac(input)
  if (style === 'plain') return mac
  if (style === 'cisco') return `${mac.slice(0, 4)}.${mac.slice(4, 8)}.${mac.slice(8, 12)}`
  const separator = style === 'colon' ? ':' : '-'
  return mac.match(/../g)!.join(separator)
}

type Rgb = [number, number, number]
type Hsl = [number, number, number]

function parseHexColor(input: string): Rgb {
  const value = input.trim().replace(/^#/, '')
  const hex = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('errors.badColor')
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
}

function parseRgbColor(input: string): Rgb {
  const value = input.trim().replace(/^rgba?\(/i, '').replace(/\)$/, '')
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length !== 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) throw new Error('errors.badColor')
  const rgb = parts.map(Number)
  if (rgb.some((part) => part < 0 || part > 255)) throw new Error('errors.badColor')
  return rgb as Rgb
}

function parseHslColor(input: string): Hsl {
  const value = input.trim().replace(/^hsla?\(/i, '').replace(/\)$/, '')
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length !== 3 || !/^\d+(?:\.\d+)?$/.test(parts[0]!) || !/^\d+(?:\.\d+)?%$/.test(parts[1]!) || !/^\d+(?:\.\d+)?%$/.test(parts[2]!)) throw new Error('errors.badColor')
  const hsl: Hsl = [Number(parts[0]), Number(parts[1]!.slice(0, -1)), Number(parts[2]!.slice(0, -1))]
  if (hsl[0] < 0 || hsl[0] > 360 || hsl[1] < 0 || hsl[1] > 100 || hsl[2] < 0 || hsl[2] > 100) throw new Error('errors.badColor')
  return hsl
}

function rgbToHsl([r8, g8, b8]: Rgb): Hsl {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  if (delta) h = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  return [(h + 360) % 360, s * 100, l * 100]
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  const saturation = s / 100, lightness = l / 100, chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = lightness - chroma / 2
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

const formatRgb = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`
const formatHsl = ([h, s, l]: Hsl) => `hsl(${Number(h.toFixed(2))}, ${Number(s.toFixed(2))}%, ${Number(l.toFixed(2))}%)`
const formatHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`

const ROMAN_VALUES: Array<[string, number]> = [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]]

function arabicToRoman(input: string): string {
  const value = Number(input.trim())
  if (!Number.isInteger(value) || value < 1 || value > 3999) throw new Error('errors.badRoman')
  let rest = value
  let result = ''
  for (const [roman, arabic] of ROMAN_VALUES) { while (rest >= arabic) { result += roman; rest -= arabic } }
  return result
}

function romanToArabic(input: string): string {
  const value = input.trim().toUpperCase()
  if (!/^[IVXLCDM]+$/.test(value)) throw new Error('errors.badRoman')
  let result = 0
  for (let i = 0; i < value.length; i++) {
    const current = ROMAN_VALUES.find(([roman]) => roman === value[i])![1]
    const next = i + 1 < value.length ? ROMAN_VALUES.find(([roman]) => roman === value[i + 1])![1] : 0
    result += current < next ? -current : current
  }
  if (arabicToRoman(String(result)) !== value) throw new Error('errors.badRoman')
  return String(result)
}

function decodeBase64Url(input: string): string {
  const value = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4)
  try { return dec.decode(base64ToBytes(value)) } catch { throw new Error('errors.badJwt') }
}

function jwtDecode(input: string): string {
  const parts = input.trim().split('.')
  if (parts.length !== 3) throw new Error('errors.badJwt')
  try {
    const header = JSON.parse(decodeBase64Url(parts[0]!))
    const payload = JSON.parse(decodeBase64Url(parts[1]!))
    return JSON.stringify({ header, payload }, null, 2)
  } catch { throw new Error('errors.badJwt') }
}

function globToRegex(input: string): string {
  let result = '^'
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (char === '*' && input[i + 1] === '*') { result += '.*'; i++ }
    else if (char === '*') result += '[^/]*'
    else if (char === '?') result += '[^/]'
    else if (char === '[') {
      const end = input.indexOf(']', i + 1)
      if (end < 0) throw new Error('errors.badGlob')
      result += input.slice(i, end + 1); i = end
    }
    else if ('\\.^$+{}()|'.includes(char)) result += `\\${char}`
    else result += char
  }
  return `${result}$`
}

function regexToGlob(input: string): string {
  let value = input.trim()
  if (value.startsWith('^')) value = value.slice(1)
  if (value.endsWith('$')) value = value.slice(0, -1)
  value = value.replace(/\[\^\/\]\*/g, '*').replace(/\.\*/g, '**').replace(/\[\^\/\]/g, '?')
  value = value.replace(/\\([.\\^$+{}()|])/g, '$1')
  if (/[[\]()]|\{/.test(value)) throw new Error('errors.badGlob')
  return value
}

function cEscapeEncode(input: string): string {
  return [...input].map((char) => {
    const code = char.codePointAt(0)!
    const escapes: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f', '\0': '\\0' }
    if (escapes[char]) return escapes[char]
    if (code >= 32 && code <= 126) return char
    return code <= 255 ? `\\x${code.toString(16).padStart(2, '0').toUpperCase()}` : `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`
  }).join('')
}

function cEscapeDecode(input: string): string {
  return input.replace(/\\(?:([\\"'abfnrtv0])|x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4}))/g, (match, simple: string, hex: string, unicode: string) => {
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16))
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16))
    return ({ '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '0': '\0' } as Record<string, string>)[simple]!
  })
}

function shellOptions(input: string): { shell: 'bash' | 'cmd' | 'powershell'; body: string } {
  const match = input.match(/^(bash|cmd|powershell):\s*\n([\s\S]*)$/i)
  return { shell: (match?.[1]?.toLowerCase() as 'bash' | 'cmd' | 'powershell') ?? 'bash', body: match ? match[2]! : input }
}
function shellQuote(input: string): string {
  const { shell, body } = shellOptions(input)
  const args = body.split(/\r?\n/)
  return args.map((arg) => shell === 'bash' ? `'${arg.replace(/'/g, `'\\''`)}'` : shell === 'powershell' ? `'${arg.replace(/'/g, "''")}'` : `"${arg.replace(/(["%^&|<>])/g, '^$1')}"`).join(' ')
}
function argvSplit(input: string): string {
  const { shell, body } = shellOptions(input)
  const args: string[] = []; let current = ''; let quote = ''; let escaped = false
  for (const char of body.trim()) {
    if (escaped) { current += char; escaped = false; continue }
    if (shell === 'bash' && char === '\\' && !quote) { escaped = true; continue }
    if (char === '"' || char === "'") { if (!quote) quote = char; else if (quote === char) quote = ''; else current += char; continue }
    if (!quote && /\s/.test(char)) { if (current) { args.push(current); current = '' }; continue }
    current += char
  }
  if (escaped || quote) throw new Error('errors.badShell')
  if (current) args.push(current)
  return args.join('\n')
}

function windowsToPosix(input: string): string {
  const value = input.trim().replace(/\\/g, '/')
  const drive = value.match(/^([A-Za-z]):(?:\/)?(.*)$/)
  if (drive) return `/${drive[1]!.toLowerCase()}/${drive[2]}`
  return value.replace(/^\/\//, '//')
}
function posixToWindows(input: string): string {
  const value = input.trim()
  const drive = value.match(/^\/([A-Za-z])\/(.*)$/)
  if (drive) return `${drive[1]!.toUpperCase()}:\\${drive[2]!.replace(/\//g, '\\')}`
  return value.replace(/\//g, '\\')
}

const ZALGO_MARKS = ['\u030d', '\u0310', '\u0311', '\u0312', '\u0334', '\u0335', '\u0336', '\u034f', '\u035c', '\u0360']
function zalgoAdd(input: string): string {
  return [...input].map((char) => /\s/u.test(char) ? char : char + ZALGO_MARKS.join('')).join('')
}
function zalgoRemove(input: string): string { return input.normalize('NFD').replace(/\p{M}/gu, '') }
function slugify(input: string): string {
  const transliterated = [...input].map((char) => {
    const lower = char.toLowerCase()
    return RU_TRANSLIT[lower] ?? char
  }).join('')
  return transliterated.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function passwordAnalysis(input: string, t: TranslateFn): string {
  const value = input
  const categories = [/[a-z]/.test(value) && 26, /[A-Z]/.test(value) && 26, /\d/.test(value) && 10, /[^A-Za-z0-9]/.test(value) && 33].filter(Boolean) as number[]
  const alphabet = categories.reduce((sum, size) => sum + size, 0)
  const entropy = value.length * (alphabet ? Math.log2(alphabet) : 0)
  const lower = value.toLowerCase()
  const patternKeys: string[] = []
  if (/^(?:password|passw0rd|qwerty|letmein|welcome|admin|пароль|йцукен|123456|12345678)$/i.test(lower)) patternKeys.push('passwordAnalysis.patternCommon')
  if (/(.)\1{2,}/u.test(value)) patternKeys.push('passwordAnalysis.patternRepeat')
  if (/0123|1234|2345|3456|abcd|qwer|йцуке|кенгш/i.test(lower)) patternKeys.push('passwordAnalysis.patternSequence')
  const verdict = entropy < 40 || patternKeys.length ? 'passwordAnalysis.weak' : entropy < 60 ? 'passwordAnalysis.medium' : 'passwordAnalysis.strong'
  const label = (key: string) => t(key)
  return [
    `${label('passwordAnalysis.length')}: ${value.length}`,
    `${label('passwordAnalysis.charset')}: ${alphabet || 0}`,
    `${label('passwordAnalysis.entropy')}: ${entropy.toFixed(1)} bits`,
    `${label('passwordAnalysis.patterns')}: ${patternKeys.length ? patternKeys.map(label).join(', ') : label('passwordAnalysis.none')}`,
    `${label('passwordAnalysis.verdict')}: ${label(verdict)}`
  ].join('\n')
}

const PASSWORD_ANALYSIS_EN: Record<string, string> = {
  'passwordAnalysis.length': 'Length', 'passwordAnalysis.charset': 'Estimated alphabet', 'passwordAnalysis.entropy': 'Entropy', 'passwordAnalysis.patterns': 'Patterns', 'passwordAnalysis.none': 'none', 'passwordAnalysis.patternCommon': 'common password', 'passwordAnalysis.patternRepeat': 'repeated characters', 'passwordAnalysis.patternSequence': 'sequence or keyboard pattern', 'passwordAnalysis.verdict': 'Verdict', 'passwordAnalysis.weak': 'weak', 'passwordAnalysis.medium': 'medium', 'passwordAnalysis.strong': 'strong'
}
export function passwordAnalysisText(input: string): string { return passwordAnalysis(input, (key) => PASSWORD_ANALYSIS_EN[key] ?? key) }

function checksumResult(valid: boolean, t: TranslateFn): string { return t(valid ? 'checksums.valid' : 'checksums.invalid') }
function digitsOnly(input: string): string { return input.replace(/[\s-]/g, '') }
function luhnValid(input: string): boolean {
  const value = digitsOnly(input)
  if (!/^\d+$/.test(value) || value.length < 2) return false
  let sum = 0
  for (let i = value.length - 1, position = 0; i >= 0; i--, position++) {
    let digit = Number(value[i])
    if (position % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9 }
    sum += digit
  }
  return sum % 10 === 0
}
function innValid(input: string): boolean {
  const value = digitsOnly(input)
  if (!/^\d{10}$|^\d{12}$/.test(value)) return false
  const check = (weights: number[]) => weights.reduce((sum, weight, i) => sum + Number(value[i]) * weight, 0) % 11 % 10
  if (value.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[9])
  return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[10])
    && [...value.slice(0, 11)].reduce((sum, digit, i) => sum + Number(digit) * [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8][i]!, 0) % 11 % 10 === Number(value[11])
}
function isbnValid(input: string): boolean {
  const value = input.replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{9}[\dX]$/.test(value)) return [...value].reduce((sum, digit, i) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - i), 0) % 11 === 0
  if (/^\d{13}$/.test(value)) return value.slice(0, 12).split('').reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === (10 - Number(value[12])) % 10
  return false
}
function eanUpcValid(input: string): boolean {
  const value = digitsOnly(input)
  if (!/^\d{12}$|^\d{13}$/.test(value)) return false
  const body = value.slice(0, -1)
  const expected = (10 - body.split('').reduce((sum, digit, i) => sum + Number(digit) * ((body.length - i) % 2 ? 3 : 1), 0) % 10) % 10
  return expected === Number(value[value.length - 1])
}
function crc32(input: string): string {
  let crc = 0xffffffff
  for (const byte of enc.encode(input)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0').toUpperCase()
}
const CHECKSUMS_EN: Record<string, string> = { 'checksums.valid': 'Valid', 'checksums.invalid': 'Invalid' }

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24,
  FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21,
  HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20,
  MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20
}

function normalizeIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

function ibanValid(input: string): boolean {
  const value = normalizeIban(input)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(value)) return false
  if (IBAN_LENGTHS[value.slice(0, 2)] && IBAN_LENGTHS[value.slice(0, 2)] !== value.length) return false
  const rearranged = value.slice(4) + value.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const expanded = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

function ibanFormat(input: string): string {
  const value = normalizeIban(input)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(value)) throw new Error('errors.badIban')
  return value.match(/.{1,4}/g)!.join(' ')
}

const CHMOD_SYMBOLS = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']

function chmodToSymbolic(input: string): string {
  const value = input.trim()
  if (!/^[0-7]{3}$/.test(value)) throw new Error('errors.badChmod')
  return [...value].map((digit) => CHMOD_SYMBOLS[Number(digit)]!).join('')
}

function symbolicToChmod(input: string): string {
  const value = input.trim().replace(/^-/, '')
  if (!/^[r-][w-][x-][r-][w-][x-][r-][w-][x-]$/.test(value)) throw new Error('errors.badChmod')
  return [0, 3, 6].map((offset) => {
    const bits = value.slice(offset, offset + 3)
    return String((bits[0] === 'r' ? 4 : 0) + (bits[1] === 'w' ? 2 : 0) + (bits[2] === 'x' ? 1 : 0))
  }).join('')
}

function typescriptIdentifier(input: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9_$]+/g, ' ').trim()
  const result = cleaned ? cleaned.split(/\s+/).map((part) => part[0]!.toUpperCase() + part.slice(1)).join('') : 'Value'
  return /^[A-Za-z_$]/.test(result) ? result : `Value${result}`
}

function jsonToTypescript(input: string): string {
  let root: unknown
  try { root = JSON.parse(input) } catch { throw new Error('errors.badJson') }
  const interfaces: Array<{ name: string; value: Record<string, unknown> }> = []
  const usedNames = new Set<string>()
  const uniqueName = (hint: string): string => {
    const base = typescriptIdentifier(hint)
    let name = base
    let index = 2
    while (usedNames.has(name)) name = `${base}${index++}`
    usedNames.add(name)
    return name
  }
  const typeOf = (value: unknown, hint: string): string => {
    if (value === null) return 'null'
    if (Array.isArray(value)) {
      if (!value.length) return 'unknown[]'
      const types = [...new Set(value.map((item) => typeOf(item, `${hint}Item`)))]
      return types.length === 1 ? `${types[0]}[]` : `(${types.join(' | ')})[]`
    }
    if (typeof value === 'object') {
      const name = uniqueName(hint)
      interfaces.push({ name, value: value as Record<string, unknown> })
      return name
    }
    if (typeof value === 'string') return 'string'
    if (typeof value === 'number') return Number.isInteger(value) ? 'number' : 'number'
    if (typeof value === 'boolean') return 'boolean'
    return 'unknown'
  }
  const rootType = typeOf(root, 'Root')
  const property = (key: string) => /^[A-Za-z_$][\w$]*$/u.test(key) ? key : JSON.stringify(key)
  const render = (entry: { name: string; value: Record<string, unknown> }) => {
    const fields = Object.entries(entry.value).map(([key, value]) => `  ${property(key)}: ${typeOf(value, `${entry.name}${typescriptIdentifier(key)}`)};`)
    return `export interface ${entry.name} {\n${fields.join('\n')}\n}`
  }
  const rendered: string[] = []
  for (let i = 0; i < interfaces.length; i++) rendered.push(render(interfaces[i]!))
  if (rootType !== 'Root') return `export type Root = ${rootType}\n\n${rendered.join('\n\n')}`
  return rendered.join('\n\n')
}

class HjsonReader {
  private index = 0
  constructor(private readonly source: string) {}

  parse(): unknown {
    this.skipSpaceAndComments()
    const value = this.peek() === '{' ? this.parseObject(true) : this.parseObject(false)
    this.skipSpaceAndComments()
    if (this.index < this.source.length) throw new Error('errors.badHjson')
    return value
  }

  private peek(): string { return this.source[this.index] ?? '' }

  private skipSpaceAndComments(): void {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index]!)) { this.index++; continue }
      if (this.source.startsWith('//', this.index) || this.peek() === '#') {
        while (this.index < this.source.length && this.source[this.index] !== '\n') this.index++
        continue
      }
      if (this.source.startsWith('/*', this.index)) {
        const end = this.source.indexOf('*/', this.index + 2)
        if (end < 0) throw new Error('errors.badHjson')
        this.index = end + 2
        continue
      }
      break
    }
  }

  private parseObject(braced: boolean): Record<string, unknown> {
    if (braced) this.index++
    const result: Record<string, unknown> = {}
    while (this.index < this.source.length) {
      this.skipSpaceAndComments()
      if (braced && this.peek() === '}') { this.index++; return result }
      if (!braced && this.index >= this.source.length) return result
      const key = this.parseKey()
      this.skipSpaceAndComments()
      if (this.peek() === ':') this.index++
      else if (this.peek() !== '\n' && this.peek() !== '') throw new Error('errors.badHjson')
      this.skipSpaceAndComments()
      result[key] = this.parseValue()
      this.skipSpaceAndComments()
      if (this.peek() === ',') this.index++
      else if (braced && this.peek() !== '}') throw new Error('errors.badHjson')
    }
    if (braced) throw new Error('errors.badHjson')
    return result
  }

  private parseKey(): string {
    if (this.peek() === '"' || this.peek() === "'") return this.parseString()
    const start = this.index
    while (this.index < this.source.length && !/[\s:{},\]]/.test(this.source[this.index]!)) this.index++
    const key = this.source.slice(start, this.index).trim()
    if (!key) throw new Error('errors.badHjson')
    return key
  }

  private parseValue(): unknown {
    this.skipSpaceAndComments()
    if (this.peek() === '{') return this.parseObject(true)
    if (this.peek() === '[') return this.parseArray()
    if (this.peek() === '"' || this.peek() === "'") return this.parseString()
    const start = this.index
    while (this.index < this.source.length && !['\n', ',', '}', ']'].includes(this.source[this.index]!)) this.index++
    const token = this.source.slice(start, this.index).trim()
    if (!token) throw new Error('errors.badHjson')
    if (token === 'true') return true
    if (token === 'false') return false
    if (token === 'null') return null
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) return Number(token)
    return token
  }

  private parseArray(): unknown[] {
    this.index++
    const result: unknown[] = []
    while (this.index < this.source.length) {
      this.skipSpaceAndComments()
      if (this.peek() === ']') { this.index++; return result }
      result.push(this.parseValue())
      this.skipSpaceAndComments()
      if (this.peek() === ',') this.index++
      else if (this.peek() !== ']') throw new Error('errors.badHjson')
    }
    throw new Error('errors.badHjson')
  }

  private parseString(): string {
    const quote = this.source[this.index++]!
    let result = ''
    while (this.index < this.source.length) {
      const char = this.source[this.index++]!
      if (char === quote) return result
      if (char !== '\\') { result += char; continue }
      if (this.index >= this.source.length) throw new Error('errors.badHjson')
      const escaped = this.source[this.index++]!
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" }
      if (escaped === 'u') {
        const hex = this.source.slice(this.index, this.index + 4)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('errors.badHjson')
        result += String.fromCharCode(Number.parseInt(hex, 16)); this.index += 4
      }
      else result += escapes[escaped] ?? escaped
    }
    throw new Error('errors.badHjson')
  }
}

function hjsonToJson(input: string): string {
  return JSON.stringify(new HjsonReader(input).parse(), null, 2)
}

function hjsonKey(key: string): string {
  return /^[A-Za-z_$][\w$-]*$/u.test(key) ? key : JSON.stringify(key)
}

function hjsonString(value: string): string {
  const safe = !/[\s,:{}#]/u.test(value) && !value.includes('[') && !value.includes(']') && !value.includes('/')
  return safe && !/^(?:true|false|null|-?(?:\d+\.?\d*|\.\d+))$/i.test(value) ? value : JSON.stringify(value)
}

function jsonToHjson(input: string): string {
  let value: unknown
  try { value = JSON.parse(input) } catch { throw new Error('errors.badJson') }
  const stringify = (item: unknown, depth: number): string => {
    const indent = '  '.repeat(depth)
    const next = '  '.repeat(depth + 1)
    if (Array.isArray(item)) {
      if (!item.length) return '[]'
      return `[\n${item.map((entry) => `${next}${stringify(entry, depth + 1)}`).join(',\n')}\n${indent}]`
    }
    if (item && typeof item === 'object') {
      const entries = Object.entries(item)
      if (!entries.length) return '{}'
      return `{\n${entries.map(([key, entry]) => `${next}${hjsonKey(key)}: ${stringify(entry, depth + 1)}`).join(',\n')}\n${indent}}`
    }
    if (typeof item === 'string') return hjsonString(item)
    return JSON.stringify(item)
  }
  return stringify(value, 0)
}

function htmlEscape(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeBbcodeUrl(input: string): string {
  const value = input.trim()
  return /^(?:https?:|mailto:)/i.test(value) ? value : '#'
}

function bbcodeToHtml(input: string): string {
  const tagPattern = /\[\/?(?:b|strong|i|em|u|s|strike|url|img|quote|code|br|list|\*)\b[^\]]*\]/gi
  const stack: string[] = []
  let output = ''
  let last = 0
  const appendText = (value: string, code = false) => {
    if (stack[stack.length - 1] === 'img') output += htmlEscape(safeBbcodeUrl(value.trim()))
    else output += code ? htmlEscape(value) : htmlEscape(value).replace(/\r?\n/g, '<br>\n')
  }
  const openTags: Record<string, string> = { b: '<strong>', strong: '<strong>', i: '<em>', em: '<em>', u: '<u>', s: '<del>', strike: '<del>', quote: '<blockquote>', code: '<pre><code>', list: '<ul>' }
  const closeTags: Record<string, string> = { b: '</strong>', strong: '</strong>', i: '</em>', em: '</em>', u: '</u>', s: '</del>', strike: '</del>', quote: '</blockquote>', code: '</code></pre>', list: '</ul>', url: '</a>' }
  for (const match of input.matchAll(tagPattern)) {
    const raw = match[0]!
    const index = match.index!
    appendText(input.slice(last, index), stack.includes('code'))
    last = index + raw.length
    const closing = /^\[\//.test(raw)
    const content = raw.slice(closing ? 2 : 1, -1).trim()
    const equals = content.indexOf('=')
    const name = (equals < 0 ? content : content.slice(0, equals)).trim().toLowerCase()
    const argument = equals < 0 ? '' : content.slice(equals + 1).trim().replace(/^['"]|['"]$/g, '')
    if (name === 'br' && !closing) { output += '<br>'; continue }
    if (name === '*' && !closing) { output += '<li>'; stack.push('*'); continue }
    if (closing) {
      if (name === 'img' && stack[stack.length - 1] === 'img') { stack.pop(); output += '">' ; continue }
      if (stack[stack.length - 1] === name || (name === 'strong' && stack[stack.length - 1] === 'b') || (name === 'em' && stack[stack.length - 1] === 'i') || (name === 'strike' && stack[stack.length - 1] === 's')) {
        const tag = stack.pop()!
        output += tag === '*' ? '</li>' : closeTags[tag] ?? ''
      }
      else appendText(raw)
      continue
    }
    if (name === 'url') {
      const href = safeBbcodeUrl(argument)
      output += `<a href="${htmlEscape(href)}" rel="noopener noreferrer">`
      stack.push('url')
    }
    else if (name === 'img') { stack.push('img'); output += '<img src="' }
    else if (openTags[name]) { output += openTags[name]; stack.push(name) }
    else appendText(raw)
  }
  appendText(input.slice(last), stack.includes('code'))
  while (stack.length) { const tag = stack.pop()!; output += tag === '*' ? '</li>' : closeTags[tag] ?? '' }
  return output
}

function markdownTable(input: string, delimiter: ',' | '\t'): string {
  const rows = parseDelimited(input, delimiter)
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const cells = (row: string[]) => Array.from({ length: width }, (_, i) => (row[i] ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'))
  const header = cells(rows[0]!)
  const body = rows.slice(1).map(cells)
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...body.map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

function propertiesUnescape(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})|\\([nrtf\\])/g, (_, unicode: string, escaped: string) => {
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16))
    return ({ n: '\n', r: '\r', t: '\t', f: '\f', '\\': '\\' } as Record<string, string>)[escaped]!
  })
}

function propertiesParse(input: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!
    while (/\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i]!.trimStart()
    line = line.trim()
    if (!line || /^[#!]/.test(line)) continue
    const match = line.match(/(^|[^\\])(?:=|:|\s)/)
    if (!match || match.index === undefined) { result[propertiesUnescape(line)] = ''; continue }
    const separator = match.index + match[1].length
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1)
    if (value.startsWith('=') || value.startsWith(':')) value = value.slice(1)
    result[propertiesUnescape(key)] = propertiesUnescape(value.trim())
  }
  return result
}

function propertiesEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}

function jsonToProperties(input: string): string {
  let value: unknown
  try { value = JSON.parse(input) } catch { throw new Error('errors.badJson') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('errors.badProperties')
  const rows: string[] = []
  const visit = (object: Record<string, unknown>, prefix = '') => {
    for (const [key, item] of Object.entries(object)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (item && typeof item === 'object' && !Array.isArray(item)) visit(item as Record<string, unknown>, fullKey)
      else rows.push(`${propertiesEscape(fullKey)}=${propertiesEscape(typeof item === 'string' ? item : JSON.stringify(item))}`)
    }
  }
  visit(value as Record<string, unknown>)
  return rows.join('\n')
}

function envParse(input: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trimStart()
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error('errors.badEnv')
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    result[key] = propertiesUnescape(value)
  }
  return result
}

function envEscape(value: string): string {
  return /[\s#='"\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value
}

function jsonToEnv(input: string): string {
  let value: unknown
  try { value = JSON.parse(input) } catch { throw new Error('errors.badJson') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('errors.badEnv')
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}=${envEscape(typeof item === 'string' ? item : JSON.stringify(item))}`).join('\n')
}

const STEGO_ZERO = '\u200b'
const STEGO_ONE = '\u200c'
const STEGO_MAGIC = new Uint8Array([0x55, 0x57, 0x43, 0x31])

function bytesToStegoBits(bytes: Uint8Array): string {
  let hidden = ''
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) hidden += (byte & (1 << bit)) ? STEGO_ONE : STEGO_ZERO
  return hidden
}

function stegoBitsToBytes(bits: string): Uint8Array {
  if (!bits.length || bits.length % 8 !== 0) throw new Error('errors.badStego')
  const bytes = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0
    for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | (bits[i * 8 + bit] === STEGO_ONE ? 1 : 0)
    bytes[i] = byte
  }
  return bytes
}

function stegoEncode(input: string): string {
  const separator = input.indexOf('\n---\n')
  if (separator < 0) throw new Error('errors.badStegoFormat')
  const carrier = input.slice(0, separator)
  const secret = input.slice(separator + 5)
  if (!carrier || /[\u200b\u200c]/u.test(carrier)) throw new Error('errors.badStegoFormat')
  const payload = new Uint8Array(STEGO_MAGIC.length + enc.encode(secret).length)
  payload.set(STEGO_MAGIC)
  payload.set(enc.encode(secret), STEGO_MAGIC.length)
  return carrier + bytesToStegoBits(payload)
}

function stegoDecode(input: string): string {
  const bits = [...input].filter((char) => char === STEGO_ZERO || char === STEGO_ONE).join('')
  const bytes = stegoBitsToBytes(bits)
  if (bytes.length < STEGO_MAGIC.length || !STEGO_MAGIC.every((byte, i) => bytes[i] === byte)) throw new Error('errors.badStego')
  return dec.decode(bytes.slice(STEGO_MAGIC.length))
}

function sortLines(input: string): string { return input.split(/\r?\n/).sort((a, b) => a.localeCompare(b)).join('\n') }
function dedupeLines(input: string): string { return [...new Set(input.split(/\r?\n/))].join('\n') }
function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  do { crypto.getRandomValues(buffer) } while (buffer[0]! >= limit)
  return buffer[0]! % max
}
function shuffleLines(input: string): string {
  const lines = input.split(/\r?\n/)
  for (let i = lines.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [lines[i], lines[j]] = [lines[j]!, lines[i]!] }
  return lines.join('\n')
}
function numberLines(input: string): string { return input.split(/\r?\n/).map((line, i) => `${i + 1}. ${line}`).join('\n') }
function wrapText(input: string): string {
  const newline = input.indexOf('\n')
  const width = Number(input.slice(0, newline).trim())
  if (newline < 1 || !Number.isInteger(width) || width < 1) throw new Error('errors.badWrap')
  const words = input.slice(newline + 1).trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = '' }
    if (word.length > width && !line) { lines.push(word); continue }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

function convertNumberBase(input: string): string {
  const newline = input.indexOf('\n')
  if (newline < 1) throw new Error('errors.badBase')
  const [fromText, toText] = input.slice(0, newline).split(':')
  const from = Number(fromText), to = Number(toText), value = input.slice(newline + 1).trim()
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2 || from > 36 || to < 2 || to > 36 || !value) throw new Error('errors.badBase')
  let negative = false
  let digits = value
  if (digits.startsWith('-')) { negative = true; digits = digits.slice(1) }
  if (!digits) throw new Error('errors.badBase')
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  let number = 0n
  for (const char of digits.toLowerCase()) {
    const digit = alphabet.indexOf(char)
    if (digit < 0 || digit >= from) throw new Error('errors.badBase')
    number = number * BigInt(from) + BigInt(digit)
  }
  let output = number === 0n ? '0' : ''
  while (number > 0n) { output = alphabet[Number(number % BigInt(to))]! + output; number /= BigInt(to) }
  return negative && output !== '0' ? `-${output}` : output
}

function isoDurationToSeconds(input: string): string {
  const value = input.trim()
  const match = value.match(/^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!match || !match[2] && !match[3] && !match[4] && !match[5]) throw new Error('errors.badDuration')
  const seconds = (Number(match[2] ?? 0) * 86400 + Number(match[3] ?? 0) * 3600 + Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0)) * (match[1] ? -1 : 1)
  return String(Number.isInteger(seconds) ? seconds : seconds)
}

function secondsToIsoDuration(input: string): string {
  const secondsValue = Number(input.trim())
  if (!Number.isFinite(secondsValue)) throw new Error('errors.badDuration')
  const negative = secondsValue < 0
  let remaining = Math.abs(secondsValue)
  const days = Math.floor(remaining / 86400); remaining -= days * 86400
  const hours = Math.floor(remaining / 3600); remaining -= hours * 3600
  const minutes = Math.floor(remaining / 60); remaining -= minutes * 60
  const parts = [days ? `${days}D` : '', hours || minutes || remaining ? `T${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${remaining || (!days && !hours && !minutes) ? `${String(Number(remaining.toFixed(6)))}S` : ''}` : '']
  return `${negative ? '-' : ''}P${parts.join('')}`
}

const EBCDIC_CP037: Record<string, number> = {
  ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '|': 0x4f, '&': 0x50,
  '!': 0x5a, '$': 0x5b, '*': 0x5c, ')': 0x5d, ';': 0x5e, '-': 0x60, '/': 0x61,
  ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e, '?': 0x6f, ':': 0x7a, '#': 0x7b,
  '@': 0x7c, "'": 0x7d, '=': 0x7e, '"': 0x7f, '^': 0xb0, '[': 0xbb, ']': 0xba,
  '{': 0xc0, '}': 0xd0, '\\': 0xe0, '~': 0xa1
}
for (let i = 0; i < 26; i++) {
  EBCDIC_CP037[String.fromCharCode(65 + i)] = i < 9 ? 0xc1 + i : i < 18 ? 0xd1 + i - 9 : 0xe2 + i - 18
  EBCDIC_CP037[String.fromCharCode(97 + i)] = i < 9 ? 0x81 + i : i < 18 ? 0x91 + i - 9 : 0xa2 + i - 18
}
for (let i = 0; i < 10; i++) EBCDIC_CP037[String.fromCharCode(48 + i)] = 0xf0 + i

const ASCII_FROM_EBCDIC = new Map<number, string>(Object.entries(EBCDIC_CP037).map(([char, byte]) => [byte, char]))
ASCII_FROM_EBCDIC.set(0x15, '\n')
ASCII_FROM_EBCDIC.set(0x25, '\n')
ASCII_FROM_EBCDIC.set(0x0d, '\r')
ASCII_FROM_EBCDIC.set(0x05, '\t')

function ebcdicEncode(input: string): string {
  return [...input].map((char) => {
    const byte = EBCDIC_CP037[char]
    if (byte === undefined) throw new Error('errors.badEbcdic')
    return byte.toString(16).padStart(2, '0')
  }).join('').toUpperCase()
}

function ebcdicDecode(input: string): string {
  const clean = input.replace(/\s+/g, '').replace(/^0x/i, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('errors.badEbcdic')
  let out = ''
  for (let i = 0; i < clean.length; i += 2) {
    const byte = Number.parseInt(clean.slice(i, i + 2), 16)
    const char = ASCII_FROM_EBCDIC.get(byte)
    if (char === undefined) throw new Error('errors.badEbcdic')
    out += char
  }
  return out
}

const ITA2_LETTERS: Record<string, number> = {
  A: 3, B: 25, C: 14, D: 9, E: 1, F: 13, G: 26, H: 20, I: 6, J: 11, K: 15, L: 18, M: 28,
  N: 12, O: 24, P: 22, Q: 23, R: 10, S: 5, T: 16, U: 7, V: 30, W: 19, X: 29, Y: 21, Z: 17
}
const ITA2_FIGURES: Record<string, number> = {
  '-': 3, '3': 1, "'": 5, '8': 6, '7': 7, '$': 9, '4': 10, ',': 12, '!': 13, ':': 14, '(': 15,
  '5': 16, '+': 17, ')': 18, '2': 19, '#': 20, '6': 21, '0': 22, '1': 23, '9': 24, '?': 25,
  '&': 26, '.': 28, '/': 29, '=': 30
}
const ITA2_FIGURE_BY_CODE = new Map(Object.entries(ITA2_FIGURES).map(([char, code]) => [code, char]))
const ITA2_LETTER_BY_CODE = new Map(Object.entries(ITA2_LETTERS).map(([char, code]) => [code, char]))
const ITA2_LTRS = 31
const ITA2_FIGS = 27
const ita2Bits = (code: number) => code.toString(2).padStart(5, '0')

function baudotEncode(input: string): string {
  const codes: number[] = []
  let figures = false
  for (const char of input) {
    if (char === ' ') { codes.push(4); continue }
    if (char === '\n') { codes.push(2); continue }
    const upper = char.toUpperCase()
    if (ITA2_LETTERS[upper] !== undefined) {
      if (figures) { codes.push(ITA2_LTRS); figures = false }
      codes.push(ITA2_LETTERS[upper]!)
    }
    else if (ITA2_FIGURES[char] !== undefined) {
      if (!figures) { codes.push(ITA2_FIGS); figures = true }
      codes.push(ITA2_FIGURES[char]!)
    }
    else throw new Error('errors.badBaudot')
  }
  return codes.map(ita2Bits).join(' ')
}

function baudotDecode(input: string): string {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return ''
  let figures = false
  let out = ''
  for (const token of tokens) {
    if (!/^[01]{5}$/.test(token)) throw new Error('errors.badBaudot')
    const code = Number.parseInt(token, 2)
    if (code === ITA2_LTRS) { figures = false; continue }
    if (code === ITA2_FIGS) { figures = true; continue }
    if (code === 4) { out += ' '; continue }
    if (code === 2) { out += '\n'; continue }
    const char = figures ? ITA2_FIGURE_BY_CODE.get(code) : ITA2_LETTER_BY_CODE.get(code)
    if (!char) throw new Error('errors.badBaudot')
    out += char
  }
  return out
}

const HALF_KANA = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ'
const FULL_KANA = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜'
const FULL_TO_HALF_KANA = new Map<string, string>()
for (let i = 0; i < HALF_KANA.length; i++) FULL_TO_HALF_KANA.set(FULL_KANA[i]!, HALF_KANA[i]!)
for (const [full, half] of Object.entries({
  ガ: 'ｶﾞ', ギ: 'ｷﾞ', グ: 'ｸﾞ', ゲ: 'ｹﾞ', ゴ: 'ｺﾞ', ザ: 'ｻﾞ', ジ: 'ｼﾞ', ズ: 'ｽﾞ', ゼ: 'ｾﾞ', ゾ: 'ｿﾞ',
  ダ: 'ﾀﾞ', ヂ: 'ﾁﾞ', ヅ: 'ﾂﾞ', デ: 'ﾃﾞ', ド: 'ﾄﾞ', バ: 'ﾊﾞ', ビ: 'ﾋﾞ', ブ: 'ﾌﾞ', ベ: 'ﾍﾞ', ボ: 'ﾎﾞ', パ: 'ﾊﾟ', ピ: 'ﾋﾟ', プ: 'ﾌﾟ', ペ: 'ﾍﾟ', ポ: 'ﾎﾟ',
  ヴ: 'ｳﾞ', ヷ: 'ﾜﾞ', ヸ: 'ｲﾞ', ヹ: 'ｴﾞ', ヺ: 'ｦﾞ'
})) FULL_TO_HALF_KANA.set(full, half)
const HALF_TO_FULL_KANA = new Map<string, string>()
for (const [half, full] of Object.entries({
  ｶﾞ: 'ガ', ｷﾞ: 'ギ', ｸﾞ: 'グ', ｹﾞ: 'ゲ', ｺﾞ: 'ゴ', ｻﾞ: 'ザ', ｼﾞ: 'ジ', ｽﾞ: 'ズ', ｾﾞ: 'ゼ', ｿﾞ: 'ゾ', ﾀﾞ: 'ダ', ﾁﾞ: 'ヂ', ﾂﾞ: 'ヅ', ﾃﾞ: 'デ', ﾄﾞ: 'ド', ﾊﾞ: 'バ', ﾋﾞ: 'ビ', ﾌﾞ: 'ブ', ﾍﾞ: 'ベ', ﾎﾞ: 'ボ', ﾊﾟ: 'パ', ﾋﾟ: 'ピ', ﾌﾟ: 'プ', ﾍﾟ: 'ペ', ﾎﾟ: 'ポ', ｳﾞ: 'ヴ', ﾜﾞ: 'ヷ', ｲﾞ: 'ヸ', ｴﾞ: 'ヹ', ｦﾞ: 'ヺ'
})) HALF_TO_FULL_KANA.set(half, full)

function fullwidthToHalfwidth(input: string): string {
  let out = ''
  for (const char of input) {
    const code = char.charCodeAt(0)
    if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0)
    else if (char === '　') out += ' '
    else out += FULL_TO_HALF_KANA.get(char) ?? char
  }
  return out
}

function halfwidthToFullwidth(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const pair = input.slice(i, i + 2)
    if (HALF_TO_FULL_KANA.has(pair)) { out += HALF_TO_FULL_KANA.get(pair); i++; continue }
    const char = input[i]!
    const code = char.charCodeAt(0)
    if (code >= 0xff61 && code <= 0xff9f) out += FULL_KANA[HALF_KANA.indexOf(char)]
    else if (code >= 0x21 && code <= 0x7e) out += String.fromCharCode(code + 0xfee0)
    else if (char === ' ') out += '　'
    else out += char
  }
  return out
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function bytesToBase32(bytes: Uint8Array): string {
  let buffer = 0, bits = 0, out = ''
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += BASE32_ALPHABET[(buffer >>> bits) & 31] } }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  while (out.length % 8) out += '='
  return out
}
function base32ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[\s-]/g, '').toUpperCase(), firstPadding = clean.indexOf('='), body = firstPadding < 0 ? clean : clean.slice(0, firstPadding)
  if (!/^[A-Z2-7]*$/.test(body) || (firstPadding >= 0 && !/^=+$/.test(clean.slice(firstPadding)))) throw new Error('errors.badBase32')
  if (body.length % 8 === 1 || body.length % 8 === 3 || body.length % 8 === 6) throw new Error('errors.badBase32')
  let buffer = 0, bits = 0; const out: number[] = []
  for (const char of body) { buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(char); bits += 5; if (bits >= 8) { bits -= 8; out.push((buffer >>> bits) & 255) } }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) throw new Error('errors.badBase32')
  return new Uint8Array(out)
}
function bytesToBaseN(bytes: Uint8Array, alphabet: string): string {
  if (!bytes.length) return ''
  const digits: number[] = []
  for (const byte of bytes) { let carry = byte; for (let i = 0; i < digits.length; i++) { const value = digits[i]! * 256 + carry; digits[i] = value % alphabet.length; carry = Math.floor(value / alphabet.length) }; while (carry) { digits.push(carry % alphabet.length); carry = Math.floor(carry / alphabet.length) } }
  let out = ''; for (const byte of bytes) { if (byte !== 0) break; out += alphabet[0] }; for (let i = digits.length - 1; i >= 0; i--) out += alphabet[digits[i]]
  return out
}
function baseNToBytes(input: string, alphabet: string, error: string): Uint8Array {
  const clean = input.trim(); if (!clean) return new Uint8Array(); const digits: number[] = []
  for (const char of clean) { const value = alphabet.indexOf(char); if (value < 0) throw new Error(error); let carry = value; for (let i = 0; i < digits.length; i++) { const next = digits[i]! * alphabet.length + carry; digits[i] = next & 255; carry = Math.floor(next / 256) }; while (carry) { digits.push(carry & 255); carry = Math.floor(carry / 256) } }
  const out: number[] = []; for (const char of clean) { if (char !== alphabet[0]) break; out.push(0) }; for (let i = digits.length - 1; i >= 0; i--) out.push(digits[i]!)
  return new Uint8Array(out)
}
function bytesToAscii85(bytes: Uint8Array): string {
  let out = ''; for (let off = 0; off < bytes.length; off += 4) { const count = Math.min(4, bytes.length - off); let value = 0; for (let i = 0; i < 4; i++) value = value * 256 + (i < count ? bytes[off + i]! : 0); if (count === 4 && value === 0) { out += 'z'; continue }; const chars = new Array(5); for (let i = 4; i >= 0; i--) { chars[i] = String.fromCharCode(33 + (value % 85)); value = Math.floor(value / 85) }; out += chars.slice(0, count + 1).join('') }
  return out
}
function ascii85ToBytes(input: string): Uint8Array {
  let clean = input.trim(); if (clean.startsWith('<~') || clean.endsWith('~>')) { if (!clean.startsWith('<~') || !clean.endsWith('~>')) throw new Error('errors.badAscii85'); clean = clean.slice(2, -2) }; clean = clean.replace(/\s/g, '')
  const out: number[] = []; const flush = (part: string, count: number) => { let value = 0; for (const char of part.padEnd(5, 'u')) { const digit = char.charCodeAt(0) - 33; if (digit < 0 || digit > 84) throw new Error('errors.badAscii85'); value = value * 85 + digit }; for (let i = 3; i >= 0; i--) out.push(Math.floor(value / 256 ** i) % 256); if (count < 5) out.splice(out.length - (5 - count), 5 - count) }
  let group = ''; for (const char of clean) { if (char === 'z') { if (group) throw new Error('errors.badAscii85'); out.push(0, 0, 0, 0) } else { group += char; if (group.length === 5) { flush(group, 5); group = '' } } }; if (group.length === 1) throw new Error('errors.badAscii85'); if (group) flush(group, group.length)
  return new Uint8Array(out)
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
      { id: 'base32-encode', icon: 'i-lucide-hash', reverseId: 'base32-decode', run: (s) => bytesToBase32(enc.encode(s)) },
      { id: 'base32-decode', icon: 'i-lucide-hash', reverseId: 'base32-encode', run: (s) => dec.decode(base32ToBytes(s)) },
      { id: 'base36-encode', icon: 'i-lucide-hash', reverseId: 'base36-decode', run: (s) => bytesToBaseN(enc.encode(s), BASE36_ALPHABET) },
      { id: 'base36-decode', icon: 'i-lucide-hash', reverseId: 'base36-encode', run: (s) => dec.decode(baseNToBytes(s, BASE36_ALPHABET, 'errors.badBase36')) },
      { id: 'base62-encode', icon: 'i-lucide-hash', reverseId: 'base62-decode', run: (s) => bytesToBaseN(enc.encode(s), BASE62_ALPHABET) },
      { id: 'base62-decode', icon: 'i-lucide-hash', reverseId: 'base62-encode', run: (s) => dec.decode(baseNToBytes(s, BASE62_ALPHABET, 'errors.badBase62')) },
      { id: 'ascii85-encode', icon: 'i-lucide-hash', reverseId: 'ascii85-decode', run: (s) => bytesToAscii85(enc.encode(s)) },
      { id: 'ascii85-decode', icon: 'i-lucide-hash', reverseId: 'ascii85-encode', run: (s) => dec.decode(ascii85ToBytes(s)) },
      { id: 'hex-encode', icon: 'i-lucide-hash', reverseId: 'hex-decode', run: (s) => bytesToHex(enc.encode(s)) },
      { id: 'hex-decode', icon: 'i-lucide-hash', reverseId: 'hex-encode', run: (s) => dec.decode(hexToBytes(s)) },
      { id: 'ihex-decode', icon: 'i-lucide-cpu', reverseId: 'ihex-encode', run: ihexDecode },
      { id: 'ihex-encode', icon: 'i-lucide-cpu', reverseId: 'ihex-decode', run: ihexEncode },
      { id: 'url-encode', icon: 'i-lucide-link', reverseId: 'url-decode', run: (s) => encodeURIComponent(s) },
      { id: 'url-decode', icon: 'i-lucide-link', reverseId: 'url-encode', run: (s) => decodeURIComponent(s) },
      { id: 'idn-encode', icon: 'i-lucide-globe', reverseId: 'idn-decode', run: (s) => mapIdn(s, false) },
      { id: 'idn-decode', icon: 'i-lucide-globe', reverseId: 'idn-encode', run: (s) => mapIdn(s, true) },
      { id: 'quoted-printable-encode', icon: 'i-lucide-mail', reverseId: 'quoted-printable-decode', run: quotedPrintableEncode },
      { id: 'quoted-printable-decode', icon: 'i-lucide-mail', reverseId: 'quoted-printable-encode', run: quotedPrintableDecode },
      { id: 'uuencode', icon: 'i-lucide-file-archive', reverseId: 'uudecode', run: uuencode },
      { id: 'uudecode', icon: 'i-lucide-file-archive', reverseId: 'uuencode', run: uudecode },
      { id: 'morse-encode', icon: 'i-lucide-radio', reverseId: 'morse-decode', run: morseEncode },
      { id: 'morse-decode', icon: 'i-lucide-radio', reverseId: 'morse-encode', run: morseDecode },
      { id: 'rot47', icon: 'i-lucide-rotate-ccw', reverseId: 'rot47', run: rot47 },
      { id: 'atbash', icon: 'i-lucide-shuffle', reverseId: 'atbash', run: atbash },
      { id: 'caesar-encode', icon: 'i-lucide-key-round', reverseId: 'caesar-decode', run: (s) => caesar(s, 3) },
      { id: 'caesar-decode', icon: 'i-lucide-key-round', reverseId: 'caesar-encode', run: (s) => caesar(s, -3) },
      { id: 'xor-encode', icon: 'i-lucide-key-round', reverseId: 'xor-decode', run: (s) => xorWithKey(s, false) },
      { id: 'xor-decode', icon: 'i-lucide-key-round', reverseId: 'xor-encode', run: (s) => xorWithKey(s, true) },
      { id: 'a1z26-encode', icon: 'i-lucide-list-1', reverseId: 'a1z26-decode', run: a1z26Encode },
      { id: 'a1z26-decode', icon: 'i-lucide-list-1', reverseId: 'a1z26-encode', run: a1z26Decode },
      { id: 'bacon-encode', icon: 'i-lucide-egg', reverseId: 'bacon-decode', run: baconEncode },
      { id: 'bacon-decode', icon: 'i-lucide-egg', reverseId: 'bacon-encode', run: baconDecode },
      { id: 'tap-code-encode', icon: 'i-lucide-grid-2x2', reverseId: 'tap-code-decode', run: tapEncode },
      { id: 'tap-code-decode', icon: 'i-lucide-grid-2x2', reverseId: 'tap-code-encode', run: tapDecode },
      { id: 'strip-diacritics', icon: 'i-lucide-eraser', run: stripDiacritics },
      { id: 'unfuck-paste', icon: 'i-lucide-wand-sparkles', run: unfuckPaste },
      { id: 'unix-to-iso', icon: 'i-lucide-clock-3', reverseId: 'iso-to-unix', run: unixToIso },
      { id: 'iso-to-unix', icon: 'i-lucide-clock-3', reverseId: 'unix-to-iso', run: isoToUnix },
      { id: 'mac-to-colon', icon: 'i-lucide-network', run: (s) => formatMac(s, 'colon') },
      { id: 'mac-to-dash', icon: 'i-lucide-network', run: (s) => formatMac(s, 'dash') },
      { id: 'mac-to-cisco', icon: 'i-lucide-network', run: (s) => formatMac(s, 'cisco') },
      { id: 'mac-to-plain', icon: 'i-lucide-network', run: (s) => formatMac(s, 'plain') },
      { id: 'hjson-to-json', icon: 'i-lucide-braces', reverseId: 'json-to-hjson', run: hjsonToJson },
      { id: 'json-to-hjson', icon: 'i-lucide-braces', reverseId: 'hjson-to-json', run: jsonToHjson },
      { id: 'bbcode-to-html', icon: 'i-lucide-code-2', run: bbcodeToHtml },
      { id: 'csv-to-markdown', icon: 'i-lucide-table', run: (s) => markdownTable(s, ',') },
      { id: 'tsv-to-markdown', icon: 'i-lucide-table', run: (s) => markdownTable(s, '\t') },
      { id: 'properties-to-json', icon: 'i-lucide-file-cog', reverseId: 'json-to-properties', run: (s) => JSON.stringify(propertiesParse(s), null, 2) },
      { id: 'json-to-properties', icon: 'i-lucide-file-cog', reverseId: 'properties-to-json', run: jsonToProperties },
      { id: 'env-to-json', icon: 'i-lucide-file-cog', reverseId: 'json-to-env', run: (s) => JSON.stringify(envParse(s), null, 2) },
      { id: 'json-to-env', icon: 'i-lucide-file-cog', reverseId: 'env-to-json', run: jsonToEnv },
      { id: 'stego-encode', icon: 'i-lucide-eye-off', reverseId: 'stego-decode', run: stegoEncode },
      { id: 'stego-decode', icon: 'i-lucide-eye-off', reverseId: 'stego-encode', run: stegoDecode },
      { id: 'sort-lines', icon: 'i-lucide-arrow-down-a-z', run: sortLines },
      { id: 'dedupe-lines', icon: 'i-lucide-list-x', run: dedupeLines },
      { id: 'shuffle-lines', icon: 'i-lucide-shuffle', run: shuffleLines },
      { id: 'number-lines', icon: 'i-lucide-list-1', run: numberLines },
      { id: 'wrap-text', icon: 'i-lucide-wrap-text', run: wrapText },
      { id: 'number-base-convert', icon: 'i-lucide-calculator', run: convertNumberBase },
      { id: 'iso-duration-to-seconds', icon: 'i-lucide-timer', reverseId: 'seconds-to-iso-duration', run: isoDurationToSeconds },
      { id: 'seconds-to-iso-duration', icon: 'i-lucide-timer', reverseId: 'iso-duration-to-seconds', run: secondsToIsoDuration },
      { id: 'hex-to-rgb', icon: 'i-lucide-palette', reverseId: 'rgb-to-hex', run: (s) => formatRgb(parseHexColor(s)) },
      { id: 'rgb-to-hex', icon: 'i-lucide-palette', reverseId: 'hex-to-rgb', run: (s) => formatHex(parseRgbColor(s)) },
      { id: 'rgb-to-hsl', icon: 'i-lucide-palette', reverseId: 'hsl-to-rgb', run: (s) => formatHsl(rgbToHsl(parseRgbColor(s))) },
      { id: 'hsl-to-rgb', icon: 'i-lucide-palette', reverseId: 'rgb-to-hsl', run: (s) => formatRgb(hslToRgb(parseHslColor(s))) },
      { id: 'hex-to-hsl', icon: 'i-lucide-palette', reverseId: 'hsl-to-hex', run: (s) => formatHsl(rgbToHsl(parseHexColor(s))) },
      { id: 'hsl-to-hex', icon: 'i-lucide-palette', reverseId: 'hex-to-hsl', run: (s) => formatHex(hslToRgb(parseHslColor(s))) },
      { id: 'roman-to-arabic', icon: 'i-lucide-sigma', reverseId: 'arabic-to-roman', run: romanToArabic },
      { id: 'arabic-to-roman', icon: 'i-lucide-sigma', reverseId: 'roman-to-arabic', run: arabicToRoman },
      { id: 'jwt-decode', icon: 'i-lucide-key-round', run: jwtDecode },
      { id: 'glob-to-regex', icon: 'i-lucide-regex', reverseId: 'regex-to-glob', run: globToRegex },
      { id: 'regex-to-glob', icon: 'i-lucide-regex', reverseId: 'glob-to-regex', run: regexToGlob },
      { id: 'c-escape-encode', icon: 'i-lucide-code', reverseId: 'c-escape-decode', run: cEscapeEncode },
      { id: 'c-escape-decode', icon: 'i-lucide-code', reverseId: 'c-escape-encode', run: cEscapeDecode },
      { id: 'shell-quote', icon: 'i-lucide-terminal', reverseId: 'argv-split', run: shellQuote },
      { id: 'argv-split', icon: 'i-lucide-terminal', reverseId: 'shell-quote', run: argvSplit },
      { id: 'windows-to-posix', icon: 'i-lucide-folder-symlink', reverseId: 'posix-to-windows', run: windowsToPosix },
      { id: 'posix-to-windows', icon: 'i-lucide-folder-symlink', reverseId: 'windows-to-posix', run: posixToWindows },
      { id: 'json-to-typescript', icon: 'i-lucide-file-type-2', run: jsonToTypescript },
      { id: 'ebcdic-encode', icon: 'i-lucide-server', reverseId: 'ebcdic-decode', run: ebcdicEncode },
      { id: 'ebcdic-decode', icon: 'i-lucide-server', reverseId: 'ebcdic-encode', run: ebcdicDecode },
      { id: 'baudot-encode', icon: 'i-lucide-radio-tower', reverseId: 'baudot-decode', run: baudotEncode },
      { id: 'baudot-decode', icon: 'i-lucide-radio-tower', reverseId: 'baudot-encode', run: baudotDecode },
      { id: 'fullwidth-to-halfwidth', icon: 'i-lucide-text-cursor', reverseId: 'halfwidth-to-fullwidth', run: fullwidthToHalfwidth },
      { id: 'halfwidth-to-fullwidth', icon: 'i-lucide-text-cursor', reverseId: 'fullwidth-to-halfwidth', run: halfwidthToFullwidth },
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
      { id: 'zalgo-add', icon: 'i-lucide-skull', reverseId: 'zalgo-remove', run: zalgoAdd },
      { id: 'zalgo-remove', icon: 'i-lucide-eraser', reverseId: 'zalgo-add', run: zalgoRemove },
      { id: 'slugify', icon: 'i-lucide-link', run: slugify },
      { id: 'luhn-check', icon: 'i-lucide-shield-check', run: (s) => checksumResult(luhnValid(s), (key) => CHECKSUMS_EN[key] ?? key), runL: (s, t) => checksumResult(luhnValid(s), t) },
      { id: 'inn-check', icon: 'i-lucide-shield-check', run: (s) => checksumResult(innValid(s), (key) => CHECKSUMS_EN[key] ?? key), runL: (s, t) => checksumResult(innValid(s), t) },
      { id: 'isbn-check', icon: 'i-lucide-book-open-check', run: (s) => checksumResult(isbnValid(s), (key) => CHECKSUMS_EN[key] ?? key), runL: (s, t) => checksumResult(isbnValid(s), t) },
      { id: 'ean-upc-check', icon: 'i-lucide-barcode', run: (s) => checksumResult(eanUpcValid(s), (key) => CHECKSUMS_EN[key] ?? key), runL: (s, t) => checksumResult(eanUpcValid(s), t) },
      { id: 'crc32', icon: 'i-lucide-hash', run: crc32 },
      { id: 'iban-format', icon: 'i-lucide-landmark', reverseId: 'iban-validate', run: ibanFormat },
      { id: 'iban-validate', icon: 'i-lucide-landmark', reverseId: 'iban-format', run: (s) => checksumResult(ibanValid(s), (key) => CHECKSUMS_EN[key] ?? key), runL: (s, t) => checksumResult(ibanValid(s), t) },
      { id: 'chmod-to-symbolic', icon: 'i-lucide-lock-keyhole', reverseId: 'symbolic-to-chmod', run: chmodToSymbolic },
      { id: 'symbolic-to-chmod', icon: 'i-lucide-lock-keyhole', reverseId: 'chmod-to-symbolic', run: symbolicToChmod },
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
      { name: 'Base32', icon: 'i-lucide-hash' },
      { name: 'Base36', icon: 'i-lucide-hash' },
      { name: 'Base62', icon: 'i-lucide-hash' },
      { name: 'Ascii85', icon: 'i-lucide-hash' },
      { name: 'Quoted-Printable', icon: 'i-lucide-mail' },
      { name: 'Uuencode', icon: 'i-lucide-file-archive' },
      { name: 'Punycode / IDN', icon: 'i-lucide-globe' },
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
      { name: 'Morse', icon: 'i-lucide-radio' },
      { name: 'ROT47', icon: 'i-lucide-rotate-ccw' },
      { name: 'Atbash', icon: 'i-lucide-shuffle' },
      { name: 'A1Z26', icon: 'i-lucide-list-1' },
      { name: 'Bacon', icon: 'i-lucide-egg' },
      { name: 'Tap code', icon: 'i-lucide-grid-2x2' },
      { name: 'Zero-width steganography', icon: 'i-lucide-eye-off' },
      { name: 'Line tools', icon: 'i-lucide-list' },
      { name: 'Base converter', icon: 'i-lucide-calculator' },
      { name: 'ISO duration', icon: 'i-lucide-timer' },
      { name: 'EBCDIC', icon: 'i-lucide-server' },
      { name: 'Baudot / ITA2', icon: 'i-lucide-radio-tower' },
      { name: 'Full-width / Half-width', icon: 'i-lucide-text-cursor' },
      { name: 'Unix timestamp / ISO 8601', icon: 'i-lucide-clock-3' },
      { name: 'MAC address', icon: 'i-lucide-network' },
      { name: 'HEX / RGB / HSL', icon: 'i-lucide-palette' },
      { name: 'Roman numerals', icon: 'i-lucide-sigma' },
      { name: 'IBAN', icon: 'i-lucide-landmark' },
      { name: 'Chmod', icon: 'i-lucide-lock-keyhole' },
      { name: 'JWT', icon: 'i-lucide-key-round' },
      { name: 'Glob / regex', icon: 'i-lucide-regex' },
      { name: 'C escapes', icon: 'i-lucide-code' },
      { name: 'Shell quoting', icon: 'i-lucide-terminal' },
      { name: 'Windows / POSIX paths', icon: 'i-lucide-folder-symlink' },
      { name: 'TypeScript interfaces', icon: 'i-lucide-file-type-2' },
      { name: 'Zalgo', icon: 'i-lucide-skull' },
      { name: 'Slugify', icon: 'i-lucide-link' },
      { name: 'Checksums', icon: 'i-lucide-shield-check' },
      { name: 'HJSON', icon: 'i-lucide-braces' },
      { name: 'BBCode', icon: 'i-lucide-code-2' },
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
  { value: 'bmp', label: 'BMP', mime: 'image/bmp', ext: 'bmp', icon: 'i-lucide-file-image' },
  { value: 'ppm', label: 'PPM', mime: 'image/x-portable-pixmap', ext: 'ppm', exts: ['pgm', 'pbm', 'pam'], icon: 'i-lucide-file-image' },
  { value: 'xbm', label: 'XBM', mime: 'image/x-xbitmap', ext: 'xbm', icon: 'i-lucide-file-image' },
  { value: 'wbmp', label: 'WBMP', mime: 'image/vnd.wap.wbmp', ext: 'wbmp', icon: 'i-lucide-file-image' },
  { value: 'tga', label: 'TGA', mime: 'image/x-tga', ext: 'tga', icon: 'i-lucide-file-image' },
  { value: 'pcx', label: 'PCX', mime: 'image/x-pcx', ext: 'pcx', icon: 'i-lucide-file-image' },
  { value: 'cur', label: 'CUR', mime: 'image/x-icon', ext: 'cur', icon: 'i-lucide-file-image' }
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
