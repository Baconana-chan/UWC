<script setup lang="ts">
const { t } = useI18n()

withDefaults(defineProps<{
  file: File | null
  accept?: string
  kind?: 'image' | 'audio' | 'archive'
}>(), {
  accept: undefined,
  kind: 'image'
})
const emit = defineEmits<{ file: [f: File]; clear: [] }>()

const inputRef = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

const icons = {
  image: { idle: 'i-lucide-image-plus', active: 'i-lucide-cloud-upload' },
  audio: { idle: 'i-lucide-music', active: 'i-lucide-cloud-upload' },
  archive: { idle: 'i-lucide-archive', active: 'i-lucide-cloud-upload' }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f)
    emit('file', f)
}

function onPick(e: Event) {
  const target = e.target as HTMLInputElement
  const f = target.files?.[0]
  if (f)
    emit('file', f)
  target.value = ''
}
</script>

<template>
  <div
    class="relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200"
    :class="isDragging
      ? 'scale-[1.01] border-primary bg-primary-500/10'
      : 'border-[var(--ui-border)] hover:border-[var(--ui-border-accented)] hover:bg-[var(--ui-bg-accented)]'"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
    @click="inputRef?.click()"
  >
  <input ref="inputRef" type="file" class="hidden" :accept="accept ?? (kind === 'audio' ? 'audio/*' : kind === 'archive' ? '.zip,.tar,.tar.gz,.tgz,.gz,.br,.lzma,.tar.lz,.bz2,.tar.bz2,.zst,.tar.zst,.xz,.tar.xz,.cab,.cpio,.a,.ar,.deb,.Z,.iso,.xar,.img' : 'image/*')" @change="onPick" >

    <div
      class="flex size-14 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-400 transition-transform"
      :class="isDragging ? 'scale-110' : ''"
    >
      <UIcon :name="isDragging ? icons[kind].active : icons[kind].idle" class="size-7" />
    </div>

    <div>
      <p class="font-medium">
        <span class="text-primary-400">{{ isDragging ? t('studio.file.dropActive') : t(kind === 'audio' ? 'studio.audio.drop' : kind === 'archive' ? 'studio.archive.drop' : 'studio.file.drop') }}</span>
        <span class="text-[var(--ui-text-muted)]">{{ t('studio.file.dropOr') }}</span>
      </p>
      <p class="mt-1 text-xs text-[var(--ui-text-muted)]">{{ t(kind === 'audio' ? 'studio.audio.formatsHint' : kind === 'archive' ? 'studio.archive.formatsHint' : 'studio.file.formatsHint') }}</p>
    </div>
  </div>
</template>
