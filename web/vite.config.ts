import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 로컬 dev 서버(npm run dev)용 프록시. 컨테이너에서는 nginx.conf 가 같은 역할.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/files': { target: 'http://localhost:9000', rewrite: p => p.replace(/^\/files/, '') },
    },
  },
})
