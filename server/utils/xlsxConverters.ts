/**
 * UWC — серверные конвертеры XLSX ↔ CSV/JSON (фаза 2, уровень B).
 *
 * Библиотека:
 *   - exceljs (MIT) — читает/писает XLSX (ZIP + XML) и CSV. Чистый JS.
 *     НЕ SheetJS `xlsx` (CE-версия застряла на 0.18.5 с CVE).
 *
 * XLSX — бинарный ZIP-архив → inputKind='binary'.
 * CSV и JSON — текст → inputKind='text'.
 */

import ExcelJS from 'exceljs'

/** MIME для XLSX. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * XLSX (байты) → CSV (string).
 */
export async function xlsxToCsv(input: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(input))
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('errors.badXlsx')

  const rows: string[] = []
  ws.eachRow((row) => {
    const values: string[] = []
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value
      values.push(v != null ? formatCellValue(v) : '')
    })
    rows.push(values.map(csvEscape).join(','))
  })
  return rows.join('\n')
}

/**
 * CSV (string) → XLSX (байты).
 */
export async function csvToXlsx(input: string): Promise<Uint8Array> {
  const rows = parseCsvRows(input)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  rows.forEach((row) => ws.addRow(row))
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

/**
 * XLSX (байты) → JSON (string).
 * Каждый лист → массив массивов [[cell, cell], ...].
 */
export async function xlsxToJson(input: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(input))

  const result: Record<string, unknown[][]> = {}
  wb.worksheets.forEach((ws) => {
    const rows: unknown[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values: unknown[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(cell.value)
      })
      rows.push(values)
    })
    result[ws.name || 'Sheet1'] = rows
  })
  return JSON.stringify(result, null, 2)
}

/**
 * JSON (string) → XLSX (байты).
 * Поддерживает: массив массивов (→ Sheet1) или { "Name": [[...]] } (→ несколько листов).
 */
export async function jsonToXlsx(input: string): Promise<Uint8Array> {
  const parsed = JSON.parse(input) as unknown
  const wb = new ExcelJS.Workbook()

  if (Array.isArray(parsed)) {
    const ws = wb.addWorksheet('Sheet1')
    parsed.forEach((row) => ws.addRow(row as any[]))
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    for (const [sheetName, data] of Object.entries(obj)) {
      const ws = wb.addWorksheet(sheetName)
      if (Array.isArray(data)) {
        data.forEach((row) => ws.addRow(row as any[]))
      }
    }
  } else {
    throw new Error('errors.badJson')
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

/** Format exceljs CellValue → строка для CSV/JSON. */
function formatCellValue(v: ExcelJS.CellValue): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (v && typeof v === 'object' && 'richText' in v) return (v as any).richText.map((t: any) => t.text).join('')
  if (v && typeof v === 'object' && 'hyperlink' in v) return (v as any).hyperlink || ''
  return String(v ?? '')
}

/** Экранируем поле для CSV. */
function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** Минимальный CSV-парсер с поддержкой кавычек. */
function parseCsvRows(input: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let curVal = ''
  let inQuotes = false
  let startedRow = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { curVal += '"'; i++ }
        else inQuotes = false
      } else curVal += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      if (ch === ',' || !startedRow) {
        cur.push(curVal); curVal = ''
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i + 1] === '\n') i++
        cur.push(curVal); curVal = ''
        rows.push(cur); cur = []; startedRow = false
      } else startedRow = true
    } else {
      curVal += ch
      startedRow = true
    }
  }
  if (curVal || cur.length || rows.length === 0) {
    cur.push(curVal)
    rows.push(cur)
  }
  return rows
}
