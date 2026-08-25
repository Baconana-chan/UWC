export interface DecodedRaster { width: number, height: number, pixels: Uint8ClampedArray }

const text = new TextDecoder()
function fail(): never { throw new Error('errors.badImage') }
function rgba(width: number, height: number): Uint8ClampedArray { if (width < 1 || height < 1 || width * height > 100_000_000) fail(); return new Uint8ClampedArray(width * height * 4) }
function put(out: Uint8ClampedArray, index: number, r: number, g: number, b: number, a = 255) { const p = index * 4; out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a }

function netpbm(data: Uint8Array): DecodedRaster {
  const ascii = text.decode(data)
  const magic = ascii.slice(0, 2)
  if (!/P[1-6]/.test(magic) && !ascii.startsWith('P7')) return fail()
  let at = 2
  const token = () => { while (at < data.length && (data[at] === 35 || data[at]! <= 32)) { if (data[at] === 35) while (at < data.length && data[at++] !== 10); else at++ } const start = at; while (at < data.length && data[at]! > 32) at++; return text.decode(data.subarray(start, at)) }
  let width: number, height: number, max = 1, channels: number
  if (magic === 'P7') {
    const header = ascii.slice(2, ascii.indexOf('ENDHDR') + 6)
    const get = (key: string) => new RegExp(`\\n${key}\\s+(\\d+)`).exec(header)?.[1]
    width = Number(get('WIDTH')); height = Number(get('HEIGHT')); max = Number(get('MAXVAL') ?? 255); channels = Number(get('DEPTH') ?? 1)
    at = ascii.indexOf('ENDHDR') + 6
    while (data[at] === 10 || data[at] === 13 || data[at] === 32) at++
  }
  else { width = Number(token()); height = Number(token()); if (magic !== 'P1' && magic !== 'P4') max = Number(token()); channels = magic === 'P3' || magic === 'P6' ? 3 : 1; if (!Number.isInteger(width) || !Number.isInteger(height)) return fail() }
  const out = rgba(width, height)
  const sample = (i: number) => max > 255 ? (data[i]! * 256 + data[i + 1]!) * 255 / max : data[i]! * 255 / max
  const binary = magic === 'P4' || magic === 'P5' || magic === 'P6' || magic === 'P7'
  if (binary) {
    let i = at
    while (i < data.length && data[i]! <= 32) i++
    if (magic === 'P4') for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = (data[i + (x >> 3)]! >> (7 - (x & 7))) & 1; put(out, y * width + x, v ? 0 : 255, v ? 0 : 255, v ? 0 : 255) ; if (x === width - 1) i += Math.ceil(width / 8) }
    else for (let p = 0; p < width * height; p++) { const values = [sample(i), channels > 1 ? sample(i + (max > 255 ? 2 : 1)) : sample(i), channels > 2 ? sample(i + 2 * (max > 255 ? 2 : 1)) : sample(i)]; put(out, p, values[0]!, values[1]!, values[2]!); i += channels * (max > 255 ? 2 : 1) }
  }
  else { const values = ascii.slice(at).match(/(?:#[^\n]*|\S+)/g)?.filter(v => !v.startsWith('#')).map(Number) ?? []; let i = 0; for (let p = 0; p < width * height; p++) { const r = values[i++]! * 255 / max; const g = channels > 1 ? values[i++]! * 255 / max : r; const b = channels > 2 ? values[i++]! * 255 / max : r; put(out, p, r, g, b) } }
  return { width, height, pixels: out }
}

function xbm(source: string): DecodedRaster {
  const width = Number(/#define\s+\w+_width\s+(\d+)/.exec(source)?.[1]); const height = Number(/#define\s+\w+_height\s+(\d+)/.exec(source)?.[1]); const values = source.match(/0x[0-9a-f]+/gi)?.map(v => Number.parseInt(v, 16)) ?? []
  const out = rgba(width, height); const rowBytes = Math.ceil(width / 8)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = (values[y * rowBytes + (x >> 3)]! >> (x & 7)) & 1; put(out, y * width + x, v ? 0 : 255, v ? 0 : 255, v ? 0 : 255) }
  return { width, height, pixels: out }
}

function wbmp(data: Uint8Array): DecodedRaster {
  if (data[0] !== 0 || data[1] !== 0) return fail(); let at = 2
  const read = () => { let value = 0, b; do { b = data[at++]!; value = (value << 7) | (b & 127) } while (b & 128); return value }
  const width = read(), height = read(), out = rgba(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = (data[at + (x >> 3)]! >> (7 - (x & 7))) & 1; put(out, y * width + x, v ? 0 : 255, v ? 0 : 255, v ? 0 : 255); if (x === width - 1) at += Math.ceil(width / 8) }
  return { width, height, pixels: out }
}

function tga(data: Uint8Array): DecodedRaster {
  if (data.length < 18) return fail(); const id = data[0]!, type = data[2]!, width = data[12]! | (data[13]! << 8), height = data[14]! | (data[15]! << 8), bpp = data[16]!, top = !!(data[17]! & 0x20), right = !!(data[17]! & 0x10)
  if (![2, 3, 10, 11].includes(type) || ![8, 16, 24, 32].includes(bpp) || data[1] !== 0) return fail()
  const out = rgba(width, height); let at = 18 + id, pixel = 0
  const readPixel = () => { if (bpp === 8) { const v = data[at++]!; return [v, v, v, 255] } if (bpp === 16) { const word = data[at++]! | (data[at++]! << 8); return [((word >> 10) & 31) * 255 / 31, ((word >> 5) & 31) * 255 / 31, (word & 31) * 255 / 31, 255] } const b = data[at++]!, g = data[at++]!, r = data[at++]!; return [r, g, b, bpp === 32 ? data[at++]! : 255] }
  while (pixel < width * height) { let count = 1, run = false; if (type === 10 || type === 11) { const packet = data[at++]!; run = !!(packet & 0x80); count = (packet & 127) + 1 } const value = readPixel(); for (let n = 0; n < count; n++) { const x = pixel % width, y0 = Math.floor(pixel / width), x2 = right ? width - 1 - x : x, y = top ? y0 : height - 1 - y0; put(out, y * width + x2, value[0]!, value[1]!, value[2]!, value[3]); pixel++; if (!run && n + 1 < count) { const next = readPixel(); value[0] = next[0]!; value[1] = next[1]!; value[2] = next[2]!; value[3] = next[3]! } } }
  return { width, height, pixels: out }
}

function pcx(data: Uint8Array): DecodedRaster {
  if (data.length < 128 || data[0] !== 0x0a || data[2] !== 1 || data[3] !== 8) return fail()
  const width = (data[8]! | (data[9]! << 8)) - (data[4]! | (data[5]! << 8)) + 1, height = (data[10]! | (data[11]! << 8)) - (data[6]! | (data[7]! << 8)) + 1, planes = data[65]!, rowBytes = data[66]! | (data[67]! << 8)
  if (!width || !height || ![1, 3].includes(planes)) return fail(); const rows: number[][] = []; let at = 128
  for (let y = 0; y < height; y++) { const row: number[] = []; while (row.length < rowBytes * planes && at < data.length) { const b = data[at++]!; if ((b & 0xc0) === 0xc0) { const n = b & 63, v = data[at++]!; for (let i = 0; i < n; i++) row.push(v) } else row.push(b) } rows.push(row) }
  const out = rgba(width, height), palette = data.length >= 769 && data[data.length - 769] === 12 ? data.subarray(data.length - 768) : null
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let r, g, b; if (planes === 3) { r = rows[y]![x]!; g = rows[y]![rowBytes + x]!; b = rows[y]![2 * rowBytes + x]! } else { const v = rows[y]![x]!; r = palette ? palette[v * 3]! : v; g = palette ? palette[v * 3 + 1]! : v; b = palette ? palette[v * 3 + 2]! : v } put(out, y * width + x, r!, g!, b!) }
  return { width, height, pixels: out }
}

function cur(data: Uint8Array): DecodedRaster {
  if (data.length < 22 || data[0] || data[1] || data[2] !== 2) return fail(); const width = data[6] || 256, height = data[7] || 256, bits = data[14]! | (data[15]! << 8), offset = new DataView(data.buffer, data.byteOffset).getUint32(18, true), out = rgba(width, height); let at = offset + 40
  for (let y = height - 1; y >= 0; y--) for (let x = 0; x < width; x++) { const b = data[at++]!, g = data[at++]!, r = data[at++]!, a = bits === 32 ? data[at++]! : 255; put(out, y * width + x, r, g, b, a) }
  return { width, height, pixels: out }
}

export async function decodeLegacyImage(file: File): Promise<DecodedRaster | null> {
  const data = new Uint8Array(await file.arrayBuffer()); const lower = file.name.toLowerCase(); const source = text.decode(data)
  if (/\.(?:ppm|pgm|pbm|pam)$/i.test(lower) || /^P[1-7]/.test(source)) return netpbm(data)
  if (/\.xbm$/i.test(lower) || source.includes('_width') && source.includes('_height')) return xbm(source)
  if (/\.wbmp$/i.test(lower)) return wbmp(data)
  if (/\.tga$/i.test(lower)) return tga(data)
  if (/\.pcx$/i.test(lower)) return pcx(data)
  if (/\.cur$/i.test(lower)) return cur(data)
  return null
}
