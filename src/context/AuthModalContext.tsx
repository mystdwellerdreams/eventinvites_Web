import { createContext, useContext, useState, ReactNode } from 'react'

type AuthModalMode = 'login' | 'register' | 'recover'

interface AuthModalContextType {
  isOpen: boolean
  mode: AuthModalMode
  open: (mode?: AuthModalMode) => void
  close: () => void
  setMode: (mode: AuthModalMode) => void
  toggleMode: () => void
}

const AuthModalContext = createContext<AuthModalContextType | null>(null)

export function useAuthModal() {
  const context = useContext(AuthModalContext)
  if (!context) {
    throw new Error('useAuthModal must be used within an AuthModalProvider')
  }
  return context
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<AuthModalMode>('login')

  const open = (nextMode: AuthModalMode = 'login') => {
    setMode(nextMode)
    setIsOpen(true)
  }

  const close = () => setIsOpen(false)

  // The toggle only swaps the two account forms; the
  // recovery form is reached from the login form's link.
  const toggleMode = () =>
    setMode((current) =>
      current === 'login' ? 'register' : current === 'register' ? 'login' : 'login'
    )

  return (
    <AuthModalContext.Provider value={{ isOpen, mode, open, close, setMode, toggleMode }}>
      {children}
    </AuthModalContext.Provider>
  )
}
