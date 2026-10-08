import '@linagora/twake-css/dist/utils.css'

import { connectSpaceOverlay } from '@linagora/twake-mui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { httpPagesApi } from '@/adapters/http/httpPagesApi'
import { embedSession, isEmbedded } from '@/adapters/oidc/embedSession'
import {
  oidcSession,
  readSsoConfig,
  sendSignedIn
} from '@/adapters/oidc/oidcSession'
import { relayCallback } from '@/adapters/oidc/ssoFrame'
import { App } from '@/app/App'
import { connectTwakeSpace } from '@/ui/embed/twakeSpace'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

const apiUrl = window.location.origin
const config = readSsoConfig(window, apiUrl)

if (!relayCallback()) {
  const space = connectTwakeSpace()
  const embed = isEmbedded() ? embedSession(config) : null
  const session = embed ?? oidcSession(config)
  const pagesApi = httpPagesApi(apiUrl, embed?.send ?? sendSignedIn)
  // Framed by TwakeSpace, the dialogs and the side panel go onto its page:
  // the region they cover is sent to TwakeSpace, which shows that part only
  const overlay = embed
    ? connectSpaceOverlay(region => space?.reportOverlayRegion(region))
    : null

  createRoot(container).render(
    <StrictMode>
      <App session={session} pagesApi={pagesApi} overlay={overlay} />
    </StrictMode>
  )
}
