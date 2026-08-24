import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { localDataPlugin } from './server/localDataPlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    // GitHub Pages project sites are served from /<repository>/.
    // Local development keeps the normal root path.
    base: env.VITE_BASE_PATH || '/',
    plugins: [vue(), localDataPlugin()],
    server: {
      host: '127.0.0.1',
    },
  }
})
