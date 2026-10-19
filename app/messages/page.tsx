'use client'

import { use } from 'react'
import MessagesPage from '@/screens/MessagesPage'

/**
 * Reads the chat from the query string so a notification can deep-link a
 * specific conversation, as in /messages?chat=<id>.
 */
export default function MessagesRoute({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>
}) {
  const params = use(searchParams)
  return <MessagesPage initialChatId={params.chat} />
}
