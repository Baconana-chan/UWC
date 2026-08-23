<script setup lang="ts">
import { AUDIO_SOURCE_FORMATS, AUDIO_TARGET_FORMATS, getTextConverter, guessAudioSource, guessImageSource, IMAGE_SERVER_TARGETS, IMAGE_SOURCE_FORMATS, isClientImagePair, TEXT_CONVERTER_GROUPS, TEXT_CONVERTERS } from '#shared/registry/formats'
import { convertImageFile, convertImageOnServer, formatBytes } from '../utils/imageConvert'
import { convertAudioFile } from '../utils/audioConvert'
import { convertTextOnServer, fetchServerFormats } from '../composables/useServerFormats'
import { extractArchiveEntry, formatZipSize, listArchive, type ArchiveFormat } from '../utils/zipUtils'

const { t, locale } = useI18n()

type Tab = 'text' | 'image' | 'audio' | 'gen' | 'qr' | 'zip'
const tab = ref<Tab>('text')

const tabs = [
  { labelKey: 'studio.tabText', value: 'text', icon: 'i-lucide-text-cursor' },
  { labelKey: 'studio.tabImage', value: 'image', icon: 'i-lucide-file-image' },
  { labelKey: 'studio.tabAudio', value: 'audio', icon: 'i-lucide-music' },
  { labelKey: 'studio.tabGenerator', value: 'gen', icon: 'i-lucide-key-round' },
  { labelKey: 'studio.tabQr', value: 'qr', icon: 'i-lucide-qr-code' },
  { labelKey: 'studio.tabArchive', value: 'zip', icon: 'i-lucide-archive' }
]

/* ---------------- текст ---------------- */

const convId = ref<string>()
const input = ref('')
const output = ref('')
const textError = ref('')
const converting = ref(false)
const copied = ref(false)
const textOnServer = ref(false) // отслеживает fallback на сервер

// deep-link из wiki: /converter?from=json&to=yaml — предвыбираем конвертацию
// (id пары в реестре имеет вид `<from>-to-<to>`)
if (import.meta.client) {
  const q = new URLSearchParams(window.location.search)
  const from = q.get('from')
  const to = q.get('to')
  if (from && to) {
    const pairId = `${from}-to-${to}`
    if (TEXT_CONVERTERS.some((c) => c.id === pairId)) {
      convId.value = pairId
      tab.value = 'text'
    }
  }
}

const selectItems = computed(() => TEXT_CONVERTER_GROUPS.map((group) => [
  { type: 'label', label: t(`groups.${group.id}.label`) },
  ...group.items.map((c) => ({
    label: `${t(`conv.${c.id}.from`)} → ${t(`conv.${c.id}.to`)}`,
    description: t(`conv.${c.id}.description`),
    value: c.id,
    icon: c.icon
  }))
]))

const conv = computed(() => (convId.value ? getTextConverter(convId.value) : undefined))

function swap() {
  if (!conv.value?.reverseId) return
  convId.value = conv.value.reverseId
}

/** Цвет индикатора маршрута конвертации для текущей вкладки */
const currentRouteColor = computed(() => {
  if (tab.value === 'image') return serverImage.value ? 'error' : 'success'
  if (tab.value === 'text') return textOnServer.value ? 'error' : 'success'
  return 'success'
})

/** Текст индикатора маршрута для текущей вкладки */
const currentRouteLabel = computed(() => {
  if (tab.value === 'text') return textOnServer.value ? t('studio.file.convertedOnServer') : t('studio.clientSide')
  if (tab.value === 'image') return serverImage.value ? t('studio.file.convertedOnServer') : t('studio.file.convertedInBrowser')
  return t('studio.clientSide')
})

async function convertText() {
  textError.value = ''
  output.value = ''
  textOnServer.value = false
  if (!conv.value) {
    textError.value = t('studio.errors.noConv')
    return
  }
  if (!input.value) {
    textError.value = t('studio.errors.noInput')
    return
  }
  converting.value = true
  try {
    const c = conv.value
    // 1) клиентский конвертер (уровень A) — без сети
    output.value = c.runL ? await c.runL(input.value, t) : await c.run(input.value)
  }
  catch (e) {
    output.value = ''
    // 2) fallback на сервер (уровень B) — если пара есть в серверном реестре
    const [from, to] = conv.value.id.split('-to-')
    if (from && to) {
      const serverAvailable = await hasServerConverter(from, to)
      if (serverAvailable) {
        try {
          output.value = await convertTextOnServer(from, to, input.value)
          textOnServer.value = true
          return
        }
        catch (se) {
          textError.value = se instanceof Error ? t(se.message) : t('studio.errors.convFailed')
          return
        }
      }
    }
    textError.value = e instanceof Error ? t(e.message) : t('studio.errors.convFailed')
  }
  finally {
    converting.value = false
  }
}

async function copyOutput() {
  if (!output.value) return
  await navigator.clipboard.writeText(output.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function downloadOutput() {
  if (!output.value) return
  const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uwc-${conv.value?.id ?? 'output'}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function clearAll() {
  input.value = ''
  output.value = ''
  textError.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    if (tab.value === 'text')
      convertText()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // прогреваем кэш серверных конвертеров — fallback при падении клиентского konverter
  fetchServerFormats().catch(() => {})
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/* ---------------- изображения ---------------- */

const file = ref<File | null>(null)
const srcFormat = ref('png')
const dstFormat = ref('webp')
const imgResult = ref<string | null>(null)
const fileError = ref('')
const fileConverting = ref(false)

const srcItems = IMAGE_SOURCE_FORMATS.map((f) => ({ label: f.label, value: f.value, icon: f.icon }))
const dstItems = IMAGE_SERVER_TARGETS.map((f) => ({ label: f.label, value: f.value, icon: f.icon }))

const srcDef = computed(() => IMAGE_SOURCE_FORMATS.find((f) => f.value === srcFormat.value))
const dstDef = computed(() => IMAGE_SERVER_TARGETS.find((f) => f.value === dstFormat.value)!)

/** true — конвертация уедет на сервер (sharp), false — посчитает canvas */
const serverImage = computed(() => !isClientImagePair(srcFormat.value, dstFormat.value))

/** Форматы, которые браузер умеет показывать в <img> (TIFF/ICO не умеет). */
const PREVIEWABLE_IMAGE = new Set(['png', 'jpeg', 'webp', 'gif', 'avif', 'svg'])

/** true, если формат файла не удалось распознать — не выдаём его за PNG */
const srcUnknown = ref(false)

function onFile(f: File) {
  file.value = f
  fileError.value = ''
  imgResult.value = null
  const guess = guessImageSource(f)
  srcUnknown.value = !guess
  if (guess)
    srcFormat.value = guess.value
  else
    fileError.value = t('studio.errors.unsupportedImage')
}

async function convertImage() {
  fileError.value = ''
  imgResult.value = null
  if (!file.value) {
    fileError.value = t('studio.errors.noFile')
    return
  }
  if (srcUnknown.value) {
    fileError.value = t('studio.errors.unsupportedImage')
    return
  }
  if (srcFormat.value === dstFormat.value) {
    fileError.value = t('studio.errors.sameFormat')
    return
  }
  fileConverting.value = true
  try {
    const blob = serverImage.value
      ? await convertImageOnServer(file.value, srcFormat.value, dstFormat.value)
      : await convertImageFile(file.value, dstDef.value)
    if (imgResult.value)
      URL.revokeObjectURL(imgResult.value)
    imgResult.value = URL.createObjectURL(blob)
  }
  catch (e) {
    imgResult.value = null
    fileError.value = e instanceof Error ? t(e.message) : t('studio.errors.convFailed')
  }
  finally {
    fileConverting.value = false
  }
}

function downloadImage() {
  if (!imgResult.value || !file.value) return
  const a = document.createElement('a')
  a.href = imgResult.value
  a.download = `${file.value.name.replace(/\.[^.]+$/, '')}.${dstDef.value.ext}`
  a.click()
}

function clearFile() {
  file.value = null
  imgResult.value = null
  fileError.value = ''
}

onBeforeUnmount(() => {
  if (imgResult.value)
    URL.revokeObjectURL(imgResult.value)
})

/* ---------------- аудио ---------------- */

const audioFile = ref<File | null>(null)
const audioSrc = ref('mp3')
const audioDst = ref('wav')
const audioKbps = ref(192)
const audioResult = ref<string | null>(null)
const audioError = ref('')
const audioConverting = ref(false)

const audioSrcItems = AUDIO_SOURCE_FORMATS.map((f) => ({ label: f.label, value: f.value, icon: f.icon }))
const audioDstItems = AUDIO_TARGET_FORMATS.map((f) => ({ label: f.label, value: f.value, icon: f.icon }))

const audioSrcDef = computed(() => AUDIO_SOURCE_FORMATS.find((f) => f.value === audioSrc.value))
const audioDstDef = computed(() => AUDIO_TARGET_FORMATS.find((f) => f.value === audioDst.value)!)

/** Форматы, где есть смысл выбирать битрейт (lossy). */
const LOSSY_AUDIO = new Set(['mp3', 'ogg', 'opus', 'webm', 'm4a'])
const audioDstLossy = computed(() => LOSSY_AUDIO.has(audioDst.value))

/** true, если формат аудио не распознан — не выдаём его за MP3 */
const audioSrcUnknown = ref(false)

function onAudioFile(f: File) {
  audioFile.value = f
  audioError.value = ''
  audioResult.value = null
  const guess = guessAudioSource(f)
  audioSrcUnknown.value = !guess
  if (guess)
    audioSrc.value = guess.value
  else
    audioError.value = t('studio.errors.unsupportedAudio')
}

async function convertAudio() {
  audioError.value = ''
  audioResult.value = null
  if (!audioFile.value) {
    audioError.value = t('studio.errors.noAudio')
    return
  }
  if (audioSrcUnknown.value) {
    audioError.value = t('studio.errors.unsupportedAudio')
    return
  }
  if (audioSrc.value === audioDst.value) {
    audioError.value = t('studio.errors.sameFormat')
    return
  }
  audioConverting.value = true
  try {
    const blob = await convertAudioFile(audioFile.value, audioDstDef.value, audioDstLossy.value ? audioKbps.value : 192)
    if (audioResult.value)
      URL.revokeObjectURL(audioResult.value)
    audioResult.value = URL.createObjectURL(blob)
  }
  catch (e) {
    audioError.value = e instanceof Error ? e.message : t('studio.errors.convFailed')
  }
  finally {
    audioConverting.value = false
  }
}

function downloadAudio() {
  if (!audioResult.value || !audioFile.value) return
  const a = document.createElement('a')
  a.href = audioResult.value
  a.download = `${audioFile.value.name.replace(/\.[^.]+$/, '')}.${audioDstDef.value.ext}`
  a.click()
}

function clearAudio() {
  audioFile.value = null
  audioResult.value = null
  audioError.value = ''
}

onBeforeUnmount(() => {
  if (audioResult.value)
    URL.revokeObjectURL(audioResult.value)
})

/* ---------------- архивы (ZIP) ---------------- */

const zipFile = ref<File | null>(null)
const zipEntries = ref<{ name: string; size: number }[]>([])
const zipError = ref('')
const zipLoading = ref(false)
const zipFormat = ref<ArchiveFormat | null>(null)
const zipData = ref<Uint8Array | null>(null)

function onZipFile(f: File) {
  zipFile.value = f
  zipError.value = ''
  zipEntries.value = []
  zipFormat.value = null
  zipData.value = null
  listZipFiles(f)
}

async function listZipFiles(f: File) {
  zipLoading.value = true
  try {
    const buf = new Uint8Array(await f.arrayBuffer())
    zipData.value = buf
    const { format, entries } = await listArchive(buf, f.name)
    zipFormat.value = format
    zipEntries.value = entries
  }
  catch (e) {
    zipError.value = e instanceof Error ? t(e.message) : t('studio.errors.convFailed')
    zipEntries.value = []
  }
  finally {
    zipLoading.value = false
  }
}

function clearZip() {
  zipFile.value = null
  zipEntries.value = []
  zipError.value = ''
  zipFormat.value = null
  zipData.value = null
}

function downloadZipEntry(name: string, file: File) {
  ;(async () => {
    const data = zipData.value ?? new Uint8Array(await file.arrayBuffer())
    const entry = await extractArchiveEntry(data, file.name, name)
    if (!entry) return
    const blob = new Blob([entry as BlobPart])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  })()
}
</script>

<template>
  <section id="converter" class="scroll-mt-24 px-4 sm:px-6">
    <div class="glass mx-auto max-w-5xl overflow-hidden rounded-3xl border border-[var(--ui-border)] shadow-2xl shadow-black/20">
      <!-- header -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ui-border)] px-5 py-4 sm:px-7">
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-400">
            <UIcon name="i-lucide-wand-sparkles" class="size-5" />
          </div>
          <div>
            <h2 class="font-display text-base font-bold sm:text-lg">{{ t('studio.title') }}</h2>
            <p class="text-xs text-[var(--ui-text-muted)] sm:text-sm">{{ t('studio.subtitle') }}</p>
          </div>
        </div>
        <UBadge
          :color="currentRouteColor"
          variant="soft"
          :label="currentRouteLabel"
        />
      </div>

      <UTabs v-model="tab" :items="tabs.map((tb) => ({ ...tb, label: t(tb.labelKey) }))" color="primary" variant="pill" class="px-5 pt-5 sm:px-7" />

      <!-- ТЕКСТ -->
      <div v-if="tab === 'text'" class="space-y-4 p-5 sm:p-7">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <USelect
            v-model="convId"
            :items="selectItems"
            size="lg"
            :placeholder="t('studio.selectPlaceholder')"
            class="w-full sm:flex-1"
          />
          <UTooltip v-if="conv?.reverseId" :text="t('studio.swap')">
            <UButton
              icon="i-lucide-arrow-right-left"
              variant="outline"
              color="neutral"
              size="lg"
              :aria-label="t('studio.swap')"
              @click="swap"
            />
          </UTooltip>
          <UButton
            v-else
            icon="i-lucide-arrow-right-left"
            variant="outline"
            color="neutral"
            size="lg"
            disabled
            :aria-label="t('studio.swap')"
          />
        </div>

        <div class="flex items-center gap-2 text-sm">
          <UBadge
            :color="textOnServer ? 'error' : 'success'"
            variant="soft"
            :label="conv ? t(`conv.${conv.id}.from`) : '…'"
          />
          <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
          <UBadge
            :color="textOnServer ? 'error' : 'success'"
            variant="soft"
            :label="conv ? t(`conv.${conv.id}.to`) : '…'"
          />
          <span v-if="conv" class="hidden truncate text-xs text-[var(--ui-text-muted)] md:block">
            {{ t(`conv.${conv.id}.description`) }}
          </span>
        </div>

        <div class="grid items-stretch gap-4 lg:grid-cols-2">
          <UwcTextField
            v-model="input"
            :label="t('studio.inputLabel')"
            :placeholder="t('studio.inputPlaceholder')"
            class="min-h-52"
          />

          <UwcTextField
            v-model="output"
            :label="t('studio.outputLabel')"
            :placeholder="t('studio.outputPlaceholder')"
            readonly
            class="min-h-52"
          >
            <template #actions>
              <UButton
                icon="i-lucide-copy"
                variant="ghost"
                color="neutral"
                size="sm"
                :label="copied ? t('studio.copied') : undefined"
                :disabled="!output"
                :aria-label="t('studio.copy')"
                @click="copyOutput"
              />
              <UButton
                icon="i-lucide-download"
                variant="ghost"
                color="neutral"
                size="sm"
                :disabled="!output"
                :aria-label="t('studio.downloadTxt')"
                @click="downloadOutput"
              />
              <UButton
                icon="i-lucide-trash-2"
                variant="ghost"
                color="neutral"
                size="sm"
                :aria-label="t('studio.clear')"
                @click="clearAll"
              />
            </template>
          </UwcTextField>
        </div>

        <p v-if="textError" class="text-sm text-red-500 dark:text-red-400">{{ textError }}</p>
        <div v-if="output" class="space-y-3">
          <div class="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-3 py-2 text-xs">
            <UIcon name="i-lucide-shield-check" class="size-3" :class="textOnServer ? 'text-red-400' : 'text-green-400'" />
            <span class="text-[var(--ui-text-muted)]">{{ textOnServer ? t('studio.file.convertedOnServer') : t('studio.clientSide') }}</span>
          </div>
          <div v-if="textOnServer" class="rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 p-3 text-xs text-[var(--ui-text-muted)]">
            <UIcon name="i-lucide-info" class="mr-1 size-3 text-amber-400" />
            {{ t('studio.privacyNotice') }}
          </div>
        </div>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-1.5 text-xs text-[var(--ui-text-muted)]">
            <UKbd>Ctrl</UKbd>
            <span>+</span>
            <UKbd>Enter</UKbd>
            <span class="hidden sm:inline">— {{ t('studio.kbdHint') }}</span>
          </div>
          <UButton
            :label="t('studio.convert')"
            icon="i-lucide-wand-sparkles"
            color="primary"
            size="lg"
            :loading="converting"
            @click="convertText"
          />
        </div>
      </div>

      <!-- QR -->
      <UwcQr v-else-if="tab === 'qr'" />

      <!-- ГЕНЕРАТОР -->
      <UwcGenerator v-else-if="tab === 'gen'" />

      <!-- ИЗОБРАЖЕНИЯ -->
      <div v-else-if="tab === 'image'" class="space-y-4 p-5 sm:p-7">
        <UwcDropzone :file="file" kind="image" @file="onFile" @clear="clearFile" />

        <div v-if="file" class="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-4 py-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <UIcon name="i-lucide-file-image" class="size-5" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ file.name }}</p>
              <p class="text-xs text-[var(--ui-text-muted)]">{{ formatBytes(file.size, locale) }} · {{ srcUnknown ? t('studio.file.unknownFormat') : srcDef?.label }}</p>
            </div>
          </div>
          <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="sm" :aria-label="t('studio.file.remove')" @click="clearFile" />
        </div>

        <div v-if="file && !srcUnknown" class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="flex-1 space-y-1.5">
            <label class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.file.from') }}</label>
            <USelect v-model="srcFormat" :items="srcItems" size="lg" />
          </div>
          <UIcon name="i-lucide-arrow-right" class="hidden size-5 self-center text-[var(--ui-text-dimmed)] sm:block" />
          <UIcon name="i-lucide-arrow-down" class="size-5 self-center text-[var(--ui-text-dimmed)] sm:hidden" />
          <div class="flex-1 space-y-1.5">
            <label class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.file.to') }}</label>
            <USelect v-model="dstFormat" :items="dstItems" size="lg" />
          </div>
          <UButton
            :label="t('studio.convert')"
            icon="i-lucide-wand-sparkles"
            color="primary"
            size="lg"
            :loading="fileConverting"
            @click="convertImage"
          />
        </div>

        <p v-if="fileError" class="text-sm text-red-500 dark:text-red-400">{{ fileError }}</p>

        <div v-if="imgResult" class="space-y-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.file.done') }}</span>
            <UBadge
              color="success"
              variant="soft"
              :label="serverImage ? t('studio.file.convertedOnServer') : t('studio.file.convertedInBrowser')"
            />
          </div>
          <img v-if="PREVIEWABLE_IMAGE.has(dstFormat)" :src="imgResult" alt="Result" class="mx-auto max-h-72 rounded-lg">
          <UButton :label="t('studio.file.download')" icon="i-lucide-download" color="primary" block @click="downloadImage" />
        </div>

        <p class="text-xs leading-relaxed text-[var(--ui-text-dimmed)]">
          {{ t('studio.file.footer') }}
        </p>
      </div>

      <!-- АУДИО -->
      <div v-else-if="tab === 'audio'" class="space-y-4 p-5 sm:p-7">
        <UwcDropzone :file="audioFile" kind="audio" @file="onAudioFile" @clear="clearAudio" />

        <div v-if="audioFile" class="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-4 py-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <UIcon name="i-lucide-music" class="size-5" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ audioFile.name }}</p>
              <p class="text-xs text-[var(--ui-text-muted)]">{{ formatBytes(audioFile.size, locale) }} · {{ audioSrcUnknown ? t('studio.file.unknownFormat') : audioSrcDef?.label }}</p>
            </div>
          </div>
          <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="sm" :aria-label="t('studio.file.remove')" @click="clearAudio" />
        </div>

        <div v-if="audioFile && !audioSrcUnknown" class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="flex-1 space-y-1.5">
            <label class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.file.from') }}</label>
            <USelect v-model="audioSrc" :items="audioSrcItems" size="lg" />
          </div>
          <UIcon name="i-lucide-arrow-right" class="hidden size-5 self-center text-[var(--ui-text-dimmed)] sm:block" />
          <UIcon name="i-lucide-arrow-down" class="size-5 self-center text-[var(--ui-text-dimmed)] sm:hidden" />
          <div class="flex-1 space-y-1.5">
            <label class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.file.to') }}</label>
            <USelect v-model="audioDst" :items="audioDstItems" size="lg" />
          </div>
          <UInput
            v-if="audioDstLossy"
            v-model="audioKbps"
            type="number"
            min="64"
            max="320"
            step="1"
            size="lg"
            class="w-24"
          >
            <template #label>
              <span class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.audio.bitrate') }}</span>
            </template>
          </UInput>
          <UButton
            :label="t('studio.convert')"
            icon="i-lucide-wand-sparkles"
            color="primary"
            size="lg"
            :loading="audioConverting"
            @click="convertAudio"
          />
        </div>

        <p v-if="audioError" class="text-sm text-red-500 dark:text-red-400">{{ audioError }}</p>

        <div v-if="audioResult" class="space-y-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.file.done') }}</span>
            <UBadge :color="currentRouteColor" variant="soft" :label="currentRouteLabel" />
          </div>
          <audio :src="audioResult" controls class="w-full" />
          <UButton :label="t('studio.file.download')" icon="i-lucide-download" color="primary" block @click="downloadAudio" />
        </div>

        <p class="text-xs leading-relaxed text-[var(--ui-text-dimmed)]">
          {{ t('studio.audio.footer') }}
        </p>
      </div>

      <!-- АРХИВЫ -->
      <div v-else class="space-y-4 p-5 sm:p-7">
        <UwcDropzone :file="zipFile" kind="archive" @file="onZipFile" @clear="clearZip" />

        <div v-if="zipFile" class="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-4 py-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
              <UIcon name="i-lucide-archive" class="size-5" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ zipFile.name }}</p>
              <p class="text-xs text-[var(--ui-text-muted)]">{{ formatBytes(zipFile.size, locale) }}</p>
            </div>
          </div>
          <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="sm" :aria-label="t('studio.file.remove')" @click="clearZip" />
        </div>

        <div v-if="zipError" class="text-sm text-red-500 dark:text-red-400">{{ zipError }}</div>

        <div v-else-if="zipLoading" class="py-8 text-center text-[var(--ui-text-muted)]">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" />
          <span class="ml-2">{{ t('studio.file.done') }}…</span>
        </div>

        <div v-else-if="zipEntries.length > 0" class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.archive.entries', zipEntries.length) }}</span>
            <UBadge v-if="zipFormat" :label="zipFormat.toUpperCase()" variant="soft" color="neutral" size="sm" />
          </div>
          <div class="max-h-80 overflow-y-auto rounded-xl border border-[var(--ui-border)]">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]">
                  <th class="px-3 py-2 text-[var(--ui-text-muted)]">{{ t('studio.archive.colFile') }}</th>
                  <th class="px-3 py-2 text-right text-[var(--ui-text-muted)]">{{ t('studio.archive.colSize') }}</th>
                  <th class="px-3 py-2 text-center">↓</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in zipEntries" :key="entry.name" class="border-b border-[var(--ui-border)] last:border-0">
                  <td class="px-3 py-2 font-mono text-xs">{{ entry.name }}</td>
                  <td class="px-3 py-2 text-right text-[var(--ui-text-dimmed)]">{{ formatZipSize(entry.size) }}</td>
                  <td class="px-3 py-2 text-center">
                    <UButton
                      icon="i-lucide-download"
                      variant="ghost"
                      color="neutral"
                      size="sm"
                      :aria-label="t('studio.archive.download', { name: entry.name })"
                      @click="downloadZipEntry(entry.name, zipFile!)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-else class="text-xs text-[var(--ui-text-muted)]">
          {{ t('studio.archive.emptyHint') }}
        </div>

        <p class="text-xs leading-relaxed text-[var(--ui-text-dimmed)]">
          {{ t('studio.archive.footer') }}
        </p>
      </div>
    </div>
  </section>
</template>
