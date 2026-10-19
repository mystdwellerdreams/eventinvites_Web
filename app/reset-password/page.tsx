'use client'

import { use } from 'react'
import ResetPasswordPage from '@/screens/ResetPasswordPage'

/**
 * The password reset menu. The link an administrator hands over
 * carries the token, e.g. /reset-password?token=…
 */
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = use(searchParams)
  return <ResetPasswordPage token={params.token ?? ''} />
}
