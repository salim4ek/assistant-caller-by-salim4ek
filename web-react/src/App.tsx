import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { getToken, decodeJWT } from './lib/api'
import { LoginPage } from './pages/Login'
import { DoctorPage } from './pages/Doctor'
import { AssistantPage } from './pages/Assistant'
import { AdminPage } from './pages/Admin'
import { HelpPage } from './pages/Help'

type Me = { role: 'doctor' | 'assistant' | 'admin' }

function Protected({ allow, children }: { allow: Me['role'][]; children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'no' | 'wrong'>('loading')
  const loc = useLocation()

  useEffect(() => {
    const token = getToken()
    if (!token) { setState('no'); return }
    const claims = decodeJWT<{ role: string; exp: number }>(token)
    if (!claims) { setState('no'); return }
    // Don't kick out on expired token — the user may still be viewing
    // and can re-login from the page. Only role mismatch sends to /.
    if (!allow.includes(claims.role as any)) {
      setState('wrong')
      return
    }
    setState('ok')
  }, [allow.join(','), loc.pathname])

  if (state === 'loading') {
    return (
      <div className="min-h-screen grid place-items-center bg-orbs">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }} className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }
  if (state === 'no') {
    return <Navigate to="/" replace />
  }
  if (state === 'wrong') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/doctor" element={<Protected allow={['doctor']}><DoctorPage /></Protected>} />
        <Route path="/assistant" element={<Protected allow={['assistant']}><AssistantPage /></Protected>} />
        <Route path="/admin" element={<Protected allow={['admin']}><AdminPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}
