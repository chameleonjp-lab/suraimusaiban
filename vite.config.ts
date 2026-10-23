import { defineConfig } from 'vite';
export default defineConfig({ build: { target: 'es2022' }, server: { hmr: process.env.SLIME_DISABLE_HMR ? false : undefined, port: 5173, strictPort: true } });
