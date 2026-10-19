'use client'

import { AuthProvider } from '@/context/AuthContext'
import { AuthModalProvider } from '@/context/AuthModalContext'
import { CaptchaProvider } from '@/context/CaptchaContext'
import { I18nProvider, catalogues } from '@/i18n'
import AppShell from '@/components/AppShell'
import NativeBridge from '@/components/NativeBridge'

/**
 * Client-side context stack. Everything interactive in this app is, so the
 * providers sit here rather than in the root layout, which stays a server
 * component.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider catalogues={catalogues}>
      <AuthProvider>
        <AuthModalProvider>
          <CaptchaProvider>
            {/* Links the Android app's push notifications to the session. */}
            <NativeBridge />
            <AppShell>{children}</AppShell>
          </CaptchaProvider>
        </AuthModalProvider>
      </AuthProvider>
    </I18nProvider>
  )
}