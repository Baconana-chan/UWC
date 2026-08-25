import { describe, expect, it, vi } from 'vitest'
import { buildOtpAuthUri, generateOtp } from '../shared/totp'

describe('TOTP / HOTP', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

  it('matches the RFC 4226 HOTP vector', async () => {
    expect(await generateOtp({ mode: 'hotp', secret, counter: 0, digits: 6, algorithm: 'SHA-1', period: 30 })).toBe('755224')
    expect(await generateOtp({ mode: 'hotp', secret, counter: 1, digits: 6, algorithm: 'SHA-1', period: 30 })).toBe('287082')
  })

  it('matches the RFC 6238 TOTP vector', async () => {
    vi.setSystemTime(new Date(59_000))
    expect(await generateOtp({ mode: 'totp', secret, counter: 0, digits: 8, algorithm: 'SHA-1', period: 30 })).toBe('94287082')
    vi.useRealTimers()
  })

  it('builds an otpauth URI', () => {
    expect(buildOtpAuthUri({ mode: 'totp', secret, issuer: 'UWC', account: 'demo@example.com', period: 30, counter: 0, digits: 6, algorithm: 'SHA-1' }))
      .toBe('otpauth://totp/UWC%3Ademo%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=UWC&algorithm=SHA1&digits=6&period=30')
  })
})
