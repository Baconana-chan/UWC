/**
 * UWC — генератор секретов и случайностей.
 *
 * Всё крутится на WebCrypto `crypto.getRandomValues` — настоящий CSPRNG,
 * никакого Math.random(). Выполняется в браузере, сервер не участвует.
 *
 * ВАЖНО: реестр языконезависим. Подписи/описания резолвятся по ключам
 * `gen.defs.${id}.label` / `.description`, ошибки выбрасываются как ключи
 * (`gen.errors.*`), компонент делает t(message). Словарь парольных фраз
 * выбирается по `opts.lang` ('en' | 'ru').
 *
 * MD5/SHA-1 (для UUID v3/v5) — синхронные реализации из `formats.ts`,
 * т.к. WebCrypto асинхронный, а генератор синхронный.
 */

import { md5Digest, sha1Digest } from './formats'

export type GeneratorId = 'password' | 'passphrase' | 'hex' | 'base64' | 'apikey' | 'uuid-v1' | 'uuid-v3' | 'uuid-v4' | 'uuid-v5' | 'uuid-v6' | 'uuid-v7' | 'uuid-v8' | 'ulid' | 'number'

/** Стандартные namespace RFC 4122 для name-based UUID (v3/v5). */
export const UUID_NAMESPACES = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8'
} as const

export type UuidNamespace = keyof typeof UUID_NAMESPACES

export interface GeneratorOptions {
  /** длина (пароль: символов, hex/base64: байт, apikey: символов) */
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
  excludeAmbiguous: boolean
  /** парольная фраза */
  wordCount: number
  separator: string
  /** api-ключ */
  prefix: string
  /** случайное число */
  min: number
  max: number
  /** имя для name-based UUID (v3/v5) */
  name: string
  /** namespace для name-based UUID (v3/v5) */
  namespace: UuidNamespace
  /** язык словаря парольной фразы */
  lang: 'en' | 'ru'
}

export interface GeneratorDef {
  id: GeneratorId
  icon: string
  /** какие контролы показывать в UI */
  controls: {
    length?: { labelKey: string; min: number; max: number; step?: number }
    sets?: boolean
    wordCount?: { labelKey: string; min: number; max: number }
    separator?: boolean
    prefix?: boolean
    range?: boolean
    /** текстовое поле «имя» для name-based UUID */
    name?: boolean
    /** селект namespace для name-based UUID */
    namespace?: boolean
  }
  generate: (opts: GeneratorOptions) => string
  /** энтропия в битах; null — если посчитать нельзя */
  entropyBits: (opts: GeneratorOptions, result: string) => number | null
}

/* ------------------------------------------------------------------ */
/* CSPRNG-примитивы                                                    */
/* ------------------------------------------------------------------ */

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return bytes
}

/** равномерный int из [0, maxExclusive) через rejection sampling */
function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0)
    throw new Error('gen.errors.badRange')
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0]! >= limit)
  return buf[0]! % maxExclusive
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)]!
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~'
} as const

const AMBIGUOUS = '0O1lI|`\'"'

const WORDS_EN = [
  'apple', 'anchor', 'autumn', 'breeze', 'bridge', 'cabin', 'candle', 'canyon',
  'cherry', 'circle', 'cloud', 'comet', 'copper', 'cotton', 'crystal', 'dawn',
  'desert', 'diamond', 'dolphin', 'dragon', 'eclipse', 'ember', 'falcon', 'forest',
  'galaxy', 'garden', 'glacier', 'harbor', 'horizon', 'island', 'jungle', 'kettle',
  'lagoon', 'lantern', 'lemon', 'lily', 'marble', 'meadow', 'meteor', 'mirror',
  'mountain', 'needle', 'night', 'ocean', 'olive', 'orbit', 'palace', 'planet',
  'prairie', 'quartz', 'rainbow', 'river', 'rocket', 'summit', 'sunset', 'temple',
  'thunder', 'tiger', 'tulip', 'umbrella', 'velvet', 'violet', 'waterfall', 'willow',
  'winter', 'yellow', 'zebra'
]

const WORDS_RU = [
  'яблоко', 'арбуз', 'банан', 'вишня', 'дыня', 'ежевика', 'журавль', 'заяц',
  'ирис', 'камень', 'лодка', 'мышь', 'нитки', 'обелиск', 'парус', 'радуга',
  'сосна', 'туман', 'уголь', 'фонарь', 'хвоя', 'цирк', 'чашка', 'штора',
  'щука', 'эфир', 'юнга', 'янтарь', 'берег', 'ветер', 'гроза', 'дорога',
  'жемчуг', 'заря', 'костер', 'листва', 'молния', 'небо', 'осень', 'пламя',
  'река', 'солнце', 'туча', 'улица', 'фиалка', 'холм', 'цветок', 'шторм',
  'весна', 'зима', 'лето', 'осень', 'полночь', 'рассвет', 'закат', 'луна',
  'звезда', 'комета', 'галактика', 'планета', 'орбита', 'космос', 'метеор', 'астероид'
]

function base62(bytes: Uint8Array): string {
  const chars = SETS.lower + SETS.upper + SETS.digits
  let out = ''
  let value = 0
  let bits = 0
  for (const b of bytes) {
    value = value * 256 + b
    bits += 8
    while (bits >= 6) {
      bits -= 6
      out += chars[value >> bits]
      value &= (1 << bits) - 1
    }
  }
  if (bits > 0)
    out += chars[(value << (6 - bits)) & 63]
  return out
}

/* ------------------------------------------------------------------ */
/* ULID: 26 символов Crockford base32, 48-бит ms-таймстамп + 80 бит    */
/* случайности, лексикографически сортируемый (https://github.com/ulid/spec) */
/* ------------------------------------------------------------------ */

/** Алфавит Crockford base32 (без I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n
  for (const b of bytes)
    v = (v << 8n) | BigInt(b)
  return v
}

/** bigint → ровно `length` символов base32 (старшие биты первыми). */
function encodeBase32(value: bigint, length: number): string {
  let out = ''
  for (let i = length - 1; i >= 0; i--)
    out += CROCKFORD[Number((value >> BigInt(i * 5)) & 0x1fn)]!
  return out
}

// монотонность по спеке: в пределах одной миллисекунды random часть инкрементится,
// чтобы сохранялась лексикографическая сортировка; на переполнении ждём след. мс.
let ulidLastTs = -1
let ulidLastRand = 0n

function generateUlid(): string {
  const now = Date.now()
  if (now <= ulidLastTs) {
    ulidLastRand = (ulidLastRand + 1n) & ((1n << 80n) - 1n)
    if (ulidLastRand === 0n) {
      // переполнение 80 бит — практически невозможно, но по спеке ждём новую мс
      while (Date.now() === now) {
        /* busy-wait: не чаще одного раза за 2^80 генераций */
      }
      ulidLastTs = Date.now()
      ulidLastRand = bytesToBigInt(randomBytes(10))
    }
  }
  else {
    ulidLastTs = now
    ulidLastRand = bytesToBigInt(randomBytes(10))
  }
  return encodeBase32(BigInt(ulidLastTs), 10) + encodeBase32(ulidLastRand, 16)
}

/* ------------------------------------------------------------------ */
/* UUID: RFC 9562 (v1–v8)                                              */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder()

/** 16 байт → каноническая строка UUID. */
function uuidBytesToStr(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** 60-битный timestamp в 100-нс интервалах с 1582-10-15 (эпоха Григорианского календаря). */
function uuidTimestamp(): bigint {
  const GREGORIAN_OFFSET = 0x01b21dd213814000n // 100 нс между 1582-10-15 и 1970-01-01
  return BigInt(Date.now()) * 10000n + GREGORIAN_OFFSET
}

/** UUID v1/v6: clock sequence (14 бит) + variant + случайный node (48 бит). */
function uuidSeqAndNode(b: Uint8Array): void {
  const seq = randomBytes(2)
  b[8] = (seq[0]! & 0x3f) | 0x80
  b[9] = seq[1]!
  // node — случайный: MAC из браузера не достать (и не надо, это спалит адрес)
}

/** RFC 9562 §5.2 — v1: time_low | time_mid | time_hi+version | clock_seq | node. */
function uuidV1Bytes(): Uint8Array {
  const b = randomBytes(16)
  const t = uuidTimestamp()
  b[0] = Number(t & 0xffn)
  b[1] = Number((t >> 8n) & 0xffn)
  b[2] = Number((t >> 16n) & 0xffn)
  b[3] = Number((t >> 24n) & 0xffn)
  b[4] = Number((t >> 32n) & 0xffn)
  b[5] = Number((t >> 40n) & 0xffn)
  b[6] = 0x10 | Number((t >> 56n) & 0x0fn)
  b[7] = Number((t >> 48n) & 0xffn)
  uuidSeqAndNode(b)
  return b
}

/** RFC 9562 §5.6 — v6: те же поля, что у v1, но старшие биты времени идут первыми (сортируемость). */
function uuidV6Bytes(): Uint8Array {
  const b = randomBytes(16)
  const t = uuidTimestamp()
  b[0] = Number((t >> 52n) & 0xffn)
  b[1] = Number((t >> 44n) & 0xffn)
  b[2] = Number((t >> 36n) & 0xffn)
  b[3] = Number((t >> 28n) & 0xffn)
  b[4] = Number((t >> 20n) & 0xffn)
  b[5] = Number((t >> 12n) & 0xffn)
  b[6] = 0x60 | Number((t >> 8n) & 0x0fn)
  b[7] = Number(t & 0xffn)
  uuidSeqAndNode(b)
  return b
}

function uuidHexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '')
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++)
    b[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return b
}

/** RFC 4122 §4.3 — v3/v5: дайджест(namespace || name), версия/вариант выставляются после. */
function uuidNameBased(opts: GeneratorOptions, version: 3 | 5): string {
  const name = opts.name.trim()
  if (!name)
    throw new Error('gen.errors.noName')
  const ns = uuidHexToBytes(UUID_NAMESPACES[opts.namespace])
  const nameBytes = enc.encode(name)
  const input = new Uint8Array(16 + nameBytes.length)
  input.set(ns)
  input.set(nameBytes, 16)

  const digest = version === 3 ? md5Digest(input) : sha1Digest(input)
  const b = digest.slice(0, 16)
  b[6] = (b[6]! & 0x0f) | (version << 4)
  b[8] = (b[8]! & 0x3f) | 0x80
  return uuidBytesToStr(b)
}

/* ------------------------------------------------------------------ */
/* Реестр генераторов                                                  */
/* ------------------------------------------------------------------ */

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'password',
    icon: 'i-lucide-lock',
    controls: {
      length: { labelKey: 'gen.controls.length', min: 4, max: 128 },
      sets: true
    },
    generate(opts) {
      const sets: string[] = []
      if (opts.lowercase)
        sets.push(SETS.lower)
      if (opts.uppercase)
        sets.push(SETS.upper)
      if (opts.digits)
        sets.push(SETS.digits)
      if (opts.symbols)
        sets.push(SETS.symbols)

      if (!sets.length)
        throw new Error('gen.errors.noSets')

      const clean = sets.map((s) => opts.excludeAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join('') : s).filter((s) => s.length > 0)
      if (!clean.length)
        throw new Error('gen.errors.emptySets')

      const charset = clean.join('')
      // гарантируем минимум один символ из каждого выбранного набора
      const chars = clean.map((s) => pick(s))
      while (chars.length < opts.length)
        chars.push(pick(charset))
      return shuffle(chars.slice(0, opts.length)).join('')
    },
    entropyBits(opts) {
      let size = 0
      if (opts.lowercase)
        size += SETS.lower.length
      if (opts.uppercase)
        size += SETS.upper.length
      if (opts.digits)
        size += SETS.digits.length
      if (opts.symbols)
        size += SETS.symbols.length
      if (opts.excludeAmbiguous)
        size -= AMBIGUOUS.length
      return size > 0 ? Math.round(opts.length * Math.log2(size)) : null
    }
  },
  {
    id: 'passphrase',
    icon: 'i-lucide-whole-word',
    controls: {
      wordCount: { labelKey: 'gen.controls.words', min: 2, max: 12 },
      separator: true
    },
    generate(opts) {
      const words = opts.lang === 'ru' ? WORDS_RU : WORDS_EN
      return Array.from({ length: opts.wordCount }, () => pick(words)).join(opts.separator)
    },
    entropyBits(opts) {
      const words = opts.lang === 'ru' ? WORDS_RU : WORDS_EN
      return Math.round(opts.wordCount * Math.log2(words.length))
    }
  },
  {
    id: 'hex',
    icon: 'i-lucide-hash',
    controls: {
      length: { labelKey: 'gen.controls.bytes', min: 4, max: 64 }
    },
    generate(opts) {
      return [...randomBytes(opts.length)].map((b) => b.toString(16).padStart(2, '0')).join('')
    },
    entropyBits(opts) {
      return opts.length * 8
    }
  },
  {
    id: 'base64',
    icon: 'i-lucide-binary',
    controls: {
      length: { labelKey: 'gen.controls.bytes', min: 4, max: 64 }
    },
    generate(opts) {
      return bytesToBase64(randomBytes(opts.length))
    },
    entropyBits(opts) {
      return opts.length * 8
    }
  },
  {
    id: 'apikey',
    icon: 'i-lucide-key-round',
    controls: {
      prefix: true,
      length: { labelKey: 'gen.controls.lengthNoPrefix', min: 8, max: 96 }
    },
    generate(opts) {
      return opts.prefix + base62(randomBytes(Math.max(6, Math.ceil(opts.length * 3 / 4))))
    },
    entropyBits(opts) {
      return Math.round(opts.length * Math.log2(62))
    }
  },
  {
    id: 'uuid-v1',
    icon: 'i-lucide-id-card',
    controls: {},
    generate() {
      return uuidBytesToStr(uuidV1Bytes())
    },
    entropyBits() {
      return 62 // 48 бит node + 14 бит clock sequence
    }
  },
  {
    id: 'uuid-v3',
    icon: 'i-lucide-id-card',
    controls: {
      name: true,
      namespace: true
    },
    generate(opts) {
      return uuidNameBased(opts, 3)
    },
    entropyBits() {
      return null // детерминированный хеш от имени
    }
  },
  {
    id: 'uuid-v4',
    icon: 'i-lucide-id-card',
    controls: {},
    generate() {
      const b = randomBytes(16)
      b[6] = (b[6]! & 0x0f) | 0x40
      b[8] = (b[8]! & 0x3f) | 0x80
      return uuidBytesToStr(b)
    },
    entropyBits() {
      return 122
    }
  },
  {
    id: 'uuid-v5',
    icon: 'i-lucide-id-card',
    controls: {
      name: true,
      namespace: true
    },
    generate(opts) {
      return uuidNameBased(opts, 5)
    },
    entropyBits() {
      return null // детерминированный хеш от имени
    }
  },
  {
    id: 'uuid-v6',
    icon: 'i-lucide-id-card',
    controls: {},
    generate() {
      return uuidBytesToStr(uuidV6Bytes())
    },
    entropyBits() {
      return 62
    }
  },
  {
    id: 'uuid-v7',
    icon: 'i-lucide-id-card',
    controls: {},
    generate() {
      const b = randomBytes(16)
      const now = BigInt(Date.now())
      b[0] = Number((now >> 40n) & 0xffn)
      b[1] = Number((now >> 32n) & 0xffn)
      b[2] = Number((now >> 24n) & 0xffn)
      b[3] = Number((now >> 16n) & 0xffn)
      b[4] = Number((now >> 8n) & 0xffn)
      b[5] = Number(now & 0xffn)
      b[6] = (b[6]! & 0x0f) | 0x70
      b[8] = (b[8]! & 0x3f) | 0x80
      return uuidBytesToStr(b)
    },
    entropyBits() {
      return 74 // 12 бит rand_a + 62 бита rand_b
    }
  },
  {
    id: 'uuid-v8',
    icon: 'i-lucide-id-card',
    controls: {},
    generate() {
      const b = randomBytes(16)
      b[6] = (b[6]! & 0x0f) | 0x80
      b[8] = (b[8]! & 0x3f) | 0x80
      return uuidBytesToStr(b)
    },
    entropyBits() {
      return 122
    }
  },
  {
    id: 'ulid',
    icon: 'i-lucide-timer',
    controls: {},
    generate() {
      return generateUlid()
    },
    entropyBits() {
      return 80 // 80 бит случайности (48 бит таймстампа — не энтропия)
    }
  },
  {
    id: 'number',
    icon: 'i-lucide-calculator',
    controls: {
      range: true
    },
    generate(opts) {
      let min = Math.floor(opts.min)
      let max = Math.floor(opts.max)
      if (Number.isNaN(min) || Number.isNaN(max))
        throw new Error('gen.errors.nanRange')
      if (min > max) {
        const tmp = min
        min = max
        max = tmp
      }
      const span = max - min + 1
      if (span <= 0 || span > 0x1_0000_0000)
        throw new Error('gen.errors.rangeTooBig')
      return String(min + randomInt(span))
    },
    entropyBits(opts) {
      const span = Math.floor(opts.max) - Math.floor(opts.min) + 1
      return span > 1 ? Math.round(Math.log2(span)) : null
    }
  }
]

export function getGenerator(id: GeneratorId): GeneratorDef | undefined {
  return GENERATORS.find((g) => g.id === id)
}

/* ------------------------------------------------------------------ */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++)
    bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
