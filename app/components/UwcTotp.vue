<script setup lang="ts">
import { buildOtpAuthUri, generateOtp, type OtpAlgorithm, type OtpMode } from '#shared/totp'

const { t } = useI18n()

const mode = ref<OtpMode>('totp')
const secret = ref('JBSWY3DPEHPK3PXP')
const issuer = ref('UWC')
const account = ref('demo@example.com')
const algorithm = ref<OtpAlgorithm>('SHA-1')
const digits = ref<6 | 8>(6)
const period = ref(30)
const counter = ref(0)
const code = ref('')
const uri = ref('')
const error = ref('')
const secondsLeft = ref(30)
let timer: ReturnType<typeof setInterval> | undefined
let request = 0

const modeItems = computed(() => [
  { label: t('totp.modes.totp'), value: 'totp' },
  { label: t('totp.modes.hotp'), value: 'hotp' }
])
const algorithmItems = [
  { label: 'SHA-1', value: 'SHA-1' },
  { label: 'SHA-256', value: 'SHA-256' },
  { label: 'SHA-512', value: 'SHA-512' }
]
const digitsItems = [
  { label: '6', value: 6 },
  { label: '8', value: 8 }
]

async function refresh() {
  const current = ++request
  error.value = ''
  uri.value = buildOtpAuthUri({ mode: mode.value, secret: secret.value, issuer: issuer.value, account: account.value, algorithm: algorithm.value, digits: digits.value, period: period.value, counter: counter.value })
  try {
    const next = await generateOtp({ mode: mode.value, secret: secret.value, algorithm: algorithm.value, digits: digits.value, period: period.value, counter: counter.value })
    if (current === request) code.value = next
  }
  catch (e) {
    if (current === request) {
      code.value = ''
      error.value = e instanceof Error ? t(e.message) : t('totp.errors.badSecret')
    }
  }
}

function tick() {
  secondsLeft.value = mode.value === 'totp' ? period.value - (Math.floor(Date.now() / 1000) % period.value) : 0
  if (mode.value === 'totp' && secondsLeft.value === period.value) void refresh()
}

watch([mode, secret, issuer, account, algorithm, digits, period, counter], () => void refresh())
onMounted(() => {
  void refresh()
  tick()
  timer = setInterval(tick, 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

async function copy(value: string) {
  if (value) await navigator.clipboard.writeText(value)
}
</script>

<template>
  <div class="space-y-5 p-5 sm:p-7">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 class="font-display text-lg font-semibold">{{ t('totp.title') }}</h3>
        <p class="text-sm text-[var(--ui-text-muted)]">{{ t('totp.subtitle') }}</p>
      </div>
      <USelect v-model="mode" :items="modeItems" size="lg" class="w-full sm:w-44" />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <UInput v-model="secret" :placeholder="t('totp.secret')" size="lg" class="font-mono sm:col-span-2" />
      <UInput v-model="issuer" :placeholder="t('totp.issuer')" size="lg" />
      <UInput v-model="account" :placeholder="t('totp.account')" size="lg" />
      <USelect v-model="algorithm" :items="algorithmItems" size="lg" />
      <USelect v-model="digits" :items="digitsItems" size="lg" />
      <UInputNumber v-if="mode === 'totp'" v-model="period" :min="1" :max="3600" size="lg" :placeholder="t('totp.period')" />
      <UInputNumber v-else v-model="counter" :min="0" size="lg" :placeholder="t('totp.counter')" />
    </div>

    <div class="rounded-2xl border border-primary-500/30 bg-primary-500/5 p-5 text-center">
      <p class="text-xs uppercase tracking-widest text-[var(--ui-text-muted)]">{{ t('totp.code') }}</p>
      <p class="my-2 font-mono text-5xl font-bold tracking-[0.2em] text-primary-400">{{ code || '••••••' }}</p>
      <p v-if="mode === 'totp'" class="text-xs text-[var(--ui-text-muted)]">{{ t('totp.expiresIn', { seconds: secondsLeft }) }}</p>
      <UButton v-if="mode === 'hotp'" :label="t('totp.next')" icon="i-lucide-refresh-cw" size="sm" variant="soft" @click="counter++" />
    </div>

    <p v-if="error" class="text-sm text-red-500 dark:text-red-400">{{ error }}</p>

    <div class="space-y-2">
      <label class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('totp.uri') }}</label>
      <div class="flex gap-2">
        <UTextarea :model-value="uri" readonly :rows="2" class="flex-1 font-mono text-xs" />
        <UButton icon="i-lucide-copy" variant="outline" color="neutral" :disabled="!uri" :aria-label="t('totp.copy')" @click="copy(uri)" />
      </div>
    </div>

    <p class="text-xs text-[var(--ui-text-muted)]"><UIcon name="i-lucide-shield-check" class="mr-1 size-3 text-green-400" />{{ t('totp.localNote') }}</p>
  </div>
</template>
