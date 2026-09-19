<script lang="ts">
  import App from './App.svelte';
  import Admin from './routes/admin/Admin.svelte';
  import ErrorPage from '$lib/components/custom/ErrorPage.svelte';

  let route = $state(window.location.pathname);
  // 开发验证面板（E2E 驱动）仅在这两处可达，懒加载避免进入产品主 chunk
  let harness = $derived(
    route === '/harness' ||
      (route === '/' && new URLSearchParams(window.location.search).has('e2e')),
  );

  function handlePopState() {
    route = window.location.pathname;
  }

  $effect(() => {
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  });

  function navigate(path: string) {
    window.history.pushState({}, '', path);
    route = path;
  }
</script>

{#if route.startsWith('/admin')}
  <Admin />
{:else if harness}
  {#await import('./harness/Harness.svelte') then mod}
    {@const Harness = mod.default}
    <Harness />
  {/await}
{:else if route === '/' || route === ''}
  <App />
{:else}
  <ErrorPage code={404} />
{/if}
