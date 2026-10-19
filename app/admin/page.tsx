'use client'

import { use } from 'react'
import AdminDashboard from '@/screens/AdminDashboard'

/**
 * Reads the tab from the query string so the dashboard's
 * pop-up menu can deep-link to a specific tab, e.g.
 * /admin?tab=users. A sub-tab can be named too, as in
 * /admin?tab=users&view=requests.
 */
export default function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; view?: string }>
}) {
  const params = use(searchParams)
  return <AdminDashboard initialTab={params.tab} initialView={params.view} />
}
