import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './index.html'
  },
  source: {
    entry: { index: './src/index.tsx' }
  },
  resolve: {
    alias: { '@': './src' }
  },
  server: {
    port: Number(process.env.PORT ?? 3400),
    historyApiFallback: true,
    proxy: { '/api': process.env.API_UPSTREAM ?? 'http://localhost:8090' }
  },
  output: {
    sourceMap: { js: false }
  }
})
