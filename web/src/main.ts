import { mount } from 'svelte';
import Root from './Root.svelte';
import './app.css';

const app = document.getElementById('app')!;
mount(Root, { target: app });

// Production only: in dev the worker would cache Vite's unhashed module URLs and pin
// stale code against HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
    console.warn('[sw] registration failed', error);
  });
}
