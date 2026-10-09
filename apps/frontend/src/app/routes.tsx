import type { RouteObject } from 'react-router'

import { EmbedLayout } from '@/ui/embed/Embed'
import { HomeScreen } from '@/ui/home/HomeScreen'
import { LabelScreen } from '@/ui/labels/LabelScreen'
import { NotificationsScreen } from '@/ui/notifications/NotificationsScreen'
import { EditPageScreen } from '@/ui/page/EditPageScreen'
import { HistoryScreen } from '@/ui/page/HistoryScreen'
import { PageScreen } from '@/ui/page/PageScreen'
import { VersionScreen } from '@/ui/page/VersionScreen'
import { SearchScreen } from '@/ui/search/SearchScreen'
import { AppShell } from '@/ui/shell/AppShell'
import { CrashScreen, NotFoundScreen } from '@/ui/shell/Problems'
import { TrashScreen } from '@/ui/trash/TrashScreen'
import { WikiHomeScreen } from '@/ui/wiki/WikiHomeScreen'
import { WikiLayout } from '@/ui/wiki/WikiLayout'

const wikiRoutes = (back = true): RouteObject[] => [
  {
    element: <WikiLayout back={back} />,
    children: [
      { index: true, element: <WikiHomeScreen /> },
      { path: 'pages/:pageId', element: <PageScreen /> },
      { path: 'pages/:pageId/edit', element: <EditPageScreen /> },
      { path: 'pages/:pageId/history', element: <HistoryScreen /> },
      { path: 'pages/:pageId/history/:number', element: <VersionScreen /> },
      { path: 'labels/:name', element: <LabelScreen /> },
      { path: 'search', element: <SearchScreen /> },
      { path: 'trash', element: <TrashScreen /> }
    ]
  }
]

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        errorElement: <CrashScreen />,
        children: [
          { path: '/', element: <HomeScreen /> },
          { path: '/search', element: <SearchScreen /> },
          { path: '/notifications', element: <NotificationsScreen /> },
          { path: '/wikis/:wikiId', children: wikiRoutes() },
          { path: '*', element: <NotFoundScreen /> }
        ]
      }
    ]
  },
  {
    path: '/embed/wikis/:wikiId',
    element: <EmbedLayout />,
    children: [{ errorElement: <CrashScreen />, children: wikiRoutes(false) }]
  }
]
