<script lang="ts">
  // 图片加载失败兜底（spec: "自定义组件清单"）——emoji + id36 标识或 sha256 前 8 字符，
  // 底色 --card，文字 --muted-foreground。
  import { ImageOff } from '@lucide/svelte';
  import { toId36 } from '../../../core/id36';

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
