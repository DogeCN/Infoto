import { mount } from 'svelte';
import Harness from './harness/Harness.svelte';

const app = document.getElementById('app')!;
mount(Harness, { target: app });
