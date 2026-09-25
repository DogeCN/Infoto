<script lang="ts">
  // Image load failure fallback (spec: "custom component list") — emoji + id36 id or the first
  // 8 chars of the sha256; background --card, text --muted-foreground.
  import { ImageOff } from '@lucide/svelte';
  import { toId36 } from '../../core/id36';

  interface Props {
    id: number;
    sha256: string;
  }

  let { id, sha256 }: Props = $props();

  let label = $derived.by(() => {
    try {
      return toId36(id);
    } catch {
      return sha256.slice(0, 8);
    }
  });
</script>

<div class="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-card">
  <ImageOff class="size-6 text-muted-foreground" />
  <span class="font-mono text-[10px] text-muted-foreground">{label}</span>
</div>
