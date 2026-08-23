/**
 * Разбор и сериализация CSV/TSV (разделители с учётом кавычек).
 * Общие для текстовых конвертеров (CSV↔TSV) и IR-форматов данных (уровень B → клиент).
 */

/** Разбор CSV/TSV с учётом кавычек ("...", экранирование "" внутри). */
export function parseDelimited(input: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < input.length) {
    const ch = input[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
      }
      else {
        field += ch
      }
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      endField()
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n')
        i++
      endRow()
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0)
    endRow()

  // хвостовая пустая строка от финального переноса
  while (rows.length > 0 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === '')
    rows.pop()
  return rows
}

export function serializeDelimited(rows: string[][], delim: string): string {
  return rows.map((row) => row.map((f) => {
    if (f.includes(delim) || f.includes('"') || f.includes('\n') || f.includes('\r'))
      return `"${f.replace(/"/g, '""')}"`
    return f
  }).join(delim)).join('\n')
}
