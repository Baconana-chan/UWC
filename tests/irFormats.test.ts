import { describe, expect, it } from 'vitest'
import { IR_FORMATS, type IrNode } from '../shared/registry/irFormats'
import { makeIrPair } from '../shared/registry/ir'
import { geojsonToCsv } from '../shared/registry/formats'

const fmt = (id: string) => {
  const f = IR_FORMATS.find((x) => x.id === id)
  if (!f) throw new Error(`Unknown IR format: ${id}`)
  return f
}

function run(from: string, to: string, input: string): string {
  return makeIrPair(fmt(from), fmt(to)).run(input)
}

describe('YAML парсинг (фаза 2)', () => {
  it('вложенные маппинги и списки', () => {
    const yaml = 'server:\n  host: example.com\n  port: 8080\nitems:\n  - name: a\n    v: 1\n  - name: b\n'
    expect(JSON.parse(run('yaml', 'json', yaml))).toEqual({
      server: { host: 'example.com', port: 8080 },
      items: [{ name: 'a', v: 1 }, { name: 'b' }]
    })
  })

  it('типизирует скаляры и уважает кавычки', () => {
    const yaml = 'a: 1\nb: true\nc: null\nd: "1"\ne: x y\nf: "#not-comment"\n'
    expect(JSON.parse(run('yaml', 'json', yaml))).toEqual({
      a: 1, b: true, c: null, d: '1', e: 'x y', f: '#not-comment'
    })
  })

  it('flow-коллекции и комментарии', () => {
    const yaml = '# комментарий\nlist: [1, 2, 3]  # inline\nmap: {a: 1, b: two}\n'
    expect(JSON.parse(run('yaml', 'json', yaml))).toEqual({ list: [1, 2, 3], map: { a: 1, b: 'two' } })
  })

  it('round-trip JSON → YAML → JSON', () => {
    const input = {
      server: { host: 'example.com', port: 8080, enabled: true },
      tags: ['a', 'b'],
      items: [{ k: 1, deep: { x: 'y' } }],
      empty: null
    }
    const yaml = run('json', 'yaml', JSON.stringify(input))
    expect(JSON.parse(run('yaml', 'json', yaml))).toEqual(input)
  })
})

describe('vCard (фаза 2)', () => {
  const vcard = [
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:John Doe',
    'N:Doe;John;;;', 'EMAIL;TYPE=WORK:john@example.com',
    'TEL;TYPE=CELL:+1-555-123-4567', 'END:VCARD'
  ].join('\n')

  it('парсит в JSON', () => {
    expect(JSON.parse(run('vcard', 'json', vcard))).toEqual({
      version: '3.0',
      fn: 'John Doe',
      n: { family: 'Doe', given: 'John', additional: '', prefix: '', suffix: '' },
      email: [{ type: 'WORK', value: 'john@example.com' }],
      tel: [{ type: 'CELL', value: '+1-555-123-4567' }]
    })
  })

  it('round-trip vCard → JSON → vCard сохраняет данные', () => {
    const json = run('vcard', 'json', vcard)
    expect(JSON.parse(run('vcard', 'json', run('json', 'vcard', json)))).toEqual(JSON.parse(json))
  })

  it('экранирование спецсимволов', () => {
    const withComma = 'FN:Doe, John\n'
    const json = JSON.parse(run('vcard', 'json', withComma))
    expect(json.fn).toBe('Doe, John')
  })
})

describe('iCal (фаза 2)', () => {
  const ical = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UWC//EN',
    'BEGIN:VEVENT', 'UID:1', 'DTSTART:20260818T120000Z',
    'DTEND:20260818T130000Z', 'SUMMARY:Встреча с UWC', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2', 'SUMMARY:Ещё одна', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n')

  it('парсит события в массив', () => {
    expect(JSON.parse(run('ical', 'json', ical))).toEqual({
      vcalendar: {
        version: '2.0',
        prodid: '-//UWC//EN',
        vevent: [
          { uid: '1', dtstart: '20260818T120000Z', dtend: '20260818T130000Z', summary: 'Встреча с UWC' },
          { uid: '2', summary: 'Ещё одна' }
        ]
      }
    })
  })

  it('round-trip iCal → JSON → iCal', () => {
    const json = run('ical', 'json', ical)
    expect(JSON.parse(run('ical', 'json', run('json', 'ical', json)))).toEqual(JSON.parse(json))
  })
})

describe('TOML парсинг (фаза 2)', () => {
  it('скаляры: строки, числа, bool, datetime', () => {
    const toml = [
      'title = "UWC"',
      'version = "1.0"',
      'count = 42',
      'ratio = 3.14',
      'enabled = true',
      'when = 2026-08-20T12:00:00Z'
    ].join('\n')
    expect(JSON.parse(run('toml', 'json', toml))).toEqual({
      title: 'UWC',
      version: '1.0',
      count: 42,
      ratio: 3.14,
      enabled: true,
      when: expect.any(String) // Date → ISO string в JSON
    })
  })

  it('[table] и вложенные ключи', () => {
    const toml = [
      '[server]',
      'host = "example.com"',
      'port = 8080',
      '[server.ssl]',
      'enabled = true'
    ].join('\n')
    expect(JSON.parse(run('toml', 'json', toml))).toEqual({
      server: { host: 'example.com', port: 8080, ssl: { enabled: true } }
    })
  })

  it('[[array-of-tables]]', () => {
    const toml = [
      '[[items]]',
      'name = "a"',
      'v = 1',
      '[[items]]',
      'name = "b"',
      'v = 2'
    ].join('\n')
    expect(JSON.parse(run('toml', 'json', toml))).toEqual({
      items: [{ name: 'a', v: 1 }, { name: 'b', v: 2 }]
    })
  })

  it('массивы скаляров', () => {
    const toml = 'ports = [8080, 8443, 9000]\n'
    expect(JSON.parse(run('toml', 'json', toml))).toEqual({ ports: [8080, 8443, 9000] })
  })

  it('комментарии и пустые строки', () => {
    const toml = '# comment\n; another\n\nkey = "value"  \n'
    expect(JSON.parse(run('toml', 'json', toml))).toEqual({ key: 'value' })
  })

  it('round-trip JSON → TOML → JSON', () => {
    const input = {
      title: 'UWC',
      server: { host: 'example.com', port: 8080 },
      items: [{ name: 'a', v: 1 }, { name: 'b', v: 2 }]
    }
    const toml = run('json', 'toml', JSON.stringify(input))
    expect(JSON.parse(run('toml', 'json', toml))).toEqual(input)
  })

  it('quoted строки не коерцируются в числа', () => {
    const toml = 'port = "8080"\nflag = "true"\n'
    expect(JSON.parse(run('toml', 'json', toml))).toEqual({ port: '8080', flag: 'true' })
  })
})

describe('XML ↔ JSON (фаза 2)', () => {
  it('парсит XML в JSON', () => {
    const xml = '<?xml version="1.0"?><note priority="high"><to>Tove</to><from>Jani</from><body>Reminder</body></note>'
    const json = JSON.parse(run('xml', 'json', xml))
    expect(json.note['@_priority']).toBe('high')
    expect(json.note.to).toBe('Tove')
    expect(json.note.from).toBe('Jani')
    expect(json.note.body).toBe('Reminder')
  })

  it('сериализует JSON обратно в XML', () => {
    const xml = '<root><name>test</name><value>42</value></root>'
    const json = run('xml', 'json', xml)
    const back = run('json', 'xml', json)
    expect(back).toContain('<name>test</name>')
    expect(back).toContain('<value>42</value>')
  })

  it('round-trip XML → JSON → XML', () => {
    const xml = '<root><item>hello</item><item>world</item></root>'
    const json = run('xml', 'json', xml)
    expect(run('json', 'xml', json)).toBe(xml)
  })
})

describe('GeoJSON / KML / GPX (фаза 2)', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [12.5, 55.3] },
        properties: { name: 'Stockholm' }
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[12.0, 55.0], [12.5, 55.3]] },
        properties: { name: 'track-1' }
      }
    ]
  }

  it('GeoJSON → JSON сохраняет структуру', () => {
    expect(JSON.parse(run('geojson', 'json', JSON.stringify(geojson)))).toEqual(geojson)
  })

  it('KML с Point → GeoJSON', () => {
    const kml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      '    <Placemark>',
      '      <name>Stockholm</name>',
      '      <Point>',
      '        <coordinates>12.5,55.3</coordinates>',
      '      </Point>',
      '    </Placemark>',
      '  </Document>',
      '</kml>'
    ].join('\n')
    const result = JSON.parse(run('kml', 'geojson', kml)) as IrNode
    expect(result.type).toBe('FeatureCollection')
    const features = result.features as IrNode[]
    expect(features).toHaveLength(1)
    expect((features[0] as Record<string, IrNode>).geometry).toEqual({ type: 'Point', coordinates: [12.5, 55.3] })
  })

  it('GPX с waypoints → GeoJSON', () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <wpt lat="55.3" lon="12.5"><name>Stockholm</name></wpt>',
      '  <wpt lat="59.3" lon="18.1"><name>Stockholm-2</name></wpt>',
      '</gpx>'
    ].join('\n')
    const result = JSON.parse(run('gpx', 'geojson', gpx)) as IrNode
    const features = result.features as IrNode[]
    expect(features).toHaveLength(2)
    expect((features[0] as Record<string, IrNode>).geometry).toEqual({ type: 'Point', coordinates: [12.5, 55.3] })
    expect((features[1] as Record<string, IrNode>).geometry).toEqual({ type: 'Point', coordinates: [18.1, 59.3] })
  })

  it('GPX с track → GeoJSON LineString', () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <trk>',
      '    <trkseg>',
      '      <trkpt lat="55.0" lon="12.0"></trkpt>',
      '      <trkpt lat="55.3" lon="12.5"></trkpt>',
      '    </trkseg>',
      '  </trk>',
      '</gpx>'
    ].join('\n')
    const result = JSON.parse(run('gpx', 'geojson', gpx)) as IrNode
    const features = result.features as IrNode[]
    expect(features).toHaveLength(1)
    expect((features[0] as Record<string, IrNode>).geometry).toEqual({ type: 'LineString', coordinates: [[12.0, 55.0], [12.5, 55.3]] })
  })

  it('GeoJSON → CSV (таблица с координатами)', () => {
    const csv = geojsonToCsv(JSON.stringify(geojson))
    expect(csv).toContain('lon')
    expect(csv).toContain('lat')
    expect(csv).toContain('Stockholm')
    expect(csv).toContain('track-1')
  })

  it('round-trip KML → GeoJSON → KML сохраняет координаты точки', () => {
    const kml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      '    <Placemark>',
      '      <Point>',
      '        <coordinates>12.5,55.3</coordinates>',
      '      </Point>',
      '    </Placemark>',
      '  </Document>',
      '</kml>'
    ].join('\n')
    const geojson = run('kml', 'geojson', kml)
    const back = run('geojson', 'kml', geojson)
    expect(back).toContain('<coordinates>12.500000,55.300000</coordinates>')
  })

  it('GeoJSON → GPX создаёт валидный GPX', () => {
    const gpx = run('geojson', 'gpx', JSON.stringify(geojson))
    expect(gpx).toContain('<gpx')
    expect(gpx).toContain('<wpt')
    expect(gpx).toContain('lat="55.3"')
    expect(gpx).toContain('lon="12.5"')
    expect(gpx).toContain('<rtept')
  })
})
