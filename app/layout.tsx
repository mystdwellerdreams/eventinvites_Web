import type { Metadata } from 'next'
import '../src/styles/globals.css'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'Event Invites',
  description: 'Create events and manage invitations.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}