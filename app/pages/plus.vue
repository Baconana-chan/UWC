<script setup lang="ts">
const { t } = useI18n()

useSiteSeo({
  title: computed(() => t('plus.meta.title')),
  description: computed(() => t('plus.meta.description'))
})

const ISSUES_URL = 'https://github.com/Baconana-chan/UWC/issues/new?template=format-request.md'

/** Пример хорошего issue — заполняется в UI как «живой» шаблон */
const exampleGood = computed(() => [
  '### Format',
  'TOON (Token-Oriented Object Notation)',
  '',
  '### Specification / description',
  'A compact text format for LLM prompts: like JSON but ~40% fewer tokens.',
  'Spec: https://github.com/toon-format/spec — objects are `key{a,b}:` blocks,',
  'arrays are comma-separated rows. Human-readable, lossless round-trip to JSON.',
  '',
  '### Example file',
  '```toon',
  'users[2]{id,name}:',
  '  1,Alice',
  '  2,Bob',
  '```',
  '',
  '### Desired conversion',
  'TOON → JSON and back (two-way). I have ~200 files in this format from our LLM pipeline.'
].join('\n'))

const exampleBad = computed(() => [
  'add .toon to .json pls'
].join('\n'))

const requirements = computed(() => [
  { icon: 'i-lucide-file-text', key: 'spec' },
  { icon: 'i-lucide-file-code', key: 'example' },
  { icon: 'i-lucide-arrow-right-left', key: 'direction' },
  { icon: 'i-lucide-heart', key: 'why' }
])

function copyExample() {
  navigator.clipboard.writeText(exampleGood.value)
}
</script>

<template>
  <div class="relative min-h-screen overflow-x-clip px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
    <!-- фоновые свечения -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="bg-grid absolute inset-0" />
      <div class="animate-drift absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-violet-500/15 blur-[130px] dark:bg-violet-500/20" />
      <div class="animate-drift-slow absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-cyan-400/10 blur-[120px] dark:bg-cyan-400/15" />
    </div>

    <div class="relative mx-auto max-w-4xl">
      <!-- hero -->
      <header class="text-center">
        <UBadge color="primary" variant="soft" size="md" class="gap-1.5 px-3 py-1">
          <UIcon name="i-lucide-sparkles" class="size-3.5" />
          {{ t('plus.badge') }}
        </UBadge>
        <h1 class="mt-6 font-display text-3xl font-bold tracking-tight sm:text-5xl">
          {{ t('plus.title1') }} <span class="text-gradient">UWC+</span>
        </h1>
        <p class="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[var(--ui-text-muted)] sm:text-lg">
          {{ t('plus.subtitle') }}
        </p>
      </header>

      <!-- цели -->
      <section class="mt-14">
        <h2 class="text-center font-display text-xl font-bold sm:text-2xl">{{ t('plus.goals.title') }}</h2>
        <div class="mt-6 grid gap-4 sm:grid-cols-3">
          <div
            v-for="(goal, i) in (['free', 'privacy', 'community'] as const)"
            :key="goal"
            class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/50 p-5"
          >
            <div class="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-lime-400/20 to-cyan-400/20 text-primary">
              <UIcon :name="['i-lucide-gift', 'i-lucide-shield-check', 'i-lucide-users'][i]" class="size-5" />
            </div>
            <h3 class="mt-3 font-display text-sm font-bold">{{ t(`plus.goals.${goal}.title`) }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-[var(--ui-text-muted)]">{{ t(`plus.goals.${goal}.text`) }}</p>
          </div>
        </div>
      </section>

      <!-- как это работает -->
      <section class="mt-14">
        <h2 class="text-center font-display text-xl font-bold sm:text-2xl">{{ t('plus.how.title') }}</h2>
        <ol class="mx-auto mt-6 max-w-2xl space-y-4">
          <li v-for="step in 4" :key="step" class="flex gap-4">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-lime-400 to-emerald-400 font-display text-sm font-bold text-zinc-950">{{ step }}</span>
            <p class="pt-1 leading-relaxed text-[var(--ui-text-muted)]">{{ t(`plus.how.step${step}`) }}</p>
          </li>
        </ol>
      </section>

      <!-- требования к issue -->
      <section class="mt-14">
        <h2 class="text-center font-display text-xl font-bold sm:text-2xl">{{ t('plus.requirements.title') }}</h2>
        <p class="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-[var(--ui-text-muted)]">
          {{ t('plus.requirements.subtitle') }}
        </p>

        <div class="mt-6 grid gap-3 sm:grid-cols-2">
          <div
            v-for="req in requirements"
            :key="req.key"
            class="flex items-start gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/50 p-4"
          >
            <UIcon :name="req.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h3 class="text-sm font-semibold">{{ t(`plus.requirements.${req.key}.title`) }}</h3>
              <p class="mt-1 text-xs leading-relaxed text-[var(--ui-text-muted)]">{{ t(`plus.requirements.${req.key}.text`) }}</p>
            </div>
          </div>
        </div>

        <div class="mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <UIcon name="i-lucide-octagon-alert" class="mt-0.5 size-5 shrink-0 text-red-500 dark:text-red-400" />
          <p class="text-xs leading-relaxed text-[var(--ui-text-muted)]">
            {{ t('plus.requirements.rejected') }}
          </p>
        </div>
      </section>

      <!-- примерник -->
      <section class="mt-14">
        <h2 class="text-center font-display text-xl font-bold sm:text-2xl">{{ t('plus.examples.title') }}</h2>

        <div class="mt-6 grid gap-4 lg:grid-cols-2">
          <!-- хорошо -->
          <div class="overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/5">
            <div class="flex items-center justify-between border-b border-emerald-500/20 px-4 py-3">
              <span class="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <UIcon name="i-lucide-circle-check" class="size-4" />
                {{ t('plus.examples.good') }}
              </span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-copy"
                :aria-label="t('plus.examples.copy')"
                @click="copyExample"
              />
            </div>
            <pre class="max-h-80 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--ui-text-toned)]">{{ exampleGood }}</pre>
          </div>

          <!-- плохо -->
          <div class="overflow-hidden rounded-2xl border border-red-500/30 bg-red-500/5">
            <div class="flex items-center gap-2 border-b border-red-500/20 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400">
              <UIcon name="i-lucide-circle-x" class="size-4" />
              {{ t('plus.examples.bad') }}
            </div>
            <pre class="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--ui-text-dimmed)]">{{ exampleBad }}</pre>
            <div class="border-t border-red-500/20 px-4 py-3">
              <p class="text-xs leading-relaxed text-[var(--ui-text-muted)]">{{ t('plus.examples.badWhy') }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="mt-14">
        <div class="glass rounded-3xl border border-[var(--ui-border)] p-8 text-center sm:p-10">
          <div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-400 via-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-lime-500/25">
            <UIcon name="i-lucide-mail-plus" class="size-6" />
          </div>
          <h2 class="mt-4 font-display text-xl font-bold sm:text-2xl">{{ t('plus.cta.title') }}</h2>
          <p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--ui-text-muted)]">{{ t('plus.cta.text') }}</p>
          <UButton
            :label="t('plus.cta.button')"
            icon="i-lucide-github"
            color="primary"
            size="lg"
            :to="ISSUES_URL"
            target="_blank"
            class="mt-6"
          />
          <p class="mt-4 text-xs text-[var(--ui-text-dimmed)]">{{ t('plus.cta.note') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>
