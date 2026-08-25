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

import { md5Digest, passwordAnalysis, passwordAnalysisText, sha1Digest, type TranslateFn } from './formats'

export type GeneratorId = 'password' | 'passphrase' | 'hex' | 'base64' | 'apikey' | 'nanoid' | 'password-analyze' | 'lorem' | 'fake-data' | 'jwt-sign' | 'dice' | 'coin' | 'random-choice' | 'snowflake' | 'snowflake-decode' | 'uuid-v1' | 'uuid-v3' | 'uuid-v4' | 'uuid-v5' | 'uuid-v6' | 'uuid-v7' | 'uuid-v8' | 'ulid' | 'ksuid' | 'number'

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
  password: string
  /** JWT HS256 */
  secret: string
  payload: string
  choices: string
  input: string
  snowflakeEpoch: 'twitter' | 'discord'
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
    password?: boolean
    secret?: boolean
    payload?: boolean
    choices?: boolean
    input?: boolean
    snowflakeEpoch?: boolean
  }
  generate: (opts: GeneratorOptions) => string | Promise<string>
  generateL?: (opts: GeneratorOptions, t: TranslateFn) => string | Promise<string>
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

const LOREM_EN = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat, nibh at posuere luctus, justo sem blandit urna, vitae consequat nisl arcu vel erat.',
  'Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Donec sed odio dui. Nullam id dolor id nibh ultricies vehicula ut id elit.',
  'Curabitur blandit tempus porttitor. Aenean lacinia bibendum nulla sed consectetur. Maecenas faucibus mollis interdum, donec ullamcorper nulla non metus auctor fringilla.'
]
const LOREM_RU = [
  'Далеко-далеко за словесными горами в стране гласных и согласных живут рыбные тексты. Снова взгляд, речью продолжил путь, однажды большой дом.',
  'Разнообразный текст помогает проверить макет, переносы и длину строк. Пусть данные выглядят естественно, но не содержат настоящей личной информации.',
  'Небольшой демонстрационный абзац для прототипов и тестовых страниц. Здесь достаточно слов, чтобы увидеть интервалы, ритм и работу типографики.'
]
const FAKE_NAMES_EN = ['Alice Johnson', 'Ben Carter', 'Chloe Smith', 'Daniel Brown', 'Eva Wilson', 'Frank Miller']
const FAKE_NAMES_RU = ['Анна Иванова', 'Борис Петров', 'Вера Смирнова', 'Дмитрий Волков', 'Елена Соколова', 'Илья Кузнецов']
const CYRILLIC_EMAIL_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

function fakeEmailLocalPart(name: string): string {
  return [...name.toLowerCase()].map((char) => CYRILLIC_EMAIL_MAP[char] ?? char).join('')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
}

function generateLorem(opts: GeneratorOptions): string {
  const source = opts.lang === 'ru' ? LOREM_RU : LOREM_EN
  return Array.from({ length: Math.max(1, Math.floor(opts.length)) }, () => pick(source)).join('\n\n')
}

function generateFakeData(opts: GeneratorOptions): string {
  const names = opts.lang === 'ru' ? FAKE_NAMES_RU : FAKE_NAMES_EN
  return Array.from({ length: Math.max(1, Math.floor(opts.length)) }, () => {
    const name = pick(names)
    const email = fakeEmailLocalPart(name)
    return `${name} <${email}@example.com>`
  }).join('\n')
}

function generateDice(opts: GeneratorOptions): string {
  return Array.from({ length: Math.max(1, Math.floor(opts.length)) }, () => String(randomInt(6) + 1)).join(', ')
}

function generateCoin(opts: GeneratorOptions): string {
  return Array.from({ length: Math.max(1, Math.floor(opts.length)) }, () => randomInt(2) === 0 ? 'heads' : 'tails').join(', ')
}

function generateRandomChoice(opts: GeneratorOptions): string {
  const choices = opts.choices.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean)
  if (!choices.length) throw new Error('gen.errors.noChoices')
  return pick(choices)
}

const SNOWFLAKE_EPOCHS = {
  twitter: 1_288_834_974_657,
  discord: 1_420_070_400_000
} as const

function snowflakeEpoch(opts: GeneratorOptions): bigint {
  return BigInt(SNOWFLAKE_EPOCHS[opts.snowflakeEpoch || 'twitter'])
}

function generateSnowflake(opts: GeneratorOptions): string {
  const timestamp = BigInt(Date.now()) - snowflakeEpoch(opts)
  if (timestamp < 0n || timestamp >= (1n << 41n)) throw new Error('gen.errors.snowflakeTime')
  const worker = BigInt(randomInt(1024))
  const sequence = BigInt(randomInt(4096))
  return String((timestamp << 22n) | (worker << 12n) | sequence)
}

function decodeSnowflake(opts: GeneratorOptions): string {
  const value = opts.input.trim()
  if (!/^\d+$/.test(value)) throw new Error('gen.errors.badSnowflake')
  const id = BigInt(value)
  if (id < 0n || id >= (1n << 63n)) throw new Error('gen.errors.badSnowflake')
  const timestamp = Number((id >> 22n) + snowflakeEpoch(opts))
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) throw new Error('gen.errors.badSnowflake')
  return JSON.stringify({
    id: value,
    timestamp,
    iso: date.toISOString(),
    worker: Number((id >> 12n) & 0x3ffn),
    sequence: Number(id & 0xfffn)
  }, null, 2)
}

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
const NANOID_ALPHABET = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

function generateNanoid(length: number): string {
  let result = ''
  while (result.length < length) result += NANOID_ALPHABET[randomInt(NANOID_ALPHABET.length)]
  return result
}

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

const KSUID_EPOCH = 1_400_000_000
const KSUID_BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function encodeKsuidBase62(value: bigint): string {
  let result = ''
  while (value > 0n) { result = KSUID_BASE62[Number(value % 62n)]! + result; value /= 62n }
  return result.padStart(27, '0')
}

function generateKsuid(): string {
  const bytes = new Uint8Array(20)
  const timestamp = Math.floor(Date.now() / 1000) - KSUID_EPOCH
  if (timestamp < 0 || timestamp > 0xffff_ffff) throw new Error('gen.errors.ksuidTime')
  bytes[0] = (timestamp >>> 24) & 255
  bytes[1] = (timestamp >>> 16) & 255
  bytes[2] = (timestamp >>> 8) & 255
  bytes[3] = timestamp & 255
  bytes.set(randomBytes(16), 4)
  return encodeKsuidBase62(bytesToBigInt(bytes))
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

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function generateJwtHs256(opts: GeneratorOptions): Promise<string> {
  const secret = opts.secret.trim()
  if (!secret) throw new Error('gen.errors.noSecret')
  let payload: unknown
  try { payload = JSON.parse(opts.payload || '{}') } catch { throw new Error('gen.errors.badPayload') }
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64Url(enc.encode(JSON.stringify(header)))
  const encodedPayload = base64Url(enc.encode(JSON.stringify(payload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signingInput)))
  return `${signingInput}.${base64Url(signature)}`
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
    id: 'nanoid',
    icon: 'i-lucide-fingerprint',
    controls: {
      length: { labelKey: 'gen.controls.length', min: 8, max: 64 }
    },
    generate(opts) {
      return generateNanoid(opts.length)
    },
    entropyBits(opts) {
      return Math.round(opts.length * Math.log2(64))
    }
  },
  {
    id: 'password-analyze',
    icon: 'i-lucide-shield-check',
    controls: { password: true },
    generate(opts) {
      if (!opts.password) throw new Error('gen.errors.noPassword')
      return passwordAnalysisText(opts.password)
    },
    generateL(opts, t) {
      if (!opts.password) throw new Error('gen.errors.noPassword')
      return passwordAnalysis(opts.password, t)
    },
    entropyBits() {
      return null
    }
  },
  {
    id: 'lorem',
    icon: 'i-lucide-align-left',
    controls: {
      length: { labelKey: 'gen.controls.items', min: 1, max: 10 }
    },
    generate(opts) {
      return generateLorem(opts)
    },
    entropyBits() {
      return null
    }
  },
  {
    id: 'fake-data',
    icon: 'i-lucide-contact-round',
    controls: {
      length: { labelKey: 'gen.controls.items', min: 1, max: 20 }
    },
    generate(opts) {
      return generateFakeData(opts)
    },
    entropyBits() {
      return null
    }
  },
  {
    id: 'jwt-sign',
    icon: 'i-lucide-key-round',
    controls: {
      secret: true,
      payload: true
    },
    generate(opts) {
      return generateJwtHs256(opts)
    },
    entropyBits() {
      return null
    }
  },
  {
    id: 'dice',
    icon: 'i-lucide-dices',
    controls: {
      length: { labelKey: 'gen.controls.rolls', min: 1, max: 20 }
    },
    generate(opts) {
      return generateDice(opts)
    },
    entropyBits() {
      return null
    }
  },
  {
    id: 'coin',
    icon: 'i-lucide-circle-dollar-sign',
    controls: {
      length: { labelKey: 'gen.controls.flips', min: 1, max: 20 }
    },
    generate(opts) {
      return generateCoin(opts)
    },
    generateL(opts, t) {
      return generateCoin(opts).split(', ').map((side) => t(`gen.coin.${side}`)).join(', ')
    },
    entropyBits() {
      return null
    }
  },
  {
    id: 'random-choice',
    icon: 'i-lucide-list-checks',
    controls: {
      choices: true
    },
    generate(opts) {
      return generateRandomChoice(opts)
    },
    entropyBits(opts) {
      const count = opts.choices.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean).length
      return count > 1 ? Math.log2(count) : null
    }
  },
  {
    id: 'snowflake',
    icon: 'i-lucide-snowflake',
    controls: {
      snowflakeEpoch: true
    },
    generate(opts) {
      return generateSnowflake(opts)
    },
    entropyBits() {
      return 22
    }
  },
  {
    id: 'snowflake-decode',
    icon: 'i-lucide-clock-3',
    controls: {
      input: true,
      snowflakeEpoch: true
    },
    generate(opts) {
      return decodeSnowflake(opts)
    },
    entropyBits() {
      return null
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
    id: 'ksuid',
    icon: 'i-lucide-timer',
    controls: {},
    generate() {
      return generateKsuid()
    },
    entropyBits() {
      return 128
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
