export type OtpMode = 'totp' | 'hotp'
export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export interface OtpOptions {
  mode: OtpMode
  secret: string
  period: number
  counter: number
  digits: 6 | 8
  algorithm: OtpAlgorithm
}

function decodeBase32(input: string): Uint8Array {
  const value = input.replace(/[\s=-]/g, '').toUpperCase()
  if (!value || !/^[A-Z2-7]+$/.test(value)) throw new Error('totp.errors.badSecret')
  let buffer = 0
  let bits = 0
  const bytes: number[] = []
  for (const char of value) {
    buffer = (buffer << 5) | BASE32.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

function counterBytes(counter: number): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('totp.errors.badCounter')
  const result = new Uint8Array(8)
  let value = BigInt(counter)
  for (let i = 7; i >= 0; i--) {
    result[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return result
}

export async function generateOtp(options: OtpOptions): Promise<string> {
  const secret = decodeBase32(options.secret)
  const counter = options.mode === 'totp'
    ? Math.floor(Date.now() / 1000 / options.period)
    : options.counter
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: options.algorithm }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)))
  const offset = digest[digest.length - 1]! & 0x0f
  const binary = ((digest[offset]! & 0x7f) << 24)
    | (digest[offset + 1]! << 16)
    | (digest[offset + 2]! << 8)
    | digest[offset + 3]!
  return String(binary % (10 ** options.digits)).padStart(options.digits, '0')
}

export function buildOtpAuthUri(options: OtpOptions & { issuer: string; account: string }): string {
  const scheme = options.mode === 'totp' ? 'totp' : 'hotp'
  const label = [options.issuer.trim(), options.account.trim()].filter(Boolean).join(':') || 'UWC'
  const params = new URLSearchParams({
    secret: options.secret.replace(/[\s=-]/g, '').toUpperCase(),
    issuer: options.issuer.trim(),
    algorithm: options.algorithm.replace('-', ''),
    digits: String(options.digits)
  })
  if (options.mode === 'totp') params.set('period', String(options.period))
  else params.set('counter', String(options.counter))
  return `otpauth://${scheme}/${encodeURIComponent(label)}?${params.toString()}`
}
