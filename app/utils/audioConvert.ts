import type { AudioFormatDef } from '#shared/registry/formats'

/**
 * Аудио-конвертация целиком в браузере — без ffmpeg и без сервера.
 *
 * Архитектура PCM-хаб:
 *   1. Декодер (Web Audio `decodeAudioData`) → AudioBuffer (PCM, Float32Array[]).
 *   2. Энкодер `@audio/encode-*` (ленивая загрузка) → целевой формат.
 *
 * Поддерживаемые входы: MP3, WAV, OGG/Vorbis, OGG/Opus, FLAC, AIFF, CAF, QOA,
 * WebM/Opus, M4A/AAC/ALAC — всё, что умеет `decodeAudioData`.
 * Поддерживаемые выходы: WAV, AIFF, CAF, MP3, OGG, FLAC, Opus, WebM, AAC, QOA.
 * GPL-пакеты (`@audio/decode-aac`, `@audio/decode-wma`) НЕ используются —
 * AAC-вход добираем через Web Audio, как описано в решении README.
 */

/** PCM-хаб: Float32 массивы по каналам + частота дискретизации. */
export interface PcmBuffer {
  channels: Float32Array[]
  sampleRate: number
}

/** Декодирует аудиофайл в PCM-буфер (что умеет браузер — то и открываем). */
export async function decodeAudioFile(file: File): Promise<PcmBuffer> {
  const arrayBuffer = await file.arrayBuffer()

  // 1) Пытаемся Web Audio (поддерживает MP3/WAV/OGG/M4A/FLAC/AIFF/CAF/WebM)
  if (typeof AudioContext !== 'undefined') {
    const ctx = new AudioContext()
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      const channels: Float32Array[] = []
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++)
        channels.push(audioBuffer.getChannelData(ch))
      return { channels, sampleRate: audioBuffer.sampleRate }
    }
    finally {
      ctx.close().catch(() => {})
    }
  }

  throw new Error('studio.errors.unsupportedAudio')
}

/**
 * Карта аудио-форматов → MIME и расширения для заголовка Blob.
 */
export const AUDIO_FORMAT_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  qoa: 'audio/qoa'
}

/**
 * Кодеки @audio/encode, которые требуют WebCodecs/нативной поддержки.
 * Зарезервировано для capability-проб (см. TODO.md, graceful degradation).
 */
const _WEBCODECS_FORMATS = new Set(['aac'])

/**
 * Проверка: поддерживает ли браузер выходной формат.
 */
export function canEncode(format: string): boolean {
  // WAV/AIFF/CAF/MP3/OGG/FLAC/Opus/QOA/WebM — всегда доступны через @audio/encode
  if (format === 'aac' && typeof AudioEncoder === 'undefined') return false
  return true
}

/**
 * Аудио-хаб → целевой формат через @audio/encode (ленивая загрузка кодека).
 */
export async function encodePcm(
  pcm: PcmBuffer,
  target: AudioFormatDef,
  kbps = 192
): Promise<Blob> {
  const format = target.value

  if (!canEncode(format))
    throw new Error('studio.errors.unsupportedAudio')

  // @audio/encode принимает AudioBuffer-like: { numberOfChannels, getChannelData }
  const audioBufferLike = {
    numberOfChannels: pcm.channels.length,
    getChannelData: (i: number) => pcm.channels[i]!,
    sampleRate: pcm.sampleRate,
    length: pcm.channels[0]?.length ?? 0
  }

  // Ленивая загрузка: @audio/encode сам импортирует нужный суб-пакет кодека
  const { default: encode } = await import('@audio/encode')

  const opts: Record<string, unknown> = {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.length
  }

  // Битрейт для lossy-форматов (передаём в kbps, как ожидают энкодеры @audio/encode)
  if (['mp3', 'ogg', 'opus', 'webm', 'aac'].includes(format))
    opts.bitrate = kbps

  // Опус/WebM приложение
  if (format === 'opus' || format === 'webm')
    opts.application = 'audio'

  const uint8 = await encode(format as never, audioBufferLike as never, opts as never)
  return new Blob([uint8], { type: AUDIO_FORMAT_MIME[format] ?? 'application/octet-stream' })
}

/**
 * Обратная совместимость: старые функции используются в тестах и UI.
 */

/** MP3 через lamejs (устаревший путь, оставлен для backward-compat). */
export async function audioBufferToMp3(buffer: AudioBuffer, kbps = 192): Promise<Blob> {
  return encodePcm(
    { channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), sampleRate: buffer.sampleRate },
    { value: 'mp3', label: 'MP3', mime: 'audio/mpeg', ext: 'mp3', icon: 'vscode-icons:file-type-audio' } as AudioFormatDef,
    kbps
  )
}

/** WAV (16-bit PCM, RIFF) — через @audio/encode для единообразия. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  // Берём старую рукописную функцию для WAV-кода, чтобы не ломать тесты
  return audioBufferToWavManual(buffer)
}

/** Ручной WAV-кодер (16-bit PCM, RIFF) — быстрый и без зависимостей. */
function audioBufferToWavManual(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const blockAlign = numChannels * 2
  const dataSize = numFrames * blockAlign

  const arrayBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(arrayBuffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++)
    channels.push(buffer.getChannelData(ch))

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setInt16(offset, floatTo16Bit(channels[ch]![i]!), true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

/** Единая точка входа для студии: file + target → Blob. */
export async function convertAudioFile(file: File, target: AudioFormatDef, kbps = 192): Promise<Blob> {
  const pcm = await decodeAudioFile(file)

  // WAV — используем ручной энкодер (быстрее, меньше кода в bundle)
  if (target.value === 'wav') {
    const buffer = new AudioBuffer({ length: pcm.channels[0]?.length ?? 0, sampleRate: pcm.sampleRate, numberOfChannels: pcm.channels.length })
    for (let ch = 0; ch < pcm.channels.length; ch++)
      buffer.getChannelData(ch).set(pcm.channels[ch]!)
    return audioBufferToWav(buffer)
  }

  // Все остальные форматы — через @audio/encode
  return encodePcm(pcm, target, kbps)
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function writeAscii(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++)
    view.setUint8(offset + i, str.charCodeAt(i))
}

function floatTo16Bit(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample))
  return s < 0 ? s * 0x8000 : s * 0x7fff
}
