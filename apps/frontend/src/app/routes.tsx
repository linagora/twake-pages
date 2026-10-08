import type { RouteObject } from 'react-router'

import { EmbedLayout, EmbedWikiScreen } from '@/ui/embed/Embed'
import { AppShell } from '@/ui/shell/AppShell'
import { CrashScreen, NotFoundScreen } from '@/ui/shell/Problems'
import { HomeScreen } from '@/ui/wikis/HomeScreen'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        errorElement: <CrashScreen />,
        children: [
          { path: '/', element: <HomeScreen /> },
          { path: '*', element: <NotFoundScreen /> }
        ]
      }
    ]
  },
  {
    path: '/embed/wikis/:wikiId',
    element: <EmbedLayout />,
    children: [
      {
        errorElement: <CrashScreen />,
        children: [{ index: true, element: <EmbedWikiScreen /> }]
      }
    ]
  }
]
