import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { authAPI } from '../utils/api'
import { unregisterPushDevice } from '../utils/nativePush'
import type { RegisterPayload, User } from '../types'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (identifier: string, password: string, captchaToken?: string | null) => Promise<void>
  register: (data: RegisterPayload, captchaToken?: string | null) => Promise<string | undefined>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const response = await authAPI.me()
      setUser(response.data.user as User)
    } catch {
      setUser(null)
    }
  }, [])

  // Returning visitors are signed in automatically through the refresh cookie.
  useEffect(() => {
    let active = true
    const initAuth = async () => {
      await refreshUser()
      if (active) setLoading(false)
    }
    initAuth()
    return () => {
      active = false
    }
  }, [refreshUser])

  const login = async (identifier: string, password: string, captchaToken?: string | null) => {
    const response = await authAPI.login(identifier, password, captchaToken)
    setUser(response.data.user as User)
  }

  const register = async (data: RegisterPayload, captchaToken?: string | null) => {
    const response = await authAPI.register(data, captchaToken)
    setUser(response.data.user as User)
    return response.data.message as string | undefined
  }

  const logout = async () => {
    // The device is removed while the session still answers, so the phone
    // stops receiving this account's notifications before it is signed out.
    await unregisterPushDevice()
    await authAPI.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refreshUser, setUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}
