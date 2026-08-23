<script setup lang="ts">
import { GENERATORS, getGenerator, UUID_NAMESPACES, type GeneratorId, type GeneratorOptions } from '#shared/registry/generators'

const { t, locale } = useI18n()

const genId = ref<GeneratorId>('password')
const opts = reactive<GeneratorOptions>({
  length: 24,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
  wordCount: 4,
  separator: '-',
  prefix: 'uwc_',
  min: 0,
  max: 1_000_000,
  name: 'uwc.example',
  namespace: 'dns',
  lang: locale.value.startsWith('ru') ? 'ru' : 'en'
})

const namespaceItems = (Object.keys(UUID_NAMESPACES) as (keyof typeof UUID_NAMESPACES)[]).map((key) => ({
  label: t(`gen.namespaces.${key}`),
  value: key
}))

const result = ref('')
const genError = ref('')
const copied = ref(false)
const mounted = ref(false)

const gen = computed(() => getGenerator(genId.value))

const selectItems = computed(() => GENERATORS.map((g) => ({
  label: t(`gen.defs.${g.id}.label`),
  description: t(`gen.defs.${g.id}.description`),
  value: g.id,
  icon: g.icon
})))

const entropy = computed(() => {
  if (!gen.value || !result.value)
    return null
  const bits = gen.value.entropyBits({ ...opts }, result.value)
  if (bits === null)
    return null
  return {
    bits,
    label: bits >= 100 ? 'strong' : bits >= 60 ? 'normal' : 'weak',
    tone: bits >= 100 ? 'success' : bits >= 60 ? 'warning' : 'error'
  } as const
})

function regenerate() {
  if (!mounted.value || !gen.value)
    return
  genError.value = ''
  try {
    result.value = gen.value.generate({ ...opts })
  }
  catch (e) {
    result.value = ''
    genError.value = e instanceof Error ? t(e.message) : t('gen.errors.noSets')
  }
}

watch(() => ({ id: genId.value, opts: { ...opts } }), regenerate, { deep: true })

// словарь парольной фразы следует за языком интерфейса
watch(locale, (l) => {
  opts.lang = l.startsWith('ru') ? 'ru' : 'en'
})

onMounted(() => {
  mounted.value = true
  regenerate()
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    regenerate()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

async function copyResult() {
  if (!result.value)
    return
  await navigator.clipboard.writeText(result.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function downloadResult() {
  if (!result.value)
    return
  const blob = new Blob([result.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uwc-${genId.value}.txt`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-4 p-5 sm:p-7">
    <!-- тип + кнопка -->
    <div class="flex flex-col gap-3 sm:flex-row">
      <USelect
        v-model="genId"
        :items="selectItems"
        size="lg"
        :placeholder="t('gen.selectPlaceholder')"
        class="w-full sm:flex-1"
      />
      <UButton
        :label="t('gen.generate')"
        icon="i-lucide-wand-sparkles"
        color="primary"
        size="lg"
        @click="regenerate"
      />
    </div>

    <p v-if="gen" class="text-xs text-[var(--ui-text-muted)]">{{ t(`gen.defs.${gen.id}.description`) }}</p>

    <!-- опции -->
    <div class="space-y-3">
      <!-- длина / байты -->
      <div v-if="gen?.controls.length" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">
          {{ t(gen.controls.length.labelKey) }}
        </span>
        <USlider
          v-model="opts.length"
          :min="gen.controls.length.min"
          :max="gen.controls.length.max"
          :step="gen.controls.length.step ?? 1"
          size="sm"
          class="flex-1"
        />
        <span class="w-10 shrink-0 text-right text-sm tabular-nums text-[var(--ui-text-toned)]">{{ opts.length }}</span>
      </div>

      <!-- наборы символов -->
      <div v-if="gen?.controls.sets" class="flex flex-wrap items-center gap-x-5 gap-y-2">
        <UCheckbox v-model="opts.lowercase" :label="t('gen.sets.lower')" color="primary" />
        <UCheckbox v-model="opts.uppercase" :label="t('gen.sets.upper')" color="primary" />
        <UCheckbox v-model="opts.digits" :label="t('gen.sets.digits')" color="primary" />
        <UCheckbox v-model="opts.symbols" :label="t('gen.sets.symbols')" color="primary" />
        <UCheckbox v-model="opts.excludeAmbiguous" :label="t('gen.sets.noAmbiguous')" color="primary" />
      </div>

      <!-- слова фразы -->
      <div v-if="gen?.controls.wordCount" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">
          {{ t(gen.controls.wordCount.labelKey) }}
        </span>
        <USlider
          v-model="opts.wordCount"
          :min="gen.controls.wordCount.min"
          :max="gen.controls.wordCount.max"
          size="sm"
          class="flex-1"
        />
        <span class="w-10 shrink-0 text-right text-sm tabular-nums text-[var(--ui-text-toned)]">{{ opts.wordCount }}</span>
      </div>

      <!-- разделитель фразы -->
      <div v-if="gen?.controls.separator" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('gen.controls.separator') }}</span>
        <UInput v-model="opts.separator" maxlength="4" size="sm" class="w-24" />
      </div>

      <!-- префикс API-ключа -->
      <div v-if="gen?.controls.prefix" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('gen.controls.prefix') }}</span>
        <UInput v-model="opts.prefix" placeholder="uwc_ / sk- / ghp_…" size="sm" class="w-56" />
      </div>

      <!-- диапазон числа -->
      <div v-if="gen?.controls.range" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('gen.controls.range') }}</span>
        <UInputNumber v-model="opts.min" size="sm" class="w-36" />
        <span class="text-[var(--ui-text-dimmed)]">…</span>
        <UInputNumber v-model="opts.max" size="sm" class="w-36" />
      </div>

      <!-- namespace для name-based UUID -->
      <div v-if="gen?.controls.namespace" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('gen.controls.namespace') }}</span>
        <USelect v-model="opts.namespace" :items="namespaceItems" size="sm" class="w-40" />
      </div>

      <!-- имя для name-based UUID -->
      <div v-if="gen?.controls.name" class="flex items-center gap-3">
        <span class="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ t('gen.controls.name') }}</span>
        <UInput v-model="opts.name" size="sm" class="w-64" />
      </div>
    </div>

    <p v-if="genError" class="text-sm text-red-500 dark:text-red-400">{{ genError }}</p>

    <!-- вывод -->
    <UwcTextField
      v-model="result"
      :label="t('gen.resultLabel')"
      :placeholder="t('gen.resultPlaceholder')"
      readonly
      class="min-h-40"
    >
      <template #actions>
        <UButton
          icon="i-lucide-copy"
          variant="ghost"
          color="neutral"
          size="sm"
          :label="copied ? t('gen.copied') : undefined"
          :disabled="!result"
          :aria-label="t('gen.copy')"
          @click="copyResult"
        />
        <UButton
          icon="i-lucide-download"
          variant="ghost"
          color="neutral"
          size="sm"
          :disabled="!result"
          :aria-label="t('gen.downloadTxt')"
          @click="downloadResult"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          color="neutral"
          size="sm"
          :disabled="!mounted"
          :aria-label="t('gen.again')"
          @click="regenerate"
        />
      </template>
    </UwcTextField>

    <!-- энтропия + безопасность -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2 text-xs text-[var(--ui-text-muted)]">
        <UIcon name="i-lucide-shield-check" class="size-4 text-primary-400" />
        {{ t('gen.securityNote') }}
      </div>
      <UBadge v-if="entropy" :color="entropy.tone" variant="soft">
        {{ t('gen.entropy', { bits: entropy.bits.toLocaleString(locale), quality: t(`gen.quality.${entropy.label}`) }) }}
      </UBadge>
    </div>
  </div>
</template>
