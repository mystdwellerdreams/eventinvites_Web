import { useEffect } from 'react'
import { Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import HomePage from '@/screens/HomePage'
import UsersPage from '@/screens/UsersPage'
import AdminDashboard from '@/screens/AdminDashboard'
import AdminEventPage from '@/screens/AdminEventPage'
import AdminRegistrations from '@/screens/AdminRegistrations'
import EventPage from '@/screens/EventPage'
import MessagesPage from '@/screens/MessagesPage'
import ProfilePage from '@/screens/ProfilePage'
import ResetPasswordPage from '@/screens/ResetPasswordPage'

/**
 * The app build's route table, mirroring the `app/` directory of the Next
 * build one route at a time. Nothing about the screens changes: only where
 * the params arrive from.
 *
 * React Router ranks routes by specificity, so the static `/events/preview`
 * wins over `/events/:id` and `/events/key/:key` wins over both, exactly as
 * the App Router resolved them.
 */

/** `/admin?tab=…&view=…` — the deep link the activity log and menu use. */
function AdminRoute() {
  const [params] = useSearchParams()
  return (
    <AdminDashboard
      initialTab={params.get('tab') ?? undefined}
      initialView={params.get('view') ?? undefined}
    />
  )
}

/** `/messages?chat=<id>` — the deep link a notification uses. */
function MessagesRoute() {
  const [params] = useSearchParams()
  return <MessagesPage initialChatId={params.get('chat') ?? undefined} />
}

/** `/reset-password?token=…` — the link an administrator hands over. */
function ResetPasswordRoute() {
  const [params] = useSearchParams()
  return <ResetPasswordPage token={params.get('token') ?? ''} />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/users" element={<UsersPage />} />

      <Route path="/admin" element={<AdminRoute />} />
      <Route path="/admin/events" element={<AdminDashboard />} />
      <Route path="/admin/events/new" element={<AdminEventPage />} />
      <Route path="/admin/events/:id/edit" element={<AdminEventPage />} />
      <Route path="/admin/events/:id/registrations" element={<AdminRegistrations />} />

      {/* The draft comes from sessionStorage, so this route takes no params. */}
      <Route path="/events/preview" element={<EventPage />} />
      <Route path="/events/key/:key" element={<EventPage />} />
      <Route path="/events/:id" element={<EventPage />} />

      <Route path="/messages" element={<MessagesRoute />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/reset-password" element={<ResetPasswordRoute />} />

      {/* An unknown path is the home page, as the Next build's not-found is. */}
      <Route path="*" element={<HomePage />} />
    </Routes>
  )
}
