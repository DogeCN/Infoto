import { mount } from 'svelte';
import Root from './Root.svelte';
import './app.css';

const app = document.getElementById('app')!;
mount(Root, { target: app });
