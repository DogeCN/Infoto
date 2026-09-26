<script lang="ts">
  import App from './App.svelte';
  import Admin from './routes/admin/Admin.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import { isAdminRoute } from './routing';

  let route = $state(window.location.pathname);

  function handlePopState() {
    route = window.location.pathname;
  }

  $effect(() => {
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  });
</script>

{#if isAdminRoute(route)}
  <Admin />
{:else if route === '/' || route === ''}
  <App />
{:else}
  <ErrorPage code={404} />
{/if}
