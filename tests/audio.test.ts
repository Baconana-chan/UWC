import { describe, expect, it } from 'vitest'
import { encodePcm, type PcmBuffer, AUDIO_FORMAT_MIME } from '../app/utils/audioConvert'
import { AUDIO_SOURCE_FORMATS, AUDIO_TARGET_FORMATS } from '../shared/registry/formats'

/**
 * Тесты аудио-конвертера (Node-тесты, без Web Audio).
 *
 * Декодирование (decodeAudioFile) требует AudioContext — браузерный API,
 * поэтому покрываем энкодеры и PCM-хаб. Web Audio decode тестируется
 * вручную в браузере.
 */

describe('Аудио-форматы (реестр)', () => {
  it('10 входных форматов зарегистрировано', () => {
    expect(AUDIO_SOURCE_FORMATS).toHaveLength(10)
  })

  it('10 целевых форматов зарегистрировано', () => {
    expect(AUDIO_TARGET_FORMATS).toHaveLength(10)
  })

  it('входы охватывают все основные форматы', () => {
    const sources = AUDIO_SOURCE_FORMATS.map((f) => f.value)
    expect(sources).toEqual(
      expect.arrayContaining(['mp3', 'wav', 'ogg', 'flac', 'aiff', 'caf', 'opus', 'webm', 'm4a', 'qoa'])
    )
  })

  it('выходы охватывают все основные форматы', () => {
    const targets = AUDIO_TARGET_FORMATS.map((f) => f.value)
    expect(targets).toEqual(
      expect.arrayContaining(['wav', 'mp3', 'ogg', 'flac', 'aiff', 'caf', 'opus', 'webm', 'm4a', 'qoa'])
    )
  })

  it('MIME-типы на месте', () => {
    expect(AUDIO_FORMAT_MIME.wav).toBe('audio/wav')
    expect(AUDIO_FORMAT_MIME.mp3).toBe('audio/mpeg')
    expect(AUDIO_FORMAT_MIME.flac).toBe('audio/flac')
  })
})

describe('PCM-хаб (encodePcm)', () => {
  /** Тихий синусоидальный сигнал 1 секунда, 440 Гц, моно. */
  function makeTestPcm(): PcmBuffer {
    const sampleRate = 44100
    const frames = sampleRate
    const channel = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      channel[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.1
    }
    return { channels: [channel], sampleRate }
  }

  it('кодирует WAV через @audio/encode', async () => {
    const pcm = makeTestPcm()
    const target = AUDIO_TARGET_FORMATS.find((f) => f.value === 'wav')!
    const blob = await encodePcm(pcm, target)
    expect(blob.type).toBe('audio/wav')
    // WAV-файл начинается с RIFF
    const header = await blob.slice(0, 4).text()
    expect(header).toBe('RIFF')
  })

  it('кодирует FLAC через @audio/encode', async () => {
    const pcm = makeTestPcm()
    const target = AUDIO_TARGET_FORMATS.find((f) => f.value === 'flac')!
    const blob = await encodePcm(pcm, target)
    expect(blob.type).toBe('audio/flac')
    // FLAC начинается с fLaC
    const header = await blob.slice(0, 4).text()
    expect(header).toBe('fLaC')
  })

  it('кодирует OGG/Vorbis через @audio/encode', async () => {
    const pcm = makeTestPcm()
    const target = AUDIO_TARGET_FORMATS.find((f) => f.value === 'ogg')!
    const blob = await encodePcm(pcm, target)
    // OGG начинается с "OggS"
    const header = await blob.slice(0, 4).text()
    expect(header).toBe('OggS')
  })

  it('кодирует AIFF через @audio/encode', async () => {
    const pcm = makeTestPcm()
    const target = AUDIO_TARGET_FORMATS.find((f) => f.value === 'aiff')!
    const blob = await encodePcm(pcm, target)
    // AIFF начинается с FORM
    const header = await blob.slice(0, 4).text()
    expect(header).toBe('FORM')
  })

  it('кодирует стерео в моно (без падения)', async () => {
    const pcm: PcmBuffer = {
      channels: [new Float32Array(44100).fill(0), new Float32Array(44100).fill(0)],
      sampleRate: 44100
    }
    const target = AUDIO_TARGET_FORMATS.find((f) => f.value === 'wav')!
    const blob = await encodePcm(pcm, target)
    expect(blob.size).toBeGreaterThan(44) // не пустой WAV
  })

  it('выбрасывает ошибку на неизвестный формат', async () => {
    const pcm = makeTestPcm()
    const fakeTarget = { value: 'nope', label: 'NOPE', mime: 'x', ext: 'nope', icon: '' }
    await expect(encodePcm(pcm, fakeTarget as never)).rejects.toThrow()
  })

  it('передаёт битрейт в lossy-кодеки', async () => {
    const pcm = makeTestPcm()
    const target = AUDIO_TARGET_FORMATS.find((f) => f.value === 'mp3')!
    const blob128 = await encodePcm(pcm, target, 128)
    const blob320 = await encodePcm(pcm, target, 320)
    // Высокий битрейт → большой файл
    expect(blob320.size).toBeGreaterThan(blob128.size)
  })
})
