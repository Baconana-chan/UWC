<script setup lang="ts">
const { t, locale } = useI18n()

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  placeholder?: string
  readonly?: boolean
  mono?: boolean
  showCounter?: boolean
}>(), {
  placeholder: '',
  readonly: false,
  mono: true,
  showCounter: true
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** форма множественного числа по правилам CLDR текущей локали */
const counterKey = computed(() => {
  const rule = new Intl.PluralRules(locale.value).select(props.modelValue.length)
  if (rule === 'one') return 'counter.one'
  if (rule === 'few') return 'counter.few'
  if (rule === 'many') return 'counter.many'
  return 'counter.other'
})

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)]/60 transition-colors duration-200 focus-within:border-primary/70"
  >
    <!-- заголовок: label слева, слот actions справа -->
    <div class="flex items-center justify-between gap-2 px-4 pb-1 pt-2.5">
      <span class="text-xs font-medium uppercase tracking-wider text-[var(--ui-text-muted)]">{{ label }}</span>
      <div v-if="$slots.actions" class="flex items-center gap-0.5">
        <slot name="actions" />
      </div>
    </div>

    <!-- само поле: растягивается на всю высоту -->
    <textarea
      :value="modelValue"
      :placeholder="placeholder"
      :readonly="readonly"
      spellcheck="false"
      class="min-h-0 w-full flex-1 resize-none bg-transparent px-4 py-2 text-sm leading-relaxed outline-none placeholder:text-[var(--ui-text-dimmed)]"
      :class="mono ? 'font-mono' : 'font-sans'"
      @input="onInput"
    />

    <!-- футер: счётчик символов -->
    <div v-if="showCounter" class="flex items-center justify-end gap-3 px-4 pb-2.5 pt-1">
      <span class="text-xs tabular-nums text-[var(--ui-text-dimmed)]">
        {{ props.modelValue.length.toLocaleString(locale) }} {{ t(counterKey) }}
      </span>
    </div>
  </div>
</template>
