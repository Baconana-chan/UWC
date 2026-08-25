import { describe, expect, it } from 'vitest'
import { TEXT_CONVERTERS } from '../shared/registry/formats'

const run = (id: string, input: string) => TEXT_CONVERTERS.find((c) => c.id === id)!.run(input) as string

describe('text encodings', () => {
  it('formats and validates IBANs and converts chmod permissions', () => {
    expect(run('iban-format', 'gb82 west 1234 5698 7654 32')).toBe('GB82 WEST 1234 5698 7654 32')
    expect(run('iban-validate', 'GB82 WEST 1234 5698 7654 32')).toBe('Valid')
    expect(run('iban-validate', 'GB82 WEST 1234 5698 7654 33')).toBe('Invalid')
    expect(run('chmod-to-symbolic', '755')).toBe('rwxr-xr-x')
    expect(run('symbolic-to-chmod', 'rwxr-xr-x')).toBe('755')
    expect(run('symbolic-to-chmod', '-rwxr-xr-x')).toBe('755')
  })

  it('validates common checksums and computes CRC32', () => {
    expect(run('luhn-check', '49927398716')).toBe('Valid')
    expect(run('luhn-check', '49927398717')).toBe('Invalid')
    expect(run('inn-check', '500100732259')).toBe('Valid')
    expect(run('isbn-check', '0-306-40615-2')).toBe('Valid')
    expect(run('isbn-check', '978-0-306-40615-7')).toBe('Valid')
    expect(run('ean-upc-check', '4006381333931')).toBe('Valid')
    expect(run('ean-upc-check', '036000291452')).toBe('Valid')
    expect(run('crc32', '123456789')).toBe('CBF43926')
  })

  it('adds/removes Zalgo marks and creates slugs', () => {
    const zalgo = run('zalgo-add', 'Hi!')
    expect(zalgo).not.toBe('Hi!')
    expect(run('zalgo-remove', zalgo)).toBe('Hi!')
    expect(run('slugify', 'Привет, Мир! Café & Tea')).toBe('privet-mir-cafe-tea')
  })
  it('generates TypeScript interfaces from nested JSON', () => {
    const result = run('json-to-typescript', '{"name":"UWC","profile":{"active":true},"tags":["a","b"]}')
    expect(result).toContain('export interface Root')
    expect(result).toContain('profile: RootProfile;')
    expect(result).toContain('tags: string[];')
    expect(result).toContain('active: boolean;')
  })
  it('decodes JWT, glob, C escapes, shell args and paths', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjMifQ.signature'
    expect(JSON.parse(run('jwt-decode', jwt))).toEqual({ header: { alg: 'none' }, payload: { sub: '123' } })
    expect(run('glob-to-regex', '**/*.ts')).toBe('^.*/[^/]*\\.ts$')
    expect(run('c-escape-decode', '\\n\\t\\x41')).toBe('\n\tA')
    expect(run('c-escape-encode', 'a\nb')).toBe('a\\nb')
    expect(run('argv-split', 'bash:\necho "hello world"')).toBe('echo\nhello world')
    expect(run('windows-to-posix', 'C:\\Users\\VIC\\file.txt')).toBe('/c/Users/VIC/file.txt')
    expect(run('posix-to-windows', '/c/Users/VIC/file.txt')).toBe('C:\\Users\\VIC\\file.txt')
  })
  it('converts canonical Roman numerals', () => {
    expect(run('arabic-to-roman', '1994')).toBe('MCMXCIV')
    expect(run('roman-to-arabic', 'MCMXCIV')).toBe('1994')
    expect(() => run('roman-to-arabic', 'IIII')).toThrow('errors.badRoman')
  })
  it('converts HEX, RGB and HSL colors', () => {
    expect(run('hex-to-rgb', '#ff0080')).toBe('rgb(255, 0, 128)')
    expect(run('rgb-to-hex', 'rgb(255, 0, 128)')).toBe('#ff0080')
    expect(run('rgb-to-hsl', 'rgb(255, 0, 0)')).toBe('hsl(0, 100%, 50%)')
    expect(run('hsl-to-rgb', 'hsl(120, 100%, 50%)')).toBe('rgb(0, 255, 0)')
  })
  it('handles line operations, arbitrary bases and durations', () => {
    expect(run('sort-lines', 'z\na\nb')).toBe('a\nb\nz')
    expect(run('dedupe-lines', 'a\nb\na')).toBe('a\nb')
    expect(run('number-lines', 'a\nb')).toBe('1. a\n2. b')
    expect(run('wrap-text', '10\none two three four')).toBe('one two\nthree four')
    expect(run('number-base-convert', '10:16\n255')).toBe('ff')
    expect(run('number-base-convert', '2:10\n1010')).toBe('10')
    expect(run('iso-duration-to-seconds', 'PT1H30M')).toBe('5400')
    expect(run('seconds-to-iso-duration', '5400')).toBe('PT1H30M')
  })
  it('hides and extracts a zero-width steganographic message', () => {
    const encoded = run('stego-encode', 'Public note\n---\nСекрет 🔐')
    expect(encoded.startsWith('Public note')).toBe(true)
    expect(encoded).not.toContain('Секрет')
    expect(run('stego-decode', encoded)).toBe('Секрет 🔐')
  })
  it('converts CSV and TSV to Markdown tables', () => {
    expect(run('csv-to-markdown', 'Name,Note\nAlice,"a | b"')).toBe('| Name | Note |\n| --- | --- |\n| Alice | a \\| b |')
    expect(run('tsv-to-markdown', 'A\tB\n1\t2')).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  it('round-trips Java properties and .env through JSON', () => {
    expect(JSON.parse(run('properties-to-json', '# comment\napp.name=Demo\nport: 8080\n'))).toEqual({ 'app.name': 'Demo', port: '8080' })
    expect(run('json-to-properties', '{"app":{"name":"Demo"},"port":8080}')).toBe('app.name=Demo\nport=8080')
    expect(JSON.parse(run('env-to-json', 'export PORT=8080\nNAME="UWC Tool"\n'))).toEqual({ PORT: '8080', NAME: 'UWC Tool' })
    expect(run('json-to-env', '{"PORT":"8080","NAME":"UWC Tool"}')).toBe('PORT=8080\nNAME="UWC Tool"')
  })
  it('renders BBCode as escaped safe HTML', () => {
    expect(run('bbcode-to-html', '[b]Hello[/b] [url=https://example.com]link[/url]\n[quote]text[/quote]'))
      .toBe('<strong>Hello</strong> <a href="https://example.com" rel="noopener noreferrer">link</a><br>\n<blockquote>text</blockquote>')
    expect(run('bbcode-to-html', '[b]<script>alert(1)</script>[/b]')).toBe('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>')
  })
  it('converts HJSON and JSON', () => {
    const hjson = '{ foo: bar, count: 2, enabled: true, // comment\n tags: [one, two,], }'
    expect(JSON.parse(run('hjson-to-json', hjson))).toEqual({ foo: 'bar', count: 2, enabled: true, tags: ['one', 'two'] })
    expect(run('json-to-hjson', '{"foo":"bar","count":2}')).toContain('foo: bar')
    expect(JSON.parse(run('hjson-to-json', run('json-to-hjson', '{"foo":"bar","count":2}')))).toEqual({ foo: 'bar', count: 2 })
  })

  it('formats MAC addresses in common notations', () => {
    const mac = 'AA:BB:CC:DD:EE:FF'
    expect(run('mac-to-colon', mac)).toBe('aa:bb:cc:dd:ee:ff')
    expect(run('mac-to-dash', mac)).toBe('aa-bb-cc-dd-ee-ff')
    expect(run('mac-to-cisco', mac)).toBe('aabb.ccdd.eeff')
    expect(run('mac-to-plain', '0xaabb.ccdd.eeff')).toBe('aabbccddeeff')
  })

  it('converts Unix timestamps and ISO 8601 dates', () => {
    expect(run('unix-to-iso', 's:0')).toBe('1970-01-01T00:00:00.000Z')
    expect(run('unix-to-iso', 'ms:1704067200123')).toBe('2024-01-01T00:00:00.123Z')
    expect(run('iso-to-unix', 'ms:2024-01-01T00:00:00.123Z')).toBe('1704067200123')
    expect(run('iso-to-unix', 's:1970-01-01T00:00:01.900Z')).toBe('1')
  })

  it('cleans invisible characters and typography from pasted text', () => {
    expect(run('unfuck-paste', '\u200B“Hello”\u00A0—\u2060world…\r\nIt’s fine')).toBe('"Hello" -world...\r\nIt\'s fine')
  })

  it('converts Japanese full-width and half-width forms', () => {
    expect(run('fullwidth-to-halfwidth', 'ＡＢＣ　カタカナ ガバ')).toBe('ABC ｶﾀｶﾅ ｶﾞﾊﾞ')
    expect(run('halfwidth-to-fullwidth', 'ABC ｶﾀｶﾅ ｶﾞﾊﾞ')).toBe('ＡＢＣ　カタカナ　ガバ')
  })

  it('round-trips Baudot / ITA2 with letter and figure shifts', () => {
    const encoded = run('baudot-encode', 'TEST 123')
    expect(encoded).toBe('10000 00001 00101 10000 00100 11011 10111 10011 00001')
    expect(run('baudot-decode', encoded)).toBe('TEST 123')
  })

  it('round-trips IBM CP037 EBCDIC as hex', () => {
    expect(run('ebcdic-encode', 'HELLO 123')).toBe('C8C5D3D3D640F1F2F3')
    expect(run('ebcdic-decode', 'C8 C5 D3 D3 D6 40 F1 F2 F3')).toBe('HELLO 123')
  })

  it('supports ROT47, Atbash, Caesar and XOR with a key', () => {
    expect(run('rot47', 'Hello!')).toBe('w6==@P')
    expect(run('atbash', 'Abc XYZ')).toBe('Zyx CBA')
    expect(run('caesar-encode', 'Hello')).toBe('Khoor')
    expect(run('caesar-decode', 'Khoor')).toBe('Hello')
    const encrypted = run('xor-encode', 'secret\nHello')
    expect(run('xor-decode', `secret\n${encrypted}`)).toBe('Hello')
  })

  it('supports A1Z26, Bacon, tap code and stripping diacritics', () => {
    expect(run('a1z26-encode', 'ABC XYZ')).toBe('1 2 3 / 24 25 26')
    expect(run('a1z26-decode', '1 2 3 / 24 25 26')).toBe('ABC XYZ')
    expect(run('bacon-encode', 'AB')).toBe('aaaaa aaaab')
    expect(run('bacon-decode', 'aaaaa aaaab')).toBe('AB')
    expect(run('tap-code-encode', 'ABC')).toBe('11 12 13')
    expect(run('tap-code-decode', '11 12 13')).toBe('ABC')
    expect(run('strip-diacritics', 'Crème brûlée — déjà vu')).toBe('Creme brulee — deja vu')
  })

  it('round-trips Quoted-Printable and Uuencode', () => {
    const text = 'Hello, мир!\nSecond line.'
    expect(run('quoted-printable-decode', run('quoted-printable-encode', text))).toBe(text.replace(/\n/g, '\r\n'))
    expect(run('uudecode', run('uuencode', text))).toBe(text)
  })

  it('encodes and decodes Morse with word separators', () => {
    expect(run('morse-encode', 'SOS HELP')).toBe('... --- ... / .... . .-.. .--.')
    expect(run('morse-decode', '... --- ... / .... . .-.. .--.')).toBe('SOS HELP')
    expect(run('morse-encode', 'Ж')).toBe('...-')
  })

  it('converts IDN domains and preserves URL parts', () => {
    expect(run('idn-encode', 'пример.рф')).toBe('xn--e1afmkfd.xn--p1ai')
    expect(run('idn-decode', 'xn--e1afmkfd.xn--p1ai')).toBe('пример.рф')
    expect(run('idn-decode', 'xn--80ak6aa92e.xn--p1ai')).toBe('аррӏе.рф')
    expect(run('idn-encode', 'https://пример.рф/path?q=1')).toBe('https://xn--e1afmkfd.xn--p1ai/path?q=1')
  })

  it('round-trips UTF-8 through Base32, Base36 and Base62', () => {
    for (const name of ['base32', 'base36', 'base62']) {
      const encoded = run(name + '-encode', 'Hello, мир!')
      expect(run(name + '-decode', encoded)).toBe('Hello, мир!')
    }
  })
  it('implements RFC 4648 Base32 vector', () => {
    expect(run('base32-encode', 'foobar')).toBe('MZXW6YTBOI======')
    expect(run('base32-decode', 'MZXW6YTBOI======')).toBe('foobar')
  })
  it('round-trips Ascii85 and accepts Adobe wrappers', () => {
    expect(run('ascii85-encode', 'Man')).toBe('9jqo')
    expect(run('ascii85-decode', '<~9jqo~>')).toBe('Man')
    expect(run('ascii85-encode', '\0\0\0\0')).toBe('z')
  })
})
