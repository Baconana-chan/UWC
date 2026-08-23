/**
 * UWC — промежуточное представление (IR) для «данных»-конвертеров.
 *
 * Идея «IR-звезды» (решение в TODO.md, раздел 7): каждый текстовый формат данных —
 * модуль `parse → IrNode` / `serialize(IrNode) → string`, а любая пара форматов —
 * это `serialize_to(parse_from(x))`. N² пар ценой 2N модулей: INI↔TOML не требует
 * промежуточного шага ни в UI, ни в API — юзер выбирает «INI → TOML» напрямую.
 *
 * IrNode — JSON-совместимые значения + Date. Политика типизации (coerceScalar):
 * незакавыченные скаляры типизируем (как в TOML/YAML), закавыченные — строки.
 */

export type IrScalar = string | number | boolean | null | Date
export type IrNode = IrScalar | { [key: string]: IrNode } | IrNode[]

export interface IrFormat {
  /** id формата ('ini', 'csv', ...) — участвует в id пар */
  id: string
  /** парсинг исходника в IR; если нет — формат не может быть источником */
  parse?: (input: string) => IrNode
  /** сериализация IR в формат; если нет — формат не может быть целью */
  serialize?: (node: IrNode) => string
}

/** Политика типизации скаляров: незакавыченные типизируем, закавыченные — строки. */
export function coerceScalar(raw: string, quoted: boolean): IrNode {
  if (quoted) return raw
  const t = raw.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  // число — только «чистый» синтаксис: 0, 42, -3, 1.5, 1e10 (без 007 и 0x)
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  return raw
}

export function isPlainObject(v: unknown): v is Record<string, IrNode> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
}

/** Скаляр в строку (для сериализаторов без собственных типов, например CSV). */
export function scalarToString(v: IrScalar): string {
  if (v instanceof Date) return v.toISOString()
  if (v === null) return 'null'
  return String(v)
}

/** Готовый текстовый конвертер пары — структурно совместим с TextConverter из formats.ts. */
export interface IrPairConverter {
  id: string
  reverseId?: string
  icon: string
  run: (input: string) => string
}

export function makeIrPair(from: IrFormat, to: IrFormat): IrPairConverter {
  const parse = from.parse
  const serialize = to.serialize
  if (!parse || !serialize)
    throw new Error(`IR pair ${from.id}→${to.id}: missing parse/serialize`)
  return {
    id: `${from.id}-to-${to.id}`,
    // swap доступен, только если обратная пара реально реализована (есть парсер цели)
    reverseId: to.parse ? `${to.id}-to-${from.id}` : undefined,
    icon: 'i-lucide-arrow-right-left',
    run: (input) => serialize(parse(input))
  }
}
