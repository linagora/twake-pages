import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The first render of a file loads the whole app, which takes over the default
// second on a busy machine.
configure({ reactStrictMode: true, asyncUtilTimeout: 3000 })

// Mantine, which draws BlockNote's editor, asks the browser for the color
// scheme it prefers, which jsdom cannot tell.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })
})

afterEach(cleanup)
