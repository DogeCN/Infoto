<script lang="ts">
  // The build's version, bottom-right of the settings sidebar: the latest tag at rest, the
  // short commit hash on hover.
  //
  // Both are injected at build time (`web/vite.config.ts` reads them from git), so a release
  // is a tag push — there is no version file to edit, and a build off `main` shows the tag it
  // descends from rather than a branch name.
  import SwapLabel from './SwapLabel.svelte';

  const version = __APP_VERSION__;
  const hash = __COMMIT_HASH__;
</script>

<SwapLabel
  label={version}
  alt={hash}
  ariaLabel={`${version} (${hash})`}
  align="end"
  class="text-xs tabular-nums text-muted-foreground/50"
/>
