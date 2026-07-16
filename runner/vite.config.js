import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
    // project lives under OneDrive; native fs events are unreliable there
    watch: { usePolling: true, interval: 300 },
  },
});
