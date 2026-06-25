import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import {
  isPushOff, setPushOff, isIOS, isStandalone, pushSupported,
  subscribePush, unsubscribePush, pushIsOn,
} from '@/lib/push'

// Колокольчик в шапке: вкл/выкл уведомлений. Зачёркнутый (BellOff) = выключены.
export function NotificationBell() {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    pushIsOn().then((v) => { if (!cancelled) setOn(v) })
    return () => { cancelled = true }
  }, [])

  async function enable() {
    // iOS вне установленного PWA — push физически недоступен, нужна установка на «Домой».
    if (isIOS() && !isStandalone()) {
      toast.error('На iPhone: «Поделиться» → «На экран Домой», откройте приложение оттуда — тогда можно включить уведомления', { duration: 7000 })
      return
    }
    if (!('Notification' in window)) {
      toast.error(isIOS() ? 'Для уведомлений обновите iPhone до iOS 16.4 или новее' : 'Браузер не поддерживает уведомления')
      return
    }
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm === 'denied') {
      toast.error('Уведомления заблокированы — разрешите их в настройках браузера')
      return
    }
    if (perm !== 'granted') {
      toast('Разрешение не выдано — попробуйте ещё раз')
      return
    }
    setPushOff(false)
    void subscribePush(true)
    setOn(true)
    toast.success('Уведомления включены')
  }

  async function disable() {
    setPushOff(true)
    await unsubscribePush()
    setOn(false)
    toast('Уведомления выключены')
  }

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      if (on) await disable()
      else await enable()
    } catch {
      toast.error('Не удалось переключить уведомления')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={on ? 'Уведомления включены' : 'Уведомления выключены'}
      title={on ? 'Уведомления включены — нажмите, чтобы выключить' : 'Уведомления выключены — нажмите, чтобы включить'}
      className={
        'grid place-items-center w-9 h-9 rounded-full transition-colors shrink-0 self-center ' +
        (on
          ? 'text-teal-700 bg-teal-50 hover:bg-teal-100'
          : 'text-muted-foreground hover:text-teal-700 hover:bg-slate-100') +
        (busy ? ' opacity-50 pointer-events-none' : '')
      }
    >
      {on ? <Bell className="w-[18px] h-[18px]" /> : <BellOff className="w-[18px] h-[18px]" />}
    </button>
  )
}
