<script lang="ts">
  import GlitchText from './GlitchText.svelte';
  import { copy } from '$shared/copy';

  interface Props {
    code?: number;
  }

  let { code = 404 }: Props = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-background">
  <div class="flex flex-col items-center px-8 text-center">
    <GlitchText text={String(code)} />

    <p class="mt-8 text-lg font-medium tracking-widest text-primary">
      {copy.errorPage.pageHeading}
    </p>
    <p class="mt-2 text-muted-foreground">{copy.errorPage.notFoundMessage}</p>

    <a
      href="/"
      class="mt-12 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98]"
    >
      {copy.errorPage.backHome}
    </a>
  </div>
</div>
