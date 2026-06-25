import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from './ui/button'
import { InstallPWA } from './InstallPWA'
import { NotificationBell } from './NotificationBell'
import { CursorOrbs } from './CursorOrbs'
import { AutoRefresh } from './AutoRefresh'
import { clearAndRedirect } from '@/lib/api'

// Московское время и дата в шапке кабинета.
function MskClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(now)
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(now)
  return (
    <div className="text-right leading-tight select-none" title="Московское время">
      <div className="text-sm font-bold tabular-nums text-teal-700">{time}</div>
      <div className="text-[10px] text-muted-foreground">{date} · МСК</div>
    </div>
  )
}

interface LayoutProps {
  children: React.ReactNode
  role?: 'doctor' | 'assistant' | 'admin'
  userLabel?: string
}

export function Layout({ children, role, userLabel }: LayoutProps) {
  const nav = useNavigate()
  const loc = useLocation()

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Интерактивный фон: размытые teal-шарики со шлейфом за курсором */}
      <CursorOrbs />
      {/* В кабинетах держим данные свежими и подхватываем новые версии (врачи не жмут F5) */}
      {role && <AutoRefresh />}

      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-border/60 pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto flex items-center justify-end gap-2 px-4 sm:px-6 py-2 sm:py-2.5">
          <div className="flex items-center gap-2 sm:gap-3">
            {role ? <><NotificationBell /><MskClock /></> : <InstallPWA />}
            {userLabel && (
              <span className="text-sm text-muted-foreground hidden md:inline">{userLabel}</span>
            )}
            {role && (
              <Button variant="ghost" size="sm" onClick={() => clearAndRedirect()}>
                Выйти
              </Button>
            )}
            {!role && loc.pathname !== '/' && (
              <Button variant="ghost" size="sm" onClick={() => nav('/')}>
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="text-center text-xs text-muted-foreground/60 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <Link to="/help" className="hover:text-teal-700 transition-colors">Установка и автозапуск</Link>
        <span className="mx-2 opacity-50">·</span>
        NN+ · внутренний инструмент
        <span className="block mt-1 text-[10px] text-muted-foreground/20 tracking-wide">Разработчик · salim4ek</span>
      </footer>
    </div>
  )
}
