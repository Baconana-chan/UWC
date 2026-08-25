<script setup lang="ts">
import { buildWifiQr, decodeQrFromFile, generateQrPng, type WifiSecurity } from '../utils/qrConvert'

const { t } = useI18n()

/* генерация */
const qrText = ref('')
const qrImage = ref('')
const genError = ref('')
const generating = ref(false)
const wifiSsid = ref('')
const wifiPassword = ref('')
const wifiSecurity = ref<WifiSecurity>('WPA')
const wifiHidden = ref(false)
const wifiSecurityItems = [
  { label: 'WPA / WPA2 / WPA3', value: 'WPA' },
  { label: 'WEP', value: 'WEP' },
  { label: 'Open network', value: 'nopass' }
]

function fillWifiQr() {
  qrText.value = buildWifiQr(wifiSsid.value, wifiPassword.value, wifiSecurity.value, wifiHidden.value)
  genError.value = ''
}

/* декодирование */
const qrFile = ref<File | null>(null)
const decoded = ref('')
const decError = ref('')
const decoding = ref(false)
const copied = ref(false)

async function generate() {
  genError.value = ''
  if (!qrText.value) {
    genError.value = t('studio.qr.noText')
    return
  }
  generating.value = true
  try {
    qrImage.value = await generateQrPng(qrText.value)
  }
  catch (e) {
    qrImage.value = ''
    genError.value = e instanceof Error ? e.message : t('studio.errors.convFailed')
  }
  finally {
    generating.value = false
  }
}

async function decode() {
  decError.value = ''
  decoded.value = ''
  if (!qrFile.value) {
    decError.value = t('studio.qr.noFile')
    return
  }
  decoding.value = true
  try {
    decoded.value = await decodeQrFromFile(qrFile.value)
  }
  catch (e) {
    decError.value = e instanceof Error ? e.message : t('studio.qr.decodeFailed')
  }
  finally {
    decoding.value = false
  }
}

function clearQrFile() {
  qrFile.value = null
  decoded.value = ''
  decError.value = ''
}

function downloadQr() {
  if (!qrImage.value) return
  const a = document.createElement('a')
  a.href = qrImage.value
  a.download = 'uwc-qr.png'
  a.click()
}

async function copyDecoded() {
  if (!decoded.value) return
  await navigator.clipboard.writeText(decoded.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="space-y-8 p-5 sm:p-7">
    <!-- items-start: UwcTextField внутри имеет h-full — растянутая гридом карточка
         выталкивает кнопку за свой край (она наезжала на подпись ниже) -->
    <div class="grid items-start gap-8 lg:grid-cols-2">
      <!-- генерация: текст → QR -->
      <div class="space-y-3">
        <h3 class="font-display text-sm font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">
          {{ t('studio.qr.generateTitle') }}
        </h3>
        <UwcTextField
          v-model="qrText"
          :label="t('studio.qr.textLabel')"
          :placeholder="t('studio.qr.textPlaceholder')"
          class="min-h-40"
        />
        <div class="space-y-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-3">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('studio.qr.wifiTitle') }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <UInput v-model="wifiSsid" :placeholder="t('studio.qr.wifiSsid')" size="sm" />
            <UInput v-model="wifiPassword" :placeholder="t('studio.qr.wifiPassword')" type="password" size="sm" />
            <USelect v-model="wifiSecurity" :items="wifiSecurityItems" size="sm" />
            <UCheckbox v-model="wifiHidden" :label="t('studio.qr.wifiHidden')" />
          </div>
          <UButton :label="t('studio.qr.wifiBuild')" icon="i-lucide-wifi" variant="soft" block @click="fillWifiQr" />
        </div>
        <p v-if="genError" class="text-sm text-red-500 dark:text-red-400">{{ genError }}</p>
        <UButton
          :label="t('studio.qr.generate')"
          icon="i-lucide-qr-code"
          color="primary"
          block
          :loading="generating"
          @click="generate"
        />
        <div v-if="qrImage" class="space-y-3 pt-1">
          <img :src="qrImage" alt="QR code" class="mx-auto w-48 rounded-lg border border-[var(--ui-border)] bg-white p-2">
          <UButton
            :label="t('studio.qr.downloadPng')"
            icon="i-lucide-download"
            color="neutral"
            variant="soft"
            block
            @click="downloadQr"
          />
        </div>
      </div>

      <!-- декодирование: QR → текст -->
      <div class="space-y-3">
        <h3 class="font-display text-sm font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">
          {{ t('studio.qr.decodeTitle') }}
        </h3>
        <UwcDropzone :file="qrFile" @file="(f) => { qrFile = f; decError = ''; decoded = '' }" @clear="clearQrFile" />
        <div v-if="qrFile" class="flex items-center justify-between gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-3 py-2">
          <span class="truncate text-sm">{{ qrFile.name }}</span>
          <UButton icon="i-lucide-x" variant="ghost" color="neutral" size="sm" :aria-label="t('studio.file.remove')" @click="clearQrFile" />
        </div>
        <p v-if="decError" class="text-sm text-red-500 dark:text-red-400">{{ decError }}</p>
        <UButton
          :label="t('studio.qr.decode')"
          icon="i-lucide-scan-line"
          color="primary"
          block
          :loading="decoding"
          :disabled="!qrFile"
          @click="decode"
        />
        <UwcTextField
          v-if="decoded"
          v-model="decoded"
          :label="t('studio.qr.resultLabel')"
          :placeholder="t('studio.qr.resultPlaceholder')"
          readonly
          class="min-h-28"
        >
          <template #actions>
            <UButton
              icon="i-lucide-copy"
              variant="ghost"
              color="neutral"
              size="sm"
              :label="copied ? t('studio.copied') : undefined"
              :disabled="!decoded"
              :aria-label="t('studio.copy')"
              @click="copyDecoded"
            />
          </template>
        </UwcTextField>
      </div>
    </div>

    <p class="text-xs leading-relaxed text-[var(--ui-text-dimmed)]">
      <UIcon name="i-lucide-shield-check" class="mr-1 inline size-4 align-[-2px] text-primary-400" />
      {{ t('studio.qr.footer') }}
    </p>
  </div>
</template>
