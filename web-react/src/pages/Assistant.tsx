import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, Phone, Bell, BellOff, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Layout } from '@/components/Layout'
import { MarqueeText } from '@/components/MarqueeText'
import { CallStandby } from '@/components/CallStandby'
import { useWebSocket } from '@/lib/useWebSocket'
import { fmtTime } from '@/lib/utils'
import { api } from '@/lib/api'
import { isPushOff, setPushOff, isIOS, isStandalone } from '@/lib/push'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Подписка на web-push: уведомление о вызове будет приходить в трей/на телефон,
// даже когда приложение закрыто.
async function subscribePush() {
  try {
    if (isPushOff()) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.ready
    const vp = await api<{ public_key: string; enabled: boolean }>('GET', '/api/push/vapid-public')
    if (!vp.enabled || !vp.public_key) return
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vp.public_key).buffer as ArrayBuffer,
      })
    }
    const j: any = sub.toJSON()
    await api('POST', '/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys })
  } catch (e) {
    console.warn('push subscribe failed', e)
  }
}

interface IncomingCall {
  call_id: string
  from_doctor: string
  message: string
  sent_at: string
}

type NotifState = 'default' | 'granted' | 'denied' | 'unsupported'

export function AssistantPage() {
  const [me, setMe] = useState<{ unique_id: string; full_name: string } | null>(null)
  const [call, setCall] = useState<IncomingCall | null>(null)
  const [notifState, setNotifState] = useState<NotifState>('default')
  const [notifBanner, setNotifBanner] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const soundRef = useRef<{ osc: OscillatorNode; gain: GainNode; timer: number } | null>(null)
  const ringRef = useRef<HTMLAudioElement | null>(null)
  const vibrateTimer = useRef<number | null>(null)
  const notifRef = useRef<Notification | null>(null)
  const spamTimer = useRef<number | null>(null)
  const spamCount = useRef(0)
  const [doctors, setDoctors] = useState<{ id: number; full_name: string; online: boolean }[]>([])
  const [selectedDoc, setSelectedDoc] = useState<number | null>(null)
  const [docMsg, setDocMsg] = useState('')
  const [broadcast, setBroadcast] = useState<{ from: string; message: string; at: string } | null>(null)
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  const { state: wsState, send } = useWebSocket((env) => {
    if (env.type === 'incoming') {
      setCall(env.payload)
      bringToFront()
      notifyBomber(env.payload)
      startSound()
    } else if (env.type === 'cancelled') {
      stopSound()
      hideNotif()
      stopBomber()
      setCall(null)
    } else if (env.type === 'accepted') {
      stopSound()
      hideNotif()
      stopBomber()
      setTimeout(() => setCall(null), 800)
    } else if (env.type === 'notify_sent') {
      toast.success('Сообщение отправлено врачу')
      setDocMsg('')
    } else if (env.type === 'broadcast') {
      playFuturistic()
      setBroadcast({ from: env.payload.from, message: env.payload.message, at: env.payload.sent_at })
      try {
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
          new Notification(`📢 ${env.payload.from}`, { body: env.payload.message, icon: '/icon-192.png', tag: 'nn-bcast' } as NotificationOptions)
        }
      } catch { /* */ }
    } else if (env.type === 'error') {
      toast.error(env.payload.message || env.payload.code)
    }
  })

  // Футуристичный короткий громкий сигнал для рассылок администрации
  function playFuturistic() {
    try {
      const ctx = ensureAudio()
      if (!ctx) return
      const now = ctx.currentTime
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(420, now)
      osc.frequency.exponentialRampToValueAtTime(1600, now + 0.16)
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.32)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(now); osc.stop(now + 0.42)
    } catch { /* */ }
  }

  function declineWithReason() {
    if (!call) return
    const reason = declineReason.trim() || 'Без причины'
    send('decline', { call_id: call.call_id, reason })
    stopSound(); hideNotif(); stopBomber()
    setDeclining(false); setDeclineReason(''); setCall(null)
  }

  // Сигнал в заголовок окна — нативная обёртка ловит это и поднимает окно поверх всех.
  useEffect(() => {
    document.title = call ? '🔴 ВЫЗОВ — NN+' : broadcast ? '📢 Сообщение — NN+' : 'NN+ Ассистент-Вызов'
  }, [call, broadcast])

  // Флаг занятости для авто-обновления: не перезагружать страницу во время вызова.
  useEffect(() => { (window as any).__nnBusy = !!call }, [call])

  function refreshDoctors() {
    api<{ id: number; full_name: string; online: boolean }[]>('GET', '/api/assistant/my-doctors')
      .then(setDoctors).catch(() => {})
  }

  function sendToDoctor() {
    if (!selectedDoc) { toast.error('Выберите врача'); return }
    const text = docMsg.trim()
    if (!text) { toast.error('Введите сообщение'); return }
    const ok = send('notify_doctor', { to: selectedDoc, message: text })
    if (!ok) toast.error('Нет соединения с сервером — подождите переподключения')
  }

  useEffect(() => {
    // Идентичность ассистента храним в localStorage (переживает обновление
    // страницы и переоткрытие вкладки). Старые сессии могли положить её в
    // sessionStorage — читаем как fallback и мигрируем.
    const n = localStorage.getItem('asm_name') || sessionStorage.getItem('asm_name')
    const u = localStorage.getItem('asm_uid') || sessionStorage.getItem('asm_uid')
    if (n && u) {
      localStorage.setItem('asm_name', n)
      localStorage.setItem('asm_uid', u)
      setMe({ full_name: n, unique_id: u })
    }

    // Detect notification support + current permission
    if (!('Notification' in window)) {
      setNotifState('unsupported')
    } else {
      setNotifState(Notification.permission as NotifState)
      if (Notification.permission === 'granted') subscribePush()
      else if (Notification.permission === 'default') setNotifBanner(true) // проактивно предлагаем включить
    }
    // На iPhone без установки на «Экран Домой» уведомления невозможны — подсказываем сразу.
    if (isIOS() && !isStandalone()) setNotifBanner(true)

    refreshDoctors()
    // Авто-обновление списка врачей и их online/offline каждые 10с (без кнопки «обновить»)
    const docsTimer = setInterval(refreshDoctors, 10000)

    // Разблокировка звука при первом взаимодействии со страницей
    // (autoplay-политика требует пользовательский жест). Заодно «праймим»
    // <audio>-рингтон — на iOS он надёжнее Web Audio и переживает блокировку экрана.
    const unlock = () => { ensureAudio(); primeRing() }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })

    // Try to keep the WebSocket alive by re-pinging every 30s
    const keep = setInterval(() => {
      // No-op — ws.js handles ping/pong. We just keep the page alive in background.
    }, 30_000)
    return () => {
      clearInterval(keep)
      clearInterval(docsTimer)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  function bringToFront() {
    try {
      // 1. Focus the current window/tab
      window.focus()
      // 2. Try to bring the browser to the front (limited browser support)
      if ('blur' in window) {
        // no-op, but some browsers support it
      }
      // 3. If page is in a different window, briefly show + focus
      if (document.visibilityState !== 'visible') {
        // Can't force-show a tab, but the OS notification click will focus us
      }
    } catch (e) { /* ignore */ }
  }

  // Spam-style notifications: fire one immediately, then re-fire every 5s.
  // Each iteration uses a unique tag so they stack in the notification tray.
  function notifyBomber(payload: IncomingCall) {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') {
      setNotifBanner(true)
      return
    }
    // Close any prior notif from this call
    if (notifRef.current) {
      try { notifRef.current.close() } catch { /* */ }
      notifRef.current = null
    }

    spamCount.current = 0
    const spamOnce = () => {
      spamCount.current++
      try {
        const ts = new Date().toLocaleTimeString('ru')
        const n = new Notification('🩺 Входящий вызов · ' + ts, {
          body: `${payload.from_doctor}\n${payload.message || 'Нужна помощь'}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          // No tag (or unique tag) → each new one stacks rather than replaces.
          tag: 'call-' + spamCount.current,
          requireInteraction: true,
          silent: false,
          // @ts-ignore — vibrate is mobile only
          vibrate: [300, 150, 300, 150, 300],
        })
        n.onclick = () => {
          try { window.focus() } catch { /* */ }
          try { n.close() } catch { /* */ }
        }
        notifRef.current = n
      } catch (e) {
        console.warn('notif failed:', e)
      }
    }
    spamOnce() // immediate
    // Re-fire every 5s. Browsers throttle background timers, but visibility
    // is forced to "visible" by the focus() call so this works while focused.
    spamTimer.current = window.setInterval(spamOnce, 5000)
  }

  function stopBomber() {
    if (spamTimer.current) {
      window.clearInterval(spamTimer.current)
      spamTimer.current = null
    }
    spamCount.current = 0
  }

  function hideNotif() {
    stopBomber()
    if (notifRef.current) {
      try { notifRef.current.close() } catch { /* */ }
      notifRef.current = null
    }
  }

  async function enableNotifications() {
    ensureAudio(); primeRing() // клик = жест → разблокируем звук вызова и рингтон
    if (isIOS() && !isStandalone()) {
      toast.error('На iPhone: «Поделиться» → «На экран Домой», откройте приложение оттуда — тогда можно включить уведомления', { duration: 7000 })
      return
    }
    if (!('Notification' in window)) {
      toast.error(isIOS() ? 'Для уведомлений обновите iPhone до iOS 16.4 или новее' : 'Браузер не поддерживает уведомления')
      return
    }
    if (Notification.permission === 'granted') {
      toast.success('Уведомления уже включены')
      setNotifState('granted')
      setPushOff(false)
      subscribePush()
      return
    }
    if (Notification.permission === 'denied') {
      toast.error('Уведомления заблокированы в настройках браузера')
      return
    }
    const result = await Notification.requestPermission()
    setNotifState(result as NotifState)
    if (result === 'granted') {
      toast.success('Уведомления включены')
      setPushOff(false)
      subscribePush()
      // Demo notification
      new Notification('NN+ — готово', {
        body: 'Теперь вы будете получать уведомления о вызовах',
        icon: '/icon-192.png',
      })
    } else {
      toast.error('Уведомления не получены')
    }
  }

  async function requestFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      }
    } catch (e) {
      console.warn('fullscreen failed:', e)
    }
  }

  // Один постоянный AudioContext, разблокируем его жестом пользователя
  // (клик «включить уведомления» или первое взаимодействие со страницей).
  // Иначе браузер держит контекст в состоянии 'suspended' и звонок без жеста
  // не воспроизводится (autoplay-политика) — это и была причина «звука нет».
  function ensureAudio(): AudioContext | null {
    try {
      if (!audioCtxRef.current) {
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
        audioCtxRef.current = new Ctx()
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return audioCtxRef.current
    } catch { return null }
  }

  // «Праймим» рингтон по жесту: короткий play→pause снимает iOS-блокировку автоплея,
  // после этого ring можно запускать программно при входящем вызове (даже без жеста).
  function primeRing() {
    const a = ringRef.current
    if (!a) return
    try { a.volume = 1; a.play().then(() => { a.pause(); a.currentTime = 0 }).catch(() => {}) } catch { /* */ }
  }

  function startSound() {
    // 1) Основной звук — зацикленный рингтон-файл через <audio loop>. Надёжно на iOS.
    try {
      const a = ringRef.current
      if (a) { a.currentTime = 0; a.volume = 1; a.play().catch(() => {}) }
    } catch { /* */ }
    // 2) Вибрация пакетами, пока идёт вызов (если поддерживается).
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([300, 150, 300, 150, 300])
        if (vibrateTimer.current) window.clearInterval(vibrateTimer.current)
        vibrateTimer.current = window.setInterval(() => navigator.vibrate([300, 150, 300, 150, 300]), 2000)
      }
    } catch { /* */ }
    // 3) Web Audio как дубль (десктоп/Android), если файл вдруг не воспроизвёлся.
    try {
      const ctx = ensureAudio()
      if (!ctx) return
      if (soundRef.current) { clearInterval(soundRef.current.timer); try { soundRef.current.osc.stop() } catch { /* */ }; soundRef.current = null }
      const gain = ctx.createGain()
      gain.gain.value = 0.18
      gain.connect(ctx.destination)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 880
      osc.connect(gain)
      osc.start()
      let on = true
      const timer = window.setInterval(() => {
        gain.gain.setValueAtTime(on ? 0.18 : 0, ctx.currentTime)
        on = !on
      }, 220)
      soundRef.current = { osc, gain, timer }
    } catch (e) { console.warn(e) }
  }
  function stopSound() {
    try { if (ringRef.current) { ringRef.current.pause(); ringRef.current.currentTime = 0 } } catch { /* */ }
    try {
      if (vibrateTimer.current) { window.clearInterval(vibrateTimer.current); vibrateTimer.current = null }
      if ('vibrate' in navigator) navigator.vibrate(0)
    } catch { /* */ }
    const a = soundRef.current
    if (!a) return
    clearInterval(a.timer)
    try { a.osc.stop() } catch { /* */ }
    a.osc.disconnect()
    a.gain.disconnect()
    soundRef.current = null
  }

  function accept() {
    if (!call) return
    send('accept', { call_id: call.call_id })
    stopSound()
    hideNotif()
  }
  function dismiss() {
    setCall(null)
    stopSound()
    hideNotif()
  }

  return (
    <Layout role="assistant" userLabel={me?.full_name ? `${me.full_name} · ${me.unique_id}` : ''}>
      <audio ref={ringRef} src="/ring.wav" loop preload="auto" />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Кабинет ассистента</h1>
          {me && (
            <p className="text-muted-foreground text-sm mt-1">
              ID <span className="font-mono text-teal-700">{me.unique_id}</span>
            </p>
          )}
        </header>
      </motion.div>

      {/* Notification banner */}
      <AnimatePresence>
        {notifBanner && notifState !== 'granted' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] flex items-center gap-3"
          >
            <Bell className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{isIOS() && !isStandalone() ? 'Установите приложение на iPhone' : 'Включите уведомления'}</p>
              <p className="text-xs text-muted-foreground">{isIOS() && !isStandalone()
                ? 'На iPhone вызов в фоне приходит только из приложения на «Экране Домой»: «Поделиться» ↑ → «На экран Домой», затем откройте оттуда и включите уведомления.'
                : 'Иначе вы можете пропустить вызов, если приложение в фоне.'}</p>
            </div>
            <Button onClick={enableNotifications} size="sm" variant="ghost">
              Включить
            </Button>
            <button onClick={() => setNotifBanner(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <CardContent className="min-h-[400px] flex flex-col items-center justify-center text-center py-16">
          <div className="mb-7 w-full flex justify-center">
            <CallStandby online={wsState === 'open'} />
          </div>
          <h2 className="text-2xl font-bold mb-2">{wsState === 'open' ? 'Ожидание вызова' : 'Восстанавливаем соединение…'}</h2>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            {wsState === 'open'
              ? 'Вы в сети. При вызове появится полноэкранное уведомление, звук и системный тост в Windows.'
              : 'Соединение прервано — переподключаемся автоматически. Не закрывайте вкладку.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={enableNotifications} variant="ghost" size="sm">
              {notifState === 'granted' ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              {notifState === 'granted' ? 'Уведомления включены' :
                notifState === 'denied' ? 'Уведомления заблокированы' :
                notifState === 'unsupported' ? (isIOS() ? 'Нужен iOS 16.4+ и установка на «Домой»' : 'Браузер не поддерживает') :
                'Включить уведомления'}
            </Button>
            <Button onClick={requestFullscreen} variant="ghost" size="sm">
              {document.fullscreenElement ? 'Выйти из полноэкранного' : 'Развернуть на весь экран'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Сообщение врачу */}
      <Card className="mt-6">
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Сообщение врачу</h2>
            <button onClick={refreshDoctors} className="text-xs text-muted-foreground hover:text-teal-700 transition-colors">обновить</button>
          </div>
          {doctors.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Пока ни один врач не добавил вас в свой список. Когда добавит — он появится здесь.
            </p>
          ) : (
            <>
              <div className="space-y-1.5 mb-3 max-h-44 overflow-auto pr-1">
                {doctors.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDoc(d.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                      selectedDoc === d.id ? 'border-teal-500 bg-teal-50' : 'border-border/60 bg-slate-50 hover:border-teal-400'
                    }`}
                  >
                    <MarqueeText className="font-semibold text-sm flex-1 min-w-0" text={d.full_name} />
                    <span className={`text-[11px] font-semibold ${d.online ? 'text-teal-600' : 'text-muted-foreground/60'}`}>
                      {d.online ? 'online' : 'offline'}
                    </span>
                  </button>
                ))}
              </div>
              <Textarea
                value={docMsg}
                onChange={(e) => setDocMsg(e.target.value)}
                placeholder="Например: «Подойдите в кабинет 12»"
                maxLength={300}
                className="min-h-[72px] mb-3"
              />
              <Button onClick={sendToDoctor} disabled={!selectedDoc || !docMsg.trim()} className="w-full">
                <Send className="w-4 h-4" /> Отправить врачу
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Incoming call modal */}
      <AnimatePresence>
        {call && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-md p-4"
            onClick={() => {}} // backdrop click does nothing — must accept/dismiss
          >
            <motion.div
              initial={{ scale: 0.85, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 24 }}
              className="w-full max-w-md rounded-2xl border border-border bg-white p-8 text-center shadow-xl text-foreground"
            >
              <motion.div
                animate={{ scale: [1, 1.12, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="w-24 h-24 mx-auto mb-6 rounded-full grid place-items-center bg-primary text-primary-foreground"
              >
                <Phone className="w-12 h-12" strokeWidth={2.5} />
              </motion.div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-teal-700 font-bold mb-2">⚡ Входящий вызов</p>
              <h2 className="text-4xl sm:text-5xl font-black mb-5 tracking-tight leading-tight">{call.from_doctor}</h2>
              <blockquote className="text-left bg-muted border-l-2 border-teal-500 rounded-r-md px-4 py-4 italic mb-5 text-lg sm:text-xl leading-snug">
                {call.message || '— нужна помощь —'}
              </blockquote>
              <p className="text-xs text-muted-foreground mb-6">Отправлено в {fmtTime(call.sent_at)}</p>
              <div className="flex flex-col gap-2">
                <Button onClick={accept} className="w-full h-20 text-xl font-bold">
                  <Check className="w-7 h-7" strokeWidth={2.5} /> Принять
                </Button>
                <Button onClick={() => { stopSound(); hideNotif(); stopBomber(); setDeclining(true) }} variant="ghost" className="w-full h-11 text-sm text-muted-foreground">
                  <X className="w-4 h-4" /> Отклонить
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Причина отклонения вызова */}
      <AnimatePresence>
        {declining && call && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-black/80 backdrop-blur-md p-4"
            onClick={() => setDeclining(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-border bg-white shadow-xl p-6 text-foreground"
            >
              <h2 className="text-lg font-bold mb-1">Причина отклонения</h2>
              <p className="text-xs text-muted-foreground mb-4">Врач увидит, что вы отклонили вызов, и причину.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {['Занят с пациентом', 'Не могу подойти', 'Перезвоните позже', 'Нет в кабинете'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setDeclineReason(r)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      declineReason === r ? 'border-rose-400 bg-rose-100 text-rose-700' : 'border-border/60 text-muted-foreground hover:border-rose-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Или своя причина…"
                maxLength={200}
                className="min-h-[64px] mb-3"
              />
              <Button onClick={declineWithReason} className="w-full bg-gradient-to-br from-rose-500 to-rose-700 text-white">
                Отклонить вызов
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">Нажмите вне окна, чтобы вернуться к вызову</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Рассылка от администрации */}
      <AnimatePresence>
        {broadcast && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-md p-4"
            onClick={() => setBroadcast(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-border bg-white p-7 text-center shadow-xl text-foreground"
            >
              <div className="text-3xl mb-2">📢</div>
              <h2 className="text-base font-bold text-foreground">{broadcast.from}</h2>
              <p className="text-base text-foreground mt-3 whitespace-pre-wrap">{broadcast.message}</p>
              <p className="text-xs text-muted-foreground mt-2">{fmtTime(broadcast.at)}</p>
              <Button onClick={() => setBroadcast(null)} className="w-full mt-5">Понятно</Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  )
}
