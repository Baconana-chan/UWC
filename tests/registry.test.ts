import { describe, expect, it } from 'vitest'
import { getServerConverter, SERVER_CONVERTERS } from '../server/utils/registry'
import { DOCX_MIME } from '../server/utils/docxConverters'
import { PDF_MIME } from '../server/utils/pdfConverters'

describe('server registry (фаза 0)', () => {
  it('регистрирует курируемые IR-пары (тир b, текст)', () => {
    const text = SERVER_CONVERTERS.filter((c) => c.inputKind === 'text')
    expect(text.length).toBe(38)
    expect(text.every((c) => c.tier === 'b')).toBe(true)
    // text конвертеры отдают text/*, но html-to-docx и txt-to-docx выдают DOCX (бинарный файл)
    expect(text.filter((c) => c.mime.startsWith('text/')).length).toBe(32)
    expect(text.some((c) => c.id === 'html-to-docx')).toBe(true)
    expect(text.some((c) => c.id === 'txt-to-docx')).toBe(true)
    expect(text.some((c) => c.id === 'txt-to-pdf')).toBe(true)
    expect(text.some((c) => c.id === 'csv-to-xlsx')).toBe(true)
    expect(text.some((c) => c.id === 'json-to-xlsx')).toBe(true)
    expect(text.some((c) => c.id === 'sql-to-json')).toBe(true)
    expect(text.some((c) => c.id === 'json-to-sql')).toBe(true)
  })

  it('фаза 3: полная матрица изображений (тир c, бинарный вход)', () => {
    const img = SERVER_CONVERTERS.filter((c) => c.inputKind === 'binary')
    // 10 источников × 6 целей − 6 identity = 54
    expect(img.length).toBe(59) // 54 image + 5 docx/pdf/xlsx (docx-to-html, docx-to-txt, pdf-to-txt) (docx-to-html, docx-to-txt)
    expect(img.filter((c) => c.tier === 'c').length).toBe(54)
    expect(img.filter((c) => c.mime.startsWith('image/')).length).toBe(54)
    expect(img.some((c) => c.id === 'docx-to-html')).toBe(true)
    expect(img.some((c) => c.id === 'docx-to-txt')).toBe(true)
    expect(img.some((c) => c.id === 'pdf-to-txt')).toBe(true)
    expect(img.some((c) => c.id === 'xlsx-to-csv')).toBe(true)
    expect(img.some((c) => c.id === 'xlsx-to-json')).toBe(true)
  })

  it('картинко-пары находят по from/to и отдают байты', async () => {
    const conv = getServerConverter('png', 'avif')!
    expect(conv.id).toBe('png-to-avif')
    expect(conv.inputKind).toBe('binary')
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const out = await conv.handler(png)
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(out!.length).toBeGreaterThan(0)
  })

  it('фаза 2: YAML-парсинг, vCard, iCal доступны на сервере', async () => {
    const yaml = getServerConverter('yaml', 'json')!
    expect(JSON.parse(await yaml.handler('a: 1\nb: true\n'))).toEqual({ a: 1, b: true })
    expect(getServerConverter('vcard', 'json')).toBeDefined()
    expect(getServerConverter('ical', 'json')).toBeDefined()
  })

  it('фаза 2: DOCX ↔ HTML + DOCX ↔ TXT', async () => {
    const docxToHtml = getServerConverter('docx', 'html')!
    expect(docxToHtml.id).toBe('docx-to-html')
    expect(docxToHtml.inputKind).toBe('binary')
    expect(docxToHtml.mime).toContain('text/html')

    const htmlToDocx = getServerConverter('html', 'docx')!
    expect(htmlToDocx.id).toBe('html-to-docx')
    expect(htmlToDocx.mime).toBe(DOCX_MIME)

    const docxToTxt = getServerConverter('docx', 'txt')!
    expect(docxToTxt.id).toBe('docx-to-txt')
    expect(docxToTxt.inputKind).toBe('binary')

    const txtToDocx = getServerConverter('txt', 'docx')!
    expect(txtToDocx.id).toBe('txt-to-docx')
    expect(txtToDocx.inputKind).toBe('text')
    expect(txtToDocx.mime).toBe(DOCX_MIME)

    // HTML → DOCX → проверка ZIP-заголовка PK
    const docxBytes = await htmlToDocx.handler('<p>Hello world</p>') as Uint8Array
    expect(docxBytes.length).toBeGreaterThan(0)
    expect(docxBytes[0]).toBe(0x50) // 'P'
    expect(docxBytes[1]).toBe(0x4b) // 'K'

    // TXT → DOCX тоже выдаёт ZIP
    const txtBytes = await txtToDocx.handler('Hello world') as Uint8Array
    expect(txtBytes[0]).toBe(0x50)
    expect(txtBytes[1]).toBe(0x4b)

    // DOCX → TXT: mammoth.extractRawText достаёт чистый текст
    const txt = await docxToTxt.handler(docxBytes) as string
    expect(txt).toContain('Hello world')
  })

  it('фаза 2: PDF ↔ текст', async () => {
    const pdfToTxt = getServerConverter('pdf', 'txt')!
    expect(pdfToTxt.id).toBe('pdf-to-txt')
    expect(pdfToTxt.inputKind).toBe('binary')
    expect(pdfToTxt.mime).toContain('text/plain')

    const txtToPdf = getServerConverter('txt', 'pdf')!
    expect(txtToPdf.id).toBe('txt-to-pdf')
    expect(txtToPdf.inputKind).toBe('text')
    expect(txtToPdf.mime).toBe(PDF_MIME)

    // TXT → PDF → проверка PDF-сигнатуры %PDF
    const pdfBytes = await txtToPdf.handler('Hello PDF world') as Uint8Array
    expect(pdfBytes.length).toBeGreaterThan(0)
    expect(pdfBytes.slice(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) // %PDF-

    // PDF → TXT: извлекаем текст обратно
    const extracted = await pdfToTxt.handler(pdfBytes) as string
    expect(extracted).toContain('Hello PDF world')
  })

  it('фаза 2: XLSX ↔ CSV / JSON', async () => {
    // JSON → XLSX: проверка ZIP/PK сигнатуры
    const jsonToXlsx = getServerConverter('json', 'xlsx')!
    expect(jsonToXlsx.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const xlsxB = await jsonToXlsx.handler('[["name","age"],["Alice",30]]') as Uint8Array
    expect(xlsxB.length).toBeGreaterThan(0)
    expect(xlsxB[0]).toBe(0x50) // 'P'
    expect(xlsxB[1]).toBe(0x4b) // 'K'

    // XLSX → CSV: обратно читаем
    const xlsxToCsv = getServerConverter('xlsx', 'csv')!
    const csv = await xlsxToCsv.handler(xlsxB) as string
    expect(csv).toContain('Alice')
    expect(csv).toContain('name')

    // XLSX → JSON
    const xlsxToJson = getServerConverter('xlsx', 'json')!
    const jsonOut = await xlsxToJson.handler(xlsxB) as string
    const parsed = JSON.parse(jsonOut)
    expect(parsed.Sheet1).toEqual([['name', 'age'], ['Alice', 30]])

    // CSV → XLSX: round-trip
    const csvXlsx = getServerConverter('csv', 'xlsx')!
    const xlsxC = await csvXlsx.handler('name,age\nAlice,30') as Uint8Array
    expect(xlsxC[0]).toBe(0x50)
  })

  it('фаза 2: SQL ↔ JSON', async () => {
    const sql = [
      'CREATE TABLE users (id INTEGER, name TEXT, age INTEGER);',
      'INSERT INTO users (id, name, age) VALUES (1, "Alice", 30), (2, "Bob", 25);'
    ].join('\n')

    const sqlToJson = getServerConverter('sql', 'json')!
    const json = await sqlToJson.handler(sql) as string
    const parsed = JSON.parse(json)
    expect(parsed.users).toEqual([
      { id: 1, name: 'Alice', age: 30 },
      { id: 2, name: 'Bob', age: 25 }
    ])

    // JSON → SQL: CREATE TABLE + INSERT
    const jsonToSql = getServerConverter('json', 'sql')!
    const dump = await jsonToSql.handler(JSON.stringify({
      users: [{ name: 'Carol', age: 40 }, { name: 'Dave', age: 35 }]
    })) as string
    expect(dump).toContain('CREATE TABLE users')
    expect(dump).toContain('INSERT INTO users')
    expect(dump).toContain('Carol')
    expect(dump).toContain('Dave')
  })

  it('находит пару по from/to', async () => {
    const conv = getServerConverter('ini', 'toml')!
    expect(conv.id).toBe('ini-to-toml')
    const out = await conv.handler('[server]\nhost = example.com\nport = 8080\n')
    expect(out).toBe('[server]\nhost = "example.com"\nport = 8080')
  })

  it('неизвестная пара — undefined (белый список)', () => {
    expect(getServerConverter('nope', 'json')).toBeUndefined()
    expect(getServerConverter('json', 'nope')).toBeUndefined()
  })

  it('round-trip INI ↔ JSON сохраняет типы', async () => {
    const ini = '; comment\n[app]\nname = uwc\nretries = 3\nquoted = "3"\n'
    const toJson = getServerConverter('ini', 'json')!
    const json = await toJson.handler(ini)
    expect(JSON.parse(json)).toEqual({ app: { name: 'uwc', retries: 3, quoted: '3' } })
    const back = getServerConverter('json', 'ini')!
    expect(await back.handler(json)).toBe('[app]\nname = uwc\nretries = 3\nquoted = "3"')
  })

  it('CSV → JSON с кавычками внутри полей', async () => {
    const conv = getServerConverter('csv', 'json')!
    const json = await conv.handler('a,b\n1,"x,y"\n')
    expect(JSON.parse(json)).toEqual([['a', 'b'], ['1', 'x,y']])
  })

  it('JSON → CSV: массив объектов даёт заголовки', async () => {
    const conv = getServerConverter('json', 'csv')!
    expect(await conv.handler('[{"name":"x","v":1},{"name":"y","v":2}]')).toBe('name,v\nx,1\ny,2')
  })

  it('фаза 2: CSV ↔ JSON и vCard ↔ JSON на сервере', async () => {
    // CSV → JSON
    const csv2json = getServerConverter('csv', 'json')!
    const json = await csv2json.handler('name,age\nAlice,30\nBob,25\n')
    expect(JSON.parse(json)).toEqual([['name', 'age'], ['Alice', '30'], ['Bob', '25']])

    // JSON → CSV (массив объектов → заголовки)
    const json2csv = getServerConverter('json', 'csv')!
    expect(await json2csv.handler('[{"name":"Alice","age":30},{"name":"Bob","age":25}]')).toBe('name,age\nAlice,30\nBob,25')

    // vCard → JSON
    const vcard = getServerConverter('vcard', 'json')!
    const vc = [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Jane Doe',
      'EMAIL:janedoe@example.com', 'END:VCARD'
    ].join('\n')
    const vcardJson = await vcard.handler(vc)
    expect(JSON.parse(vcardJson)).toEqual({
      version: '3.0',
      fn: 'Jane Doe',
      email: 'janedoe@example.com'
    })

    // iCal → JSON
    const ical = getServerConverter('ical', 'json')!
    const ic = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UWC//EN',
      'BEGIN:VEVENT', 'UID:evt-1', 'SUMMARY:Standup',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\n')
    const iCalJson = await ical.handler(ic)
    expect(JSON.parse(iCalJson)).toEqual({
      vcalendar: {
        version: '2.0',
        prodid: '-//UWC//EN',
        vevent: { uid: 'evt-1', summary: 'Standup' }
      }
    })
  })
})