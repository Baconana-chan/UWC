import { describe, expect, it } from 'vitest'
import { getGenerator } from '../shared/registry/generators'
import { buildWifiQr } from '../app/utils/qrConvert'

describe('NanoID and WiFi QR', () => {
  it('generates standard KSUIDs', () => {
    const value = getGenerator('ksuid')!.generate({} as never)
    expect(value).toHaveLength(27)
    expect(value).toMatch(/^[0-9A-Za-z]+$/)
    expect(getGenerator('ksuid')!.entropyBits({} as never, value)).toBe(128)
  })
  it('analyzes passwords as a generator result', () => {
    const generator = getGenerator('password-analyze')!
    const result = generator.generate({ password: 'qwerty' } as never)
    expect(result).toContain('common password')
    expect(result).not.toContain('qwerty')
  })
  it('generates standard URL-safe NanoIDs', () => {
    const generator = getGenerator('nanoid')!
    const value = generator.generate({ length: 21 } as never)
    expect(value).toHaveLength(21)
    expect(value).toMatch(/^[-_0-9A-Za-z]+$/)
    expect(generator.entropyBits({ length: 21 } as never, value)).toBe(126)
  })

  it('builds an escaped WiFi QR payload', () => {
    expect(buildWifiQr('Office;WiFi', 'p:ass\\word', 'WPA', true))
      .toBe('WIFI:T:WPA;S:Office\\;WiFi;P:p\\:ass\\\\word;H:true;;')
  })

  it('generates localized lorem/fake data and signs HS256 JWTs', async () => {
    const lorem = getGenerator('lorem')!.generate({ length: 2, lang: 'en' } as never) as string
    expect(lorem.split('\n\n')).toHaveLength(2)

    const fake = getGenerator('fake-data')!.generate({ length: 2, lang: 'ru' } as never) as string
    expect(fake.split('\n')).toHaveLength(2)
    expect(fake).toContain('@example.com')

    const token = await getGenerator('jwt-sign')!.generate({ secret: 'test-secret', payload: '{"sub":"123"}' } as never)
    const [header, payload, signature] = token.split('.')
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))))
    expect(decode(header!)).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(decode(payload!)).toEqual({ sub: '123' })
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates dice, coin flips and a random list choice', () => {
    const dice = getGenerator('dice')!.generate({ length: 5 } as never) as string
    expect(dice.split(', ')).toHaveLength(5)
    expect(dice.split(', ').every((value) => Number(value) >= 1 && Number(value) <= 6)).toBe(true)

    const coin = getGenerator('coin')!.generate({ length: 4 } as never) as string
    expect(coin.split(', ')).toHaveLength(4)
    expect(coin).toMatch(/^(heads|tails)(, (heads|tails)){3}$/)

    const choice = getGenerator('random-choice')!.generate({ choices: 'red\ngreen\nblue' } as never) as string
    expect(['red', 'green', 'blue']).toContain(choice)
  })

  it('generates and decodes Twitter/Discord Snowflake IDs', () => {
    const id = getGenerator('snowflake')!.generate({ snowflakeEpoch: 'twitter' } as never) as string
    expect(id).toMatch(/^\d+$/)
    expect(BigInt(id)).toBeLessThan(1n << 63n)

    const decoded = JSON.parse(getGenerator('snowflake-decode')!.generate({ input: id, snowflakeEpoch: 'twitter' } as never) as string)
    expect(decoded.id).toBe(id)
    expect(decoded.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(decoded.worker).toBeGreaterThanOrEqual(0)
    expect(decoded.worker).toBeLessThan(1024)
    expect(decoded.sequence).toBeGreaterThanOrEqual(0)
    expect(decoded.sequence).toBeLessThan(4096)

    const discordId = getGenerator('snowflake')!.generate({ snowflakeEpoch: 'discord' } as never) as string
    expect(JSON.parse(getGenerator('snowflake-decode')!.generate({ input: discordId, snowflakeEpoch: 'discord' } as never) as string).id).toBe(discordId)
  })
})
