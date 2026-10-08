import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The first render of a file loads the whole app, which takes over the default
// second on a busy machine.
configure({ reactStrictMode: true, asyncUtilTimeout: 3000 })

afterEach(cleanup)
