import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./src/testing/postgres.ts'],
    hookTimeout: 60_000
  }
})
