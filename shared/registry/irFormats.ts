/**
 * UWC — IR-форматы данных (эшелон 1 «быстрых побед» уровня B, клиент).
 *
 * Каждый формат — модуль `parse`/`serialize` над общим IrNode (см. ir.ts).
 * Формат без `parse` — «только цель» (JSON → YAML/TOML), без `serialize` — «только источник».
 * Пары генерируются через makeIrPair в formats.ts — новых конвертеров писать не нужно:
 * INI↔TOML это `serializeToml(parseIni(x))`, промежуточный JSON невидим.
 */

import { coerceScalar, isPlainObject, scalarToString, type IrFormat, type IrNode, type IrScalar } from './ir'
import { parseDelimited, serializeDelimited } from './delimited'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

export const IR_FORMATS: IrFormat[] = [
  {
    id: 'json',
    parse: (input) => JSON.parse(input) as IrNode,
    serialize: (node) => JSON.stringify(node, null, 2)
  },
  {
    id: 'ini',
    parse: parseIni,
    serialize: serializeIni
  },
  {
    id: 'csv',
    parse: (input) => parseDelimited(input, ',') as unknown as IrNode,
    serialize: serializeCsv
  },
  {
    id: 'yaml',
    parse: parseYaml,
    serialize: serializeYaml
  },
  {
    id: 'toml',
    parse: parseToml,
    serialize: serializeToml
  },
  {
    id: 'xml',
    parse: parseXml,
    serialize: serializeXml
  },
  {
    id: 'vcard',
    parse: parseVCard,
    serialize: serializeVCard
  },
  {
    id: 'ical',
    parse: parseICal,
    serialize: serializeICal
  },
  {
    id: 'geojson',
    parse: parseGeoJSON,
    serialize: serializeGeoJSON
  },
  {
    id: 'kml',
    parse: parseKML,
    serialize: serializeKML
  },
  {
    id: 'gpx',
    parse: parseGPX,
    serialize: serializeGPX
  }
]

/* ------------------------------ INI ------------------------------ */

function parseIni(input: string): IrNode {
  const root: Record<string, IrNode> = {}
  let section = root
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      section = {}
      root[sectionMatch[1]!.trim()] = section
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (!key) continue
    let quoted = false
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
      quoted = true
    }
    section[key] = coerceScalar(value, quoted)
  }
  return root
}

function iniScalar(v: IrNode): string {
  if (typeof v === 'string') {
    // значение с пробелами/спецсимволами ИЛИ похожее на число/bool/null — в кавычки,
    // иначе round-trip потеряет тип: quoted = "3" → 3 (см. coerceScalar)
    return /[\s=;#"]/.test(v) || v === '' || /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)$/.test(v)
      ? `"${v.replace(/"/g, '\\"')}"`
      : v
  }
  return scalarToString(v as IrScalar)
}

function serializeIni(node: IrNode): string {
  const lines: string[] = []
  const root = node as Record<string, IrNode>
  for (const [key, value] of Object.entries(root)) {
    if (isPlainObject(value)) {
      lines.push(`[${key}]`)
      for (const [k, v] of Object.entries(value)) {
        lines.push(isPlainObject(v) || Array.isArray(v) ? `${k} = ${JSON.stringify(v)}` : `${k} = ${iniScalar(v)}`)
      }
    }
    else {
      lines.push(`${key} = ${Array.isArray(value) ? JSON.stringify(value) : iniScalar(value)}`)
    }
  }
  return lines.join('\n')
}

/* ------------------------------ CSV ------------------------------ */

function serializeCsv(node: IrNode): string {
  if (!Array.isArray(node)) throw new Error('studio.errors.convFailed')
  // массив объектов → первая строка = заголовки (классика CSV ↔ JSON «с заголовками»)
  if (node.length > 0 && isPlainObject(node[0])) {
    const headers = Object.keys(node[0] as Record<string, IrNode>)
    const rows = node.map((row) => headers.map((h) => scalarToString((row as Record<string, IrNode>)[h] ?? '')))
    return serializeDelimited([headers, ...rows], ',')
  }
  return serializeDelimited(node.map((row) => (row as IrNode[]).map(scalarToString)), ',')
}

/* ---------------------- YAML (только сериализация) ---------------------- */

function yamlScalar(v: IrNode): string {
  if (typeof v === 'string') {
    if (v === '') return "''"
    const trimmed = v.trim()
    if (trimmed !== v || /[:#[]{},&*!|>'"%@`]/.test(v)
      || /^(true|false|null|~|[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)$/.test(trimmed)) {
      return JSON.stringify(v)
    }
    return v
  }
  if (v === null) return 'null'
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  return String(v)
}

function writeYaml(node: IrNode, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent)
  if (Array.isArray(node)) {
    for (const item of node) {
      if (isPlainObject(item)) {
        const entries = Object.entries(item)
        if (entries.length === 0) {
          out.push(`${pad}- {}`)
          continue
        }
        const [firstKey, firstValue] = entries[0]!
        const nested = isPlainObject(firstValue) || Array.isArray(firstValue)
        out.push(`${pad}- ${firstKey}:${nested ? '' : ` ${yamlScalar(firstValue)}`}`)
        if (nested) writeYaml(firstValue, indent + 2, out)
        for (const [k, v] of entries.slice(1)) {
          if (isPlainObject(v) || Array.isArray(v)) {
            out.push(`${pad}  ${k}:`)
            writeYaml(v, indent + 2, out)
          }
          else {
            out.push(`${pad}  ${k}: ${yamlScalar(v)}`)
          }
        }
      }
      else if (Array.isArray(item)) {
        out.push(`${pad}-`)
        writeYaml(item, indent + 1, out)
      }
      else {
        out.push(`${pad}- ${yamlScalar(item)}`)
      }
    }
  }
  else if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (isPlainObject(v) || Array.isArray(v)) {
        out.push(`${pad}${k}:`)
        writeYaml(v, indent + 1, out)
      }
      else {
        out.push(`${pad}${k}: ${yamlScalar(v)}`)
      }
    }
  }
  else {
    out.push(`${pad}${yamlScalar(node)}`)
  }
}

function serializeYaml(node: IrNode): string {
  const out: string[] = []
  writeYaml(node, 0, out)
  return out.join('\n')
}

/* ---------------------- TOML (только сериализация) ---------------------- */

function tomlScalar(v: IrNode): string {
  if (Array.isArray(v)) return `[${v.map(tomlScalar).join(', ')}]`
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === null) return '""' // в TOML нет null — пустая строка
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function writeToml(node: IrNode, path: string, out: string[]): void {
  if (!isPlainObject(node)) {
    out.push(tomlScalar(node))
    return
  }
  const scalars: Array<[string, IrNode]> = []
  const tables: Array<[string, IrNode]> = []
  const arrays: Array<[string, IrNode]> = []
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v) && v.every(isPlainObject)) arrays.push([k, v])
    else if (isPlainObject(v)) tables.push([k, v])
    else scalars.push([k, v])
  }
  for (const [k, v] of scalars) {
    out.push(`${k} = ${Array.isArray(v) ? `[${v.map(tomlScalar).join(', ')}]` : tomlScalar(v)}`)
  }
  for (const [k, v] of arrays) {
    const p = path ? `${path}.${k}` : k
    for (const item of v as Record<string, IrNode>[]) {
      out.push(`[[${p}]]`)
      writeToml(item, p, out)
    }
  }
  for (const [k, v] of tables) {
    const p = path ? `${path}.${k}` : k
    out.push(`[${p}]`)
    writeToml(v, p, out)
  }
}

function serializeToml(node: IrNode): string {
  const out: string[] = []
  writeToml(node, '', out)
  return out.join('\n')
}

/* ---------------------- TOML (парсинг) ---------------------- */

/** TOML key: bare / "basic" / 'literal' */
function parseTomlKey(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') || t.startsWith("'")) return t.slice(1, -1)
  return t
}

/** TOML value: string / multi-line string / number / bool / datetime / array */
function parseTomlValue(s: string): IrNode {
  const t = s.trim()
  // basic string "..."
  if (t.startsWith('"')) {
    // basic multi-line """  — упрощённо: если начинается с """
    if (t.startsWith('"""')) return parseTomlBasicMulti(t)
    return parseTomlBasicString(t)
  }
  // literal string '...'
  if (t.startsWith("'")) {
    if (t.startsWith("'''")) return parseTomlLiteralMulti(t)
    return t.slice(1, -1)
  }
  // array [...]
  if (t.startsWith('[')) return parseTomlArray(t)
  // bool
  if (t === 'true' || t === 'false') return t === 'true'
  // number (int / float / negative)
  if (/^-?\d+$/.test(t)) return Number(t)
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(t) || /^-?\d+[eE][+-]?\d+$/.test(t)) return Number(t)
  // date-time / date / time
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(t))
    return new Date(t.replace(' ', 'T'))
  // fallback — строка
  return t
}

function parseTomlBasicString(s: string): string {
  // "key" = "value" → распарсить value
  // открывающая " уже съедена; закрывающая " — последняя
  const inner = s.slice(1, s.lastIndexOf('"'))
  return parseTomlEscapes(inner)
}

function parseTomlBasicMulti(s: string): string {
  // """ ... """: содержимое между первой """ и последней """
  const after = s.slice(3)
  const end = after.lastIndexOf('"""')
  const inner = end === -1 ? after : after.slice(0, end)
  // multi-line: leading newline после """ отбрасывается
  return parseTomlEscapes(inner.replace(/^\n/, ''))
}

function parseTomlLiteralMulti(s: string): string {
  const after = s.slice(3)
  const end = after.lastIndexOf("'''")
  return end === -1 ? after : after.slice(0, end)
}

/** Экранирует управляющие последовательности в basic-строках TOML. */
function parseTomlEscapes(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\\' && i + 1 < s.length) {
      const n = s[i + 1]!
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === 'r') out += '\r'
      else if (n === '"') out += '"'
      else if (n === '\\') out += '\\'
      else if (n === 'b') out += '\b'
      else if (n === 'f') out += '\f'
      else { out += n; i++ }
    }
    else out += ch
  }
  return out
}

/** Разбирает массив TOML [a, b, c] (включая вложенные). */
function parseTomlArray(s: string): IrNode[] {
  const inner = s.slice(1, s.lastIndexOf(']')).trim()
  if (!inner) return []
  const items = splitTomlArray(inner)
  return items.map((item) => parseTomlValue(item))
}

/** Разбивает массив по запятым верхнего уровня (кавычки/скобки уважаются). */
function splitTomlArray(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: '"' | "'" | null = null
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quote) {
      cur += ch
      if (ch === '\\' && quote === '"') { cur += s[i + 1] ?? ''; i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '[') { depth++; cur += ch; continue }
    if (ch === ']') { depth--; cur += ch; continue }
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() || parts.length === 0) parts.push(cur.trim())
  return parts.filter((p) => p !== '')
}

/** Парсинг TOML в IrNode. Поддерживает: key=value, [table], [[array-of-tables]], комментарии, строки, числа, bool, datetime, массивы. */
function parseToml(input: string): IrNode {
  try {
    const root: Record<string, IrNode> = {}
    const tables: Record<string, IrNode> = { '': root } // путь → таблица
    const arrays: Record<string, Record<string, IrNode>[]> = {} // путь → массив записей
    let currentPath = ''

    for (const rawLine of input.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith(';')) continue

      // [table]
      const tableMatch = line.match(/^\[([^\]]+)\]$/)
      if (tableMatch) {
        currentPath = parseTomlKey(tableMatch[1]!.trim())
        if (!tables[currentPath]) tables[currentPath] = {}
        // вставляем в родительскую таблицу (должен быть root, а не пустой объект)
        const parent = getTomlParent(root, currentPath)
        parent[currentPath.split('.').pop()!] = tables[currentPath]
        continue
      }

      // [[array-of-tables]]
      const arrMatch = line.match(/^\[\[([^\]]+)\]\]/)
      if (arrMatch) {
        const arrPath = parseTomlKey(arrMatch[1]!.trim())
        if (!arrays[arrPath]) arrays[arrPath] = []
        const newEntry: Record<string, IrNode> = {}
        arrays[arrPath]!.push(newEntry)
        // вставляем массив в родительскую таблицу
        const parentPath = arrPath.split('.').slice(0, -1).join('.')
        const parentKey = arrPath.split('.').pop()!
        const parent = tables[parentPath] ?? root
        parent[parentKey] = arrays[arrPath]
        // текущая таблица — последний элемент массива
        currentPath = arrPath
        tables[arrPath] = newEntry // чтобы вложенные [..] работали
        continue
      }

      // key = value
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = parseTomlKey(line.slice(0, eq).trim())
      const val = parseTomlValue(line.slice(eq + 1))
      const table = tables[currentPath] ?? root
      table[key] = val
    }

    // вложенные массивы записей: [[a.b]] должны оказаться в a.b как массив объектов
    // таблицы, объявленные после [[arr]], могут ссылаться на последний элемент
    return root
  }
  catch {
    throw new Error('errors.badToml')
  }
}

/** Возвращает родительскую таблицу (или root) для вложенного пути. */
function getTomlParent(table: Record<string, IrNode>, path: string): Record<string, IrNode> {
  const parts = path.split('.')
  let node: IrNode = table
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!
    if (isPlainObject(node) && k && k in node) {
      node = node[k] as IrNode
    }
    else if (isPlainObject(node)) {
      const child: Record<string, IrNode> = {}
      node[k] = child
      node = child
    }
  }
  return isPlainObject(node) ? node : {}
}

/* ---------------------- YAML (парсинг) ---------------------- */

/** Убирает комментарий (# вне кавычек). */
function stripYamlComment(line: string): string {
  let quote: "'" | '"' | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quote) {
      if (ch === '\\' && quote === '"') { i++; continue }
      if (ch === quote) quote = null
    }
    else if (ch === "'" || ch === '"') quote = ch
    else if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return line.slice(0, i)
  }
  return line
}

interface YamlLine { indent: number; text: string }

function yamlLines(input: string): YamlLine[] {
  const out: YamlLine[] = []
  for (const raw of input.split(/\r?\n/)) {
    const trimmed = raw.trimEnd()
    if (!trimmed.trim()) continue
    const text = stripYamlComment(trimmed).trimStart()
    if (!text || text === '---' || text === '...') continue
    out.push({ indent: trimmed.length - trimmed.trimStart().length, text })
  }
  return out
}

/** Первый ':' вне кавычек и скобок, после которого пробел или конец строки. */
function findYamlColon(s: string): number {
  let quote: "'" | '"' | null = null
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quote) {
      if (ch === '\\' && quote === '"') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '[' || ch === '{') { depth++; continue }
    if (ch === ']' || ch === '}') { depth--; continue }
    if (ch === ':' && depth === 0) {
      const next = s[i + 1]
      if (next === undefined || next === ' ' || next === '\t') return i
    }
  }
  return -1
}

/** Разбивает flow-коллекцию по запятым верхнего уровня (кавычки/скобки уважаются). */
function splitYamlFlow(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: "'" | '"' | null = null
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quote) {
      cur += ch
      if (ch === '\\' && quote === '"') { cur += s[i + 1] ?? ''; i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue }
    if (ch === '[' || ch === '{') { depth++; cur += ch; continue }
    if (ch === ']' || ch === '}') { depth--; cur += ch; continue }
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() || parts.length === 0) parts.push(cur)
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

/** Скаляр в одинарных/двойных кавычках → строка (без коэрции). */
function parseYamlQuoted(s: string): string {
  if (s.startsWith("'")) {
    let out = ''
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === "'" && s[i + 1] === "'") { out += "'"; i++; continue }
      out += s[i]!
    }
    return out
  }
  let out = ''
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i]!
    if (ch === '\\') {
      const n = s[i + 1]
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === '"') out += '"'
      else if (n === '\\') out += '\\'
      else out += n ?? ''
      i++
      continue
    }
    out += ch
  }
  return out
}

function parseYamlKey(s: string): string {
  const t = s.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return parseYamlQuoted(t)
  return t
}

/** Inline-значение: flow-коллекция [..]/{..}, кавычки или скаляр. */
function parseYamlFlow(s: string): IrNode {
  const t = s.trim()
  if (t === '') return null
  if (t.startsWith('[')) {
    const inner = t.slice(1, t.endsWith(']') ? -1 : undefined)
    return splitYamlFlow(inner).map((item) => parseYamlFlow(item))
  }
  if (t.startsWith('{')) {
    const inner = t.slice(1, t.endsWith('}') ? -1 : undefined)
    const obj: Record<string, IrNode> = {}
    for (const pair of splitYamlFlow(inner)) {
      const colon = findYamlColon(pair)
      if (colon === -1) continue
      obj[parseYamlKey(pair.slice(0, colon))] = parseYamlFlow(pair.slice(colon + 1))
    }
    return obj
  }
  if (t.startsWith("'") || t.startsWith('"')) return parseYamlQuoted(t)
  return coerceScalar(t, false)
}

function parseYamlBlock(lines: YamlLine[], index: number, indent: number): { node: IrNode; next: number } {
  return lines[index]!.text.startsWith('- ') || lines[index]!.text === '-'
    ? parseYamlSeq(lines, index, indent)
    : parseYamlMap(lines, index, indent)
}

function parseYamlMap(lines: YamlLine[], index: number, indent: number): { node: IrNode; next: number } {
  const obj: Record<string, IrNode> = {}
  let i = index
  while (i < lines.length) {
    const line = lines[i]!
    if (line.indent < indent) break
    if (line.indent > indent) throw new Error('errors.badYaml')
    if (line.text.startsWith('- ')) break
    const colon = findYamlColon(line.text)
    if (colon === -1) throw new Error('errors.badYaml')
    const key = parseYamlKey(line.text.slice(0, colon))
    const rest = line.text.slice(colon + 1).trim()
    i++
    if (rest === '') {
      if (i < lines.length && lines[i]!.indent > indent) {
        const block = parseYamlBlock(lines, i, lines[i]!.indent)
        obj[key] = block.node
        i = block.next
      }
      else {
        obj[key] = null
      }
    }
    else {
      obj[key] = parseYamlFlow(rest)
    }
  }
  return { node: obj, next: i }
}

function parseYamlSeq(lines: YamlLine[], index: number, indent: number): { node: IrNode; next: number } {
  const arr: IrNode[] = []
  let i = index
  while (i < lines.length) {
    const line = lines[i]!
    if (line.indent < indent) break
    if (line.indent > indent) break
    if (!(line.text.startsWith('- ') || line.text === '-')) break
    const rest = line.text === '-' ? '' : line.text.slice(2).trim()
    i++
    if (rest === '') {
      if (i < lines.length && lines[i]!.indent > indent) {
        const block = parseYamlBlock(lines, i, lines[i]!.indent)
        arr.push(block.node)
        i = block.next
      }
      else {
        arr.push(null)
      }
      continue
    }
    const colon = findYamlColon(rest)
    if (colon === -1) {
      arr.push(parseYamlFlow(rest))
      continue
    }
    // `- key: ...` → inline-маппинг; может продолжаться на отступе между indent и вложенным блоком
    const key = parseYamlKey(rest.slice(0, colon))
    const valueRest = rest.slice(colon + 1).trim()
    const obj: Record<string, IrNode> = {}
    if (valueRest === '') {
      obj[key] = null
      if (i < lines.length && lines[i]!.indent > indent) {
        const nestedIndent = lines[i]!.indent
        const block = parseYamlBlock(lines, i, nestedIndent)
        obj[key] = block.node
        i = block.next
      }
    }
    else {
      obj[key] = parseYamlFlow(valueRest)
    }
    if (i < lines.length && lines[i]!.indent > indent) {
      const cont = parseYamlMap(lines, i, lines[i]!.indent)
      Object.assign(obj, cont.node)
      i = cont.next
    }
    arr.push(obj)
  }
  return { node: arr, next: i }
}

/** YAML-подмножество: блоковые маппинги/последовательности, flow-коллекции, кавычки, комментарии. */
function parseYaml(input: string): IrNode {
  const lines = yamlLines(input)
  if (lines.length === 0) return {}
  if (lines.length === 1 && !lines[0]!.text.startsWith('- ') && findYamlColon(lines[0]!.text) === -1) {
    return parseYamlFlow(lines[0]!.text)
  }
  return parseYamlBlock(lines, 0, lines[0]!.indent).node
}

/* ---------------------- vCard / iCal (общие примитивы) ---------------------- */

/** Разворачивает folded-строки (продолжение начинается с пробела/таба). */
function unfoldLines(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] = out[out.length - 1]! + raw.slice(1)
    }
    else if (raw.trim()) {
      out.push(raw)
    }
  }
  return out
}

function escapeProp(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
}

function unescapeProp(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\\') {
      const n = s[i + 1]
      if (n === 'n') out += '\n'
      else if (n === ';') out += ';'
      else if (n === ',') out += ','
      else if (n === '\\') out += '\\'
      else out += n ?? ''
      i++
      continue
    }
    out += ch
  }
  return out
}

/** Повторяющееся свойство → массив; иначе скаляр. */
function pushProp(obj: Record<string, IrNode>, key: string, value: IrNode): void {
  const existing = obj[key]
  if (existing === undefined) obj[key] = value
  else if (Array.isArray(existing)) existing.push(value)
  else obj[key] = [existing, value]
}

/* ---------------------- vCard ---------------------- */

function parseVCard(input: string): IrNode {
  const root: Record<string, IrNode> = {}
  for (const raw of unfoldLines(input)) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const head = line.slice(0, colon)
    const value = unescapeProp(line.slice(colon + 1))
    const parts = head.split(';')
    const name = parts[0]!.toUpperCase()
    if (name === 'BEGIN' || name === 'END') continue
    const params: Record<string, string> = {}
    for (const p of parts.slice(1)) {
      if (!p) continue
      const eq = p.indexOf('=')
      if (eq === -1) params[p.toUpperCase()] = 'true'
      else params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
    }
    const key = name.toLowerCase()
    if (key === 'version') { root.version = value; continue }
    if (key === 'n') {
      const [family, given, additional, prefix, suffix] = value.split(';')
      root.n = { family: family ?? '', given: given ?? '', additional: additional ?? '', prefix: prefix ?? '', suffix: suffix ?? '' }
      continue
    }
    const entry: IrNode = Object.keys(params).length
      ? { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k.toLowerCase(), v])), value }
      : value
    if (Object.keys(params).length) {
      // параметризованные свойства (EMAIL/TEL/ADR...) почти всегда повторяются — всегда массив
      const existing = root[key]
      if (Array.isArray(existing)) existing.push(entry)
      else root[key] = existing === undefined ? [entry] : [existing, entry]
    }
    else {
      pushProp(root, key, entry)
    }
  }
  return root
}

function writeVCardProps(lines: string[], name: string, value: IrNode): void {
  const items = Array.isArray(value) ? value : [value]
  for (const item of items) {
    if (isPlainObject(item)) {
      const { type, ...rest } = item as Record<string, IrNode>
      const typeParam = type ? `;TYPE=${String(type).toUpperCase()}` : ''
      const other = Object.entries(rest)
        .filter(([k]) => k !== 'value' && rest[k] !== undefined)
        .map(([k, v]) => `${k.toUpperCase()}=${String(v)}`)
        .join(';')
      lines.push(`${name}${typeParam}${other ? `;${other}` : ''}:${escapeProp(String(rest.value ?? ''))}`)
    }
    else {
      lines.push(`${name}:${escapeProp(String(item))}`)
    }
  }
}

function serializeVCard(node: IrNode): string {
  const root = node as Record<string, IrNode>
  const lines = ['BEGIN:VCARD', `VERSION:${root.version ?? '3.0'}`]
  for (const [key, value] of Object.entries(root)) {
    if (key === 'version') continue
    if (key === 'n' && isPlainObject(value)) {
      const n = value as Record<string, IrNode>
      const fields = ['family', 'given', 'additional', 'prefix', 'suffix']
      lines.push(`N:${fields.map((f) => escapeProp(n[f] == null ? '' : String(n[f]))).join(';')}`)
      continue
    }
    writeVCardProps(lines, key.toUpperCase(), value)
  }
  lines.push('END:VCARD')
  return lines.join('\n')
}

/* ---------------------- iCal ---------------------- */

function parseICal(input: string): IrNode {
  const root: Record<string, IrNode> = {}
  const stack: Record<string, IrNode>[] = [root]
  for (const raw of unfoldLines(input)) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const head = line.slice(0, colon)
    const value = unescapeProp(line.slice(colon + 1))
    const name = head.split(';')[0]!.toUpperCase()
    if (name === 'BEGIN') {
      const comp: Record<string, IrNode> = {}
      pushProp(stack.at(-1)!, value.toLowerCase(), comp)
      stack.push(comp)
      continue
    }
    if (name === 'END') {
      if (stack.length > 1) stack.pop()
      continue
    }
    // параметры (TZID, VALUE и т.п.) пока не сохраняем — подмножество
    pushProp(stack.at(-1)!, name.toLowerCase(), value)
  }
  return root
}

function writeICalComponent(lines: string[], name: string, node: IrNode): void {
  lines.push(`BEGIN:${name}`)
  for (const [key, value] of Object.entries(node as Record<string, IrNode>)) {
    if (isPlainObject(value)) {
      writeICalComponent(lines, key.toUpperCase(), value)
    }
    else {
      const items = Array.isArray(value) ? value : [value]
      for (const item of items) {
        if (isPlainObject(item)) writeICalComponent(lines, key.toUpperCase(), item)
        else lines.push(`${key.toUpperCase()}:${escapeProp(String(item))}`)
      }
    }
  }
  lines.push(`END:${name}`)
}

function serializeICal(node: IrNode): string {
  const root = node as Record<string, IrNode>
  const keys = Object.keys(root)
  // { vcalendar: {...} } (как после parse) → разворачиваем до самого календаря
  const calendar = keys.length === 1 && isPlainObject(root[keys[0]!])
    ? root[keys[0]!] as Record<string, IrNode>
    : root
  const lines: string[] = []
  writeICalComponent(lines, 'VCALENDAR', calendar)
  return lines.join('\n')
}

/* ---------------------- XML (fast-xml-parser) ---------------------- */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isTreeConfigured: true,
  // числа/були/скаляры: fast-xml-parser возвращает строки, коерция через coerceScalar
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true
})

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: false,
  suppressBooleanAttributes: false,
  suppressDeclaration: true,
  suppressEmpty: true
})

/** XML → IrNode. */
function parseXml(input: string): IrNode {
  try {
    return xmlParser.parse(input) as IrNode
  }
  catch {
    throw new Error('errors.badXml')
  }
}

/** IrNode → XML. */
function serializeXml(node: IrNode): string {
  return xmlBuilder.build(node as never)
}

/* ---------------------- GeoJSON / KML / GPX ---------------------- */

/**
 * Внутреннее представление гео-объекта как IrNode:
 * { type: 'FeatureCollection', features: [...] }
 * или { type: 'Feature', geometry: {...}, properties: {...} }
 * или { type: 'Point' | 'LineString' | 'Polygon', coordinates: [...] }
 */

function geoCoord(parts: string): number[] {
  return parts.split(',').map((s) => parseFloat(s.trim()))
}

/** Экранирует строки для XML (KML/GPX). */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function parseGeoJSON(input: string): IrNode {
  try {
    const parsed = JSON.parse(input) as IrNode
    if (isPlainObject(parsed) && typeof parsed.type === 'string') return parsed
    throw new Error()
  }
  catch {
    throw new Error('errors.badGeoJson')
  }
}

function serializeGeoJSON(node: IrNode): string {
  if (!isPlainObject(node) || typeof node.type !== 'string')
    throw new Error('errors.badGeoJson')
  return JSON.stringify(node, null, 2)
}

/** GPX → IrNode. Поддерживает waypoints, routes, tracks. */
function parseGPX(input: string): IrNode {
  const features: IrNode[] = []
  try {
    const parsed = xmlParser.parse(input.trim()) as IrNode
    const gpx = isPlainObject(parsed) ? (parsed.gpx as IrNode) : undefined
    if (!isPlainObject(gpx)) throw new Error()

    const wpts = gpx.wpt
    const rt = gpx.rte
    const tk = gpx.trk

    // waypoints → Point Features
    if (wpts) {
      const wptList = Array.isArray(wpts) ? wpts : [wpts]
      for (const wpt of wptList) {
        if (!isPlainObject(wpt)) continue
        const lon = Number(wpt['@_lon'])
        const lat = Number(wpt['@_lat'])
        if (isNaN(lon) || isNaN(lat)) continue
        const props: Record<string, IrNode> = {}
        for (const [k, v] of Object.entries(wpt)) {
          if (k === '@_lon' || k === '@_lat') continue
          props[k] = v as IrNode
        }
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: props
        })
      }
    }

    // routes → LineString Features
    if (rt) {
      const rteList = Array.isArray(rt) ? rt : [rt]
      for (const r of rteList) {
        if (!isPlainObject(r)) continue
        const rtepts = r.rtept
        if (!rtepts) continue
        const pts = Array.isArray(rtepts) ? rtepts : [rtepts]
        const coords: number[][] = []
        for (const p of pts) {
          if (!isPlainObject(p)) continue
          const lon = Number(p['@_lon'])
          const lat = Number(p['@_lat'])
          if (!isNaN(lon) && !isNaN(lat)) coords.push([lon, lat])
        }
        if (coords.length >= 2) {
          const props: Record<string, IrNode> = {}
          for (const [k, v] of Object.entries(r)) {
            if (k === 'rtept') continue
            props[k] = v as IrNode
          }
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: props
          })
        }
      }
    }

    // tracks → LineString Features (один seg = одна линия)
    if (tk) {
      const trkList = Array.isArray(tk) ? tk : [tk]
      for (const t of trkList) {
        if (!isPlainObject(t)) continue
        const trksegs = t.trkseg
        if (!trksegs) continue
        const segs = Array.isArray(trksegs) ? trksegs : [trksegs]
        for (const seg of segs) {
          if (!isPlainObject(seg)) continue
          const trkpts = seg.trkpt
          if (!trkpts) continue
          const pts = Array.isArray(trkpts) ? trkpts : [trkpts]
          const coords: number[][] = []
          for (const p of pts) {
            if (!isPlainObject(p)) continue
            const lon = Number(p['@_lon'])
            const lat = Number(p['@_lat'])
            if (!isNaN(lon) && !isNaN(lat)) coords.push([lon, lat])
          }
          if (coords.length >= 2) {
            features.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords },
              properties: {}
            })
          }
        }
      }
    }

    if (features.length === 0) throw new Error()
    return { type: 'FeatureCollection', features }
  }
  catch {
    throw new Error('errors.badGpx')
  }
}

/** IrNode → GPX. */
function serializeGPX(node: IrNode): string {
  const obj = isPlainObject(node) ? node : {}
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="UWC" xmlns="http://www.topografix.com/GPX/1/1">'
  ]

  const features = isPlainObject(obj) ? (obj.features as IrNode) : undefined
  if (Array.isArray(features)) {
    for (const feat of features) {
      if (!isPlainObject(feat)) continue
      const geom = feat.geometry as IrNode
      const props = (feat.properties as Record<string, IrNode>) ?? {}
      if (!isPlainObject(geom)) continue
      const type = geom.type as string
      const coords = geom.coordinates as IrNode

      if (type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
        const [lon, lat] = coords as [number, number]
        const propLines: string[] = []
        for (const [k, v] of Object.entries(props)) {
          if (typeof v === 'string') propLines.push(`  <${k}>${xmlEscape(v)}</${k}>`)
          else if (v != null) propLines.push(`  <${k}>${xmlEscape(String(v))}</${k}>`)
        }
        const opening = `<wpt lat="${Number(lat)}" lon="${Number(lon)}">`
        lines.push(opening)
        for (const pl of propLines) lines.push(pl)
        lines.push('</wpt>')
      }
      else if (type === 'LineString' && Array.isArray(coords) && coords.length >= 2) {
        const pts = coords as number[][]
        const rteLines: string[] = []
        for (const [k, v] of Object.entries(props)) {
          if (typeof v === 'string') rteLines.push(`  <${k}>${xmlEscape(v)}</${k}>`)
        }
        lines.push('<rte>')
        for (const rl of rteLines) lines.push(rl)
        for (const [lon, lat] of pts) {
          lines.push(`  <rtept lat="${Number(lat)}" lon="${Number(lon)}"></rtept>`)
        }
        lines.push('</rte>')
      }
    }
  }

  lines.push('</gpx>')
  return lines.join('\n')
}

/**
 * KML → IrNode.
 * Использует fast-xml-parser. Координаты в KML: lon,lat[,alt] через пробел.
 */
function parseKML(input: string): IrNode {
  const features: IrNode[] = []
  try {
    const parsed = xmlParser.parse(input.trim()) as IrNode
    const kml = isPlainObject(parsed) ? (parsed.kml as IrNode) : undefined
    if (!isPlainObject(kml)) throw new Error()
    const doc = kml.Document as IrNode
    const folder = isPlainObject(doc) ? doc.Folder : undefined
    const placemarks
      = (isPlainObject(doc) ? doc.Placemark : undefined)
        ?? (isPlainObject(folder) ? folder.Placemark : undefined)

    if (!placemarks) throw new Error()
    const pmList = Array.isArray(placemarks) ? placemarks : [placemarks]

    for (const pm of pmList) {
      if (!isPlainObject(pm)) continue
      const name = pm.name as string
      const coordsStr = pm.Point ? (pm.Point.coordinates as string) : undefined
      const lineCoordsStr = pm.LineString ? (pm.LineString.coordinates as string) : undefined
      const props: Record<string, IrNode> = {}
      if (name) props.name = name

      if (coordsStr) {
        const parts = coordsStr.trim().split(/\s+/)
        if (parts.length > 0) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: geoCoord(parts[0]!) },
            properties: props
          })
        }
      }
      else if (lineCoordsStr) {
        const parts = lineCoordsStr.trim().split(/\s+/)
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: parts.map(geoCoord) },
          properties: props
        })
      }
    }

    if (features.length === 0) throw new Error()
    return { type: 'FeatureCollection', features }
  }
  catch {
    throw new Error('errors.badKml')
  }
}

/** IrNode → KML. */
function serializeKML(node: IrNode): string {
  const obj = isPlainObject(node) ? node : {}
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>'
  ]

  const features = isPlainObject(obj) ? (obj.features as IrNode) : undefined
  if (Array.isArray(features)) {
    for (const feat of features) {
      if (!isPlainObject(feat)) continue
      const geom = feat.geometry as IrNode
      const props = (feat.properties as Record<string, IrNode>) ?? {}
      if (!isPlainObject(geom)) continue
      const type = geom.type as string
      const coords = geom.coordinates as IrNode

      if (type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
        const [lon, lat, alt] = coords as [number, number, number?]
        const name = props.name as string
        const coordStr = alt != null
          ? `${Number(lon).toFixed(6)},${Number(lat).toFixed(6)},${Number(alt).toFixed(6)}`
          : `${Number(lon).toFixed(6)},${Number(lat).toFixed(6)}`
        lines.push('    <Placemark>')
        if (name) lines.push(`      <name>${xmlEscape(name)}</name>`)
        lines.push('      <Point>')
        lines.push(`        <coordinates>${coordStr}</coordinates>`)
        lines.push('      </Point>')
        lines.push('    </Placemark>')
      }
      else if (type === 'LineString' && Array.isArray(coords)) {
        const pts = coords as number[][]
        const coordStr = pts
          .map(([lon, lat]) => `${Number(lon).toFixed(6)},${Number(lat).toFixed(6)}`)
          .join(' ')
        const name = props.name as string
        lines.push('    <Placemark>')
        if (name) lines.push(`      <name>${xmlEscape(name)}</name>)`)
        lines.push('      <LineString>')
        lines.push(`        <coordinates>${coordStr}</coordinates>`)
        lines.push('      </LineString>')
        lines.push('    </Placemark>')
      }
    }
  }


  lines.push('  </Document>')
  lines.push('</kml>')
  return lines.join('\n')
}
