<script lang="ts">
  import App from './App.svelte';
  import Admin from './routes/admin/Admin.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';

  let route = $state(window.location.pathname);

  function handlePopState() {
    route = window.location.pathname;
  }

  $effect(() => {
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  });
</script>

{#if route.startsWith('/admin')}
  <Admin />
{:else if route === '/' || route === ''}
  <App />
{:else}
  <ErrorPage code={404} />
{/if}
