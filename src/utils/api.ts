import axios, { type InternalAxiosRequestConfig } from 'axios'
import { noteTrafficFailure } from '../hooks/useConnectivity'
import type {
  ActivityLogResponse,
  ActivitySettings,
  BannerAd,
  BannerAdType,
  BannerConfig,
  BannerCounterStats,
  BannerPollVoter,
  BannerSlot,
  BannerTemplate,
  ChatMessage,
  ChatSummary,
  ChatThreadResponse,
  Comment,
  CommentBlock,
  CommentsResponse,
  EventTemplate,
  EventTemplateData,
  MessageResponse,
  NotificationsResponse,
  OpenChatPayload,
  PasswordReset,
} from '../types'

/**
 * Same-origin by default: Next serves both the pages and the API route handler,
 * so `/api/*` is this host and auth cookies stay first-party. CORS never comes
 * into play.
 *
 * Set NEXT_PUBLIC_API_BASE only if the API ever moves to another origin. Note
 * the Next prefix: `import.meta.env` is undefined under Next and would throw.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api'

/** Where uploaded files are served from, whatever holds them. */
export const UPLOAD_ROUTE = '/uploads'

/** Base URL with no trailing slash, for building absolute asset URLs. */
export const apiOrigin = API_BASE.replace(/\/api\/?$/, '').replace(/\/$/, '')

/**
 * The name of a file inside the object store, or null for anything else.
 * Store URLs look like `https://<store>….blob.vercel-storage.com/uploads/<file>`.
 */
function blobStoreFile(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!/\.blob\.vercel-storage\.com$/i.test(parsed.hostname)) return null
  const match = /^\/uploads\/(.+)$/.exec(parsed.pathname)
  return match ? match[1] : null
}

/**
 * Turns a stored asset path into something the browser can load.
 *
 * Files in object storage are always fetched through this app: a store with
 * private access does not serve the browser, and a public one is answered by
 * a redirect, so one path works for both. Local paths become absolute URLs,
 * because once the projects are deployed separately a relative path would
 * resolve against the frontend origin and 404. Data URIs pass through.
 */
export function resolveAssetUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (/^https?:\/\//i.test(url)) {
    const stored = blobStoreFile(url)
    return stored ? `${apiOrigin}${UPLOAD_ROUTE}/${stored}` : url
  }
  if (!apiOrigin) return url
  return `${apiOrigin}${url.startsWith('/') ? '' : '/'}${url}`
}

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

let refreshInFlight: Promise<void> | null = null

/** The header a verified challenge travels in. A header rather than a body
 *  field so the same call works for JSON and for multipart uploads. */
export const CAPTCHA_HEADER = 'x-captcha-token'

/** Builds the headers a protected action needs, when a token is at hand. */
function captchaHeaders(token?: string | null): Record<string, string> {
  return token ? { [CAPTCHA_HEADER]: token } : {}
}

/**
 * Returning users stay signed in: when an access token has expired we trade the
 * long-lived refresh cookie for a new access token and replay the request.
 * Concurrent 401s share a single refresh round-trip.
 */
function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post('/auth/refresh')
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetriableConfig | undefined
    const status = error.response?.status
    const isRefreshCall = config?.url?.includes('/auth/refresh')

    // A failed request is the earliest signal of a broken connection, so
    // the controller hears about it here rather than only at its next
    // poll. A 401 is a session matter, not a connection one, so it is
    // left out; anything else that did not answer normally is reported.
    if (status === undefined || (status >= 500 && !isRefreshCall)) {
      noteTrafficFailure()
    }

    if (status === 401 && config && !config._retry && !isRefreshCall) {
      config._retry = true
      try {
        await refreshSession()
        return api(config)
      } catch {
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  }
)

export interface SocialLinkInput {
  platform: string
  /** The handle or address as typed; the server builds the canonical URL. */
  value: string
  label?: string
}

export interface ProfileUpdate {
  name?: string
  phone?: string
  socialLinks?: SocialLinkInput[]
}

export const authAPI = {
  register: (
    data: { name: string; phone: string; email?: string; password?: string },
    captchaToken?: string | null
  ) => api.post('/auth/register', data, { headers: captchaHeaders(captchaToken) }),
  login: (identifier: string, password: string, captchaToken?: string | null) =>
    api.post('/auth/login', { identifier, password }, { headers: captchaHeaders(captchaToken) }),
  checkInvite: (token: string) => api.get(`/auth/invite/${token}`),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  roles: () => api.get('/auth/roles'),
  updateProfile: (data: ProfileUpdate) => api.patch('/auth/profile', data),
  updateAvatar: (avatarUrl: string) => api.patch('/auth/avatar', { avatar: avatarUrl }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/auth/password', { currentPassword, newPassword }),
  /** Asks the administrators for a password reset link. */
  requestPasswordReset: (phone: string) =>
    api.post('/auth/forgot-password', { phone }),
  /** Checks a reset link before the new password form is shown. */
  validatePasswordReset: (token: string) =>
    api.get<{ ok: boolean; user: { id: string; name: string; phone?: string | null } }>(
      `/auth/password-reset/${token}`
    ),
  /** Sets a new password through a reset link. */
  resetPassword: (token: string, newPassword: string) =>
    api.post(`/auth/password-reset/${token}`, { newPassword }),
}

export const eventsAPI = {
  getUpcoming: () => api.get('/events'),
  getEvent: (id: string) => api.get(`/events/${id}`),
  getEventByKey: (key: string) => api.get(`/events/key/${key}`),
  create: (data: unknown, captchaToken?: string | null) =>
    api.post('/events', data, { headers: captchaHeaders(captchaToken) }),
  update: (id: string, data: unknown) => api.patch(`/events/${id}`, data),
  remove: (id: string, captchaToken?: string | null) =>
    api.delete(`/events/${id}`, { headers: captchaHeaders(captchaToken) }),
  register: (id: string, listId: string) => api.post(`/events/${id}/register`, { listId }),
  unregister: (id: string) => api.delete(`/events/${id}/register`),
  createList: (eventId: string, name: string, isDefault = false) =>
    api.post(`/events/${eventId}/lists`, { name, isDefault }),
  updateList: (eventId: string, listId: string, data: { name?: string; isDefault?: boolean }) =>
    api.patch(`/events/${eventId}/lists/${listId}`, data),
  deleteList: (eventId: string, listId: string) =>
    api.delete(`/events/${eventId}/lists/${listId}`),
  updateRegistration: (
    eventId: string,
    registrationId: string,
    data: { status?: string; listId?: string }
  ) => api.patch(`/events/${eventId}/registrations/${registrationId}`, data),
  /** Posts an organizer's update to everyone registered for the event. */
  notifyParticipants: (eventId: string, data: { title: string; message: string }) =>
    api.post<MessageResponse>(`/admin/events/${eventId}/notify`, data),
}

/** What the composer sends: a reply, a quote, or both at once. */
export interface CommentCreatePayload {
  body: string
  parentId?: string
  quoteCommentId?: string
  quoteText?: string
}

/** The event's discussion, at the bottom of the event page. */
export const commentsAPI = {
  list: (eventId: string) =>
    api.get<CommentsResponse>(`/comments/events/${eventId}`),
  create: (eventId: string, data: CommentCreatePayload) =>
    api.post<{ comment: Comment }>(`/comments/events/${eventId}`, data),
  /** Pins or unpins: the same call toggles. */
  pin: (id: string) => api.post<{ comment: Comment }>(`/comments/${id}/pin`),
  /** Bans or unbans: the same call toggles. */
  ban: (id: string) => api.post<{ comment: Comment }>(`/comments/${id}/ban`),
  remove: (id: string) => api.delete<{ comment: Comment }>(`/comments/${id}`),
  blocks: (eventId: string) =>
    api.get<{ blocks: CommentBlock[] }>(`/comments/events/${eventId}/blocks`),
  blockUser: (eventId: string, data: { userId: string; reason?: string }) =>
    api.post<{ block: CommentBlock }>(`/comments/events/${eventId}/blocks`, data),
  unblockUser: (eventId: string, userId: string) =>
    api.delete<MessageResponse>(`/comments/events/${eventId}/blocks/${userId}`),
}

export const usersAPI = {
  getAll: () => api.get('/users'),
  get: (id: string) => api.get(`/users/${id}`),
  getByKey: (key: string) => api.get(`/users/key/${key}`),
  updateRole: (id: string, role: string) => api.patch(`/users/${id}/role`, { role }),
  remove: (id: string) => api.delete(`/users/${id}`),
  /** An administrator's message to one user, delivered as a notification. */
  sendMessage: (id: string, message: string) =>
    api.post<MessageResponse>(`/admin/users/${id}/messages`, { message }),
}

/** Tag routes are administrator-only; there is no client for regular users. */
export const tagsAPI = {
  list: () => api.get('/tags'),
  create: (name: string) => api.post('/tags', { name }),
  rename: (id: string, name: string) => api.patch(`/tags/${id}`, { name }),
  remove: (id: string) => api.delete(`/tags/${id}`),
  setForUser: (userId: string, tagIds: string[]) =>
    api.put(`/tags/users/${userId}`, { tagIds }),
}

export const adminAPI = {
  dashboard: () => api.get('/admin/dashboard'),
  getEvents: () => api.get('/admin/events'),
  getEventRegistrations: (id: string) => api.get(`/admin/events/${id}/registrations`),
  createRegistration: (eventId: string, userId: string, listId: string) =>
    api.post(`/admin/events/${eventId}/registrations`, { userId, listId }),
  confirmRegistration: (registrationId: string) =>
    api.patch(`/admin/registrations/${registrationId}/confirm`),
  unconfirmRegistration: (registrationId: string) =>
    api.patch(`/admin/registrations/${registrationId}/unconfirm`),
  removeRegistration: (registrationId: string) =>
    api.delete(`/admin/registrations/${registrationId}`),
  guests: () => api.get('/admin/guests'),
  approveGuest: (id: string) => api.patch(`/admin/guests/${id}/approve`),
  /** Pending password reset requests for the Status tab. */
  passwordResets: () => api.get<{ resets: PasswordReset[] }>('/admin/password-resets'),
  cancelPasswordReset: (id: string) => api.delete(`/admin/password-resets/${id}`),
  invites: () => api.get('/admin/invites'),
  createInvite: (data: { note?: string; maxUses?: number; expiresInDays?: number }) =>
    api.post('/admin/invites', data),
  revokeInvite: (id: string) => api.post(`/admin/invites/${id}/revoke`),
}

export const uploadAPI = {
  uploadAvatar: (formData: FormData) =>
    api.post('/upload/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadCover: (formData: FormData) =>
    api.post('/upload/cover', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
}

/** Messages sent to the administrators through the feedback form. */
export const feedbackAPI = {
  /** `message` is HTML from the rich-text editor; `file` is optional. The
   *  feedback that comes through the support chat is exempt: only this
   *  form presents a challenge. */
  submit: (data: { message: string; file?: File | null; captchaToken?: string | null }) => {
    const formData = new FormData()
    formData.append('message', data.message)
    if (data.file) formData.append('file', data.file)
    return api.post<MessageResponse>('/feedback', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...captchaHeaders(data.captchaToken),
      },
    })
  },
}

/** The administrator's activity log. */
export const activityAPI = {
  list: (params?: { category?: string; sort?: 'asc' | 'desc' }) =>
    api.get<ActivityLogResponse>('/admin/activity', { params }),
  /** Removes one entry from the log. */
  remove: (id: string) => api.delete<MessageResponse>(`/admin/activity/${id}`),
  /** Removes every entry at once. */
  clear: () => api.delete<MessageResponse>('/admin/activity'),
  /** Turns comment logging on or off. */
  updateSettings: (data: { logComments: boolean }) =>
    api.patch<{ settings: ActivitySettings }>('/admin/activity/settings', data),
}

/** The signed-in user's notifications: broadcasts they see and their own. */
export const notificationsAPI = {  list: () => api.get<NotificationsResponse>('/notifications'),
  /** Marks one broadcast read. */
  readBroadcast: (id: string) =>
    api.post<MessageResponse>(`/notifications/broadcasts/${id}/read`),
  /** Hides one broadcast for this user. */
  hideBroadcast: (id: string) => api.delete<MessageResponse>(`/notifications/broadcasts/${id}`),
  /** Marks one individual notification read. */
  read: (id: string) => api.post<MessageResponse>(`/notifications/${id}/read`),
  /** Removes one individual notification. */
  remove: (id: string) => api.delete<MessageResponse>(`/notifications/${id}`),
  /** Everything becomes read in one step. */
  readAll: () => api.post<MessageResponse>('/notifications/read-all'),
}

/**
 * The devices that receive push notifications for the signed-in account. The
 * Android app registers its FCM token on sign-in and removes it on sign-out.
 */
export const devicesAPI = {
  register: (data: { token: string; platform?: string; appVersion?: string }) =>
    api.post<MessageResponse>('/devices', data),
  unregister: (token: string) =>
    api.delete<MessageResponse>('/devices', { data: { token } }),
  /** Sends one notification to this account's devices; `devices` is the count. */
  test: () => api.post<{ devices: number; configured: boolean }>('/devices/test'),
}

/** The Messages section: feedback, conversations with administrators, and
 *  the event comment threads the user takes part in. */
export const chatsAPI = {
  /** Every conversation this viewer takes part in, newest first. */
  list: () => api.get<{ chats: ChatSummary[] }>('/chats'),
  /** One conversation with its messages; opening it marks it read. */
  thread: (id: string) => api.get<ChatThreadResponse>(`/chats/${id}`),
  /** Writes one message. In an EVENT thread it is a comment on the event. */
  send: (id: string, body: string) =>
    api.post<{ message: ChatMessage }>(`/chats/${id}/messages`, { body }),
  /** Marks one conversation read without loading it again. */
  markRead: (id: string) => api.post<MessageResponse>(`/chats/${id}/read`),
  /** Opens a conversation as an administrator: feedback, a personal
   *  conversation, or an event thread. */
  open: (data: OpenChatPayload) =>
    api.post<{ chat: { id: string } }>('/chats/open', data),
  /** Lets an administrator stop a user from writing in a conversation. */
  setReadOnly: (id: string, readOnly: boolean) =>
    api.post<{ chat: { id: string; userReadOnly: boolean } }>(`/chats/${id}/readonly`, {
      readOnly,
    }),
}

/** Saved event editor settings, shared by every administrator. */
export const eventTemplatesAPI = {
  /** Every saved template, newest first. */
  list: () => api.get<{ templates: EventTemplate[] }>('/event-templates'),
  /** Saves the current editor settings under a name. */
  create: (name: string, data: EventTemplateData) =>
    api.post<{ template: EventTemplate }>('/event-templates', { name, data }),
  /** Removes one saved template. */
  remove: (id: string) => api.delete<MessageResponse>(`/event-templates/${id}`),
}

export const bannersAPI = {
  /** Active slots with their active ads, for the home page. */
  list: () => api.get<{ slots: BannerSlot[] }>('/banners'),
  /** One ad by id, with the signed-in user's poll vote. */
  get: (id: string) =>
    api.get<{ ad: BannerAd; myVote?: string | null }>(`/banners/${id}`),
  /** Every slot and ad, for the admin editor. */
  adminList: () => api.get<{ slots: BannerSlot[] }>('/admin/banners'),
  updateSlot: (slot: string, data: { interval?: number; isActive?: boolean; logChanges?: boolean }) =>
    api.patch(`/admin/banners/slots/${slot}`, data),
  create: (data: unknown) => api.post<{ ad: BannerAd }>('/admin/banners', data),
  update: (id: string, data: unknown) =>
    api.patch<{ ad: BannerAd }>(`/admin/banners/${id}`, data),
  remove: (id: string) => api.delete<MessageResponse>(`/admin/banners/${id}`),
  reorder: (slotId: string, ids: string[]) =>
    api.post<{ ads: BannerAd[] }>('/admin/banners/reorder', { slotId, ids }),
  /** Who voted for what in a poll, for the editor's statistics. */
  voters: (id: string) =>
    api.get<{ voters: BannerPollVoter[] }>(`/admin/banners/${id}/votes`),
  /** Records a copy out of a counter banner's details text. */
  copy: (id: string, reference: string) =>
    api.post<{ recorded: boolean }>(`/banners/${id}/copy`, { reference }),
  /** A counter banner's current value and who copied its references. */
  counterStats: (id: string) =>
    api.get<BannerCounterStats>(`/admin/banners/${id}/counter`),
  vote: (id: string, optionId: string) =>
    api.post<{ ad: BannerAd }>(`/banners/${id}/vote`, { optionId }),
  /** Moves an existing vote to a different option. */
  changeVote: (id: string, optionId: string, previousOptionId: string) =>
    api.post<{ ad: BannerAd }>(`/banners/${id}/vote`, {
      optionId,
      previousOptionId,
    }),
  /** Withdraws an existing vote. */
  cancelVote: (id: string, optionId: string) =>
    api.post<{ ad: BannerAd }>(`/banners/${id}/vote/cancel`, { optionId }),
  /** Saved ad configurations, for the template library. */
  templates: () => api.get<{ templates: BannerTemplate[] }>(
    '/admin/banners/templates'
  ),
  saveTemplate: (data: {
    name: string
    type: BannerAdType
    config: BannerConfig
  }) => api.post<{ template: BannerTemplate }>('/admin/banners/templates', data),
  deleteTemplate: (id: string) =>
    api.delete<MessageResponse>(`/admin/banners/templates/${id}`),
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { error?: string; details?: { message: string }[] } } }
  const data = err?.response?.data
  if (data?.details?.length) {
    return data.details.map((d) => d.message).join(', ')
  }
  return data?.error || fallback
}

export default api
