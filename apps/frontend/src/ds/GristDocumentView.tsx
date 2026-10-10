import { Box } from '@linagora/twake-mui'
import { useEffect, useRef, type ReactElement } from 'react'

import { gristDocument, gristStyles, type GristOptions } from '@/ds/grist'

/**
 * The Grist document at `address`, framed with a link that opens it in
 * Grist if it is on the origins of `grist`, else what says it is not shown:
 * the document of a database page, which takes most of the screen.
 */
export function GristDocumentView({
  address,
  grist
}: {
  address: string
  grist: GristOptions
}): ReactElement {
  const holder = useRef<HTMLDivElement>(null)
  // Drawn as a Grist embed is, so that a database page checks and frames
  // its document as the blocks do.
  useEffect(() => {
    const shown = gristDocument(address, grist)
    holder.current?.replaceChildren(shown)
    return () => {
      shown.remove()
    }
  }, [address, grist])
  return (
    <Box
      ref={holder}
      sx={[
        gristStyles,
        { '& .twake-grist-frame': { height: '70vh', minHeight: 480 } }
      ]}
    />
  )
}
