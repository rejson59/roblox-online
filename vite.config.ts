import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // lives behind the Arena preview proxy: any host/origin must be allowed
    allowedHosts: true as unknown as string[],
    cors: true,
  },
  preview: { host: '0.0.0.0', allowedHosts: true as unknown as string[] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
})
