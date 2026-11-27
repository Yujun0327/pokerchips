// Dev only (not part of the build): several phones in one page over an in-memory mesh.
// Open /dev/?n=4&w=390&h=844 while `npm run dev` is running.
import { mount } from 'svelte'
import '../src/app.css'
import Harness from './Harness.svelte'

mount(Harness, { target: document.getElementById('app')! })
