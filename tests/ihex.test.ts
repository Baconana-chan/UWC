import { describe, expect, it } from 'vitest'
import { ihexDecode, ihexEncode } from '../shared/ihex'

describe('Intel HEX', () => {
  it('кодирует и декодирует записи с checksum', () => {
    const encoded = ihexEncode('SGVsbG8=')
    expect(encoded).toContain(':0500000048656C6C6F')
    expect(ihexDecode(encoded)).toBe('SGVsbG8=')
  })

  it('отклоняет повреждённый checksum', () => {
    expect(() => ihexDecode(':010000004100')).toThrow('errors.badIhex')
  })
})
