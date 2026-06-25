import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Phone, Trash2, Search, Loader2, Check, X, UserPlus, Send, Bell, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { api, getToken } from '@/lib/api'
import { isPushOff, isIOS, isStandalone } from '@/lib/push'
import { useWebSocket } from '@/lib/useWebSocket'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Layout } from '@/components/Layout'
import { MarqueeText } from '@/components/MarqueeText'
import { fmtTime, cn } from '@/lib/utils'

interface Me {
  role: 'doctor' | 'assistant' | 'admin'
  full_name?: string
  email?: string
  username?: string
  unique_id?: string
  online?: boolean
}

interface AssistantView {
  id: number
  unique_id: string
  full_name: string
  online: boolean
}

interface MyAssistant extends AssistantView {
  assistant_id: number
  created_at: string
}

interface LookupResult {
  unique_id: string
  full_name: string
  online: boolean
}

// Короткий, но ГРОМКИЙ сигнал уведомления (для сообщений от ассистента).
// Отличается от непрерывного звонка у ассистента — это два коротких бипа.
let _dctx: AudioContext | null = null
function ensureDoctorAudio(): AudioContext | null {
  try {
    if (!_dctx) { const C = (window.AudioContext || (window as any).webkitAudioContext); _dctx = new C() }
    if (_dctx.state === 'suspended') _dctx.resume().catch(() => {})
  } catch { return null }
  return _dctx
}
function playAlertBeep() {
  const ctx = ensureDoctorAudio()
  if (!ctx) return
  const now = ctx.currentTime
  ;[0, 0.2].forEach((t) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.type = 'square'; osc.frequency.value = 1046
    gain.gain.setValueAtTime(0.0001, now + t)
    gain.gain.exponentialRampToValueAtTime(0.6, now + t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(now + t); osc.stop(now + t + 0.18)
  })
}

// Футуристичный короткий громкий сигнал для рассылок администрации.
function playFuturisticBeep() {
  const ctx = ensureDoctorAudio()
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
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Подписка врача на web-push (уведомления о сообщениях/рассылках при закрытом приложении).
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
  } catch (e) { console.warn('push subscribe failed', e) }
}

// Системное уведомление (когда вкладка/приложение в фоне — модалку не видно).
function showSystemNotif(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: '/icon-192.png', tag: 'nn-doctor' } as NotificationOptions)
    }
  } catch { /* */ }
}

interface AllAssistant { id: number; unique_id: string; full_name: string; online: boolean; added: boolean }

export function DoctorPage() {
  const qc = useQueryClient()
  const [asstMsg, setAsstMsg] = useState<{ from: string; message: string; at: string } | null>(null)
  const [broadcast, setBroadcast] = useState<{ from: string; message: string; at: string } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [notifState, setNotifState] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')
  const [notifBanner, setNotifBanner] = useState(false)
  const [allSearch, setAllSearch] = useState('')
  const [selected, setSelected] = useState<MyAssistant | null>(null)
  const [message, setMessage] = useState('')
  const [lookup, setLookup] = useState('')
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [status, setStatus] = useState<{ text: string; kind: 'muted' | 'ok' | 'err' | 'warn' }>({ text: 'Готово к вызову', kind: 'muted' })
  const [inCall, setInCall] = useState(false)
  const [currentCallID, setCurrentCallID] = useState<string | null>(null)
  const [ack, setAck] = useState<{ by: string; at: string } | null>(null)
  const [cancelledMsg, setCancelledMsg] = useState<string | null>(null)
  const lookupTimer = useRef<number | null>(null)
  const callTimeout = useRef<number | null>(null)
  const callIDRef = useRef<string | null>(null)

  function clearCallTimeout() {
    if (callTimeout.current) { window.clearTimeout(callTimeout.current); callTimeout.current = null }
  }

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('GET', '/api/me') })
  const { data: myList = [] } = useQuery({
    queryKey: ['my-assistants'],
    queryFn: () => api<MyAssistant[]>('GET', '/api/doctor/assistants'),
  })
  const { data: appHolders } = useQuery({
    queryKey: ['push-holders'],
    queryFn: () => api<{ assistants: string[]; doctors: number[] }>('GET', '/api/push/holders'),
  })

  const addMut = useMutation({
    mutationFn: (uid: string) => api<MyAssistant>('POST', '/api/doctor/assistants', { unique_id: uid.toUpperCase() }),
    onSuccess: (data) => {
      toast.success('Ассистент добавлен')
      setLookup('')
      setLookupResult(null)
      qc.invalidateQueries({ queryKey: ['my-assistants'] })
      qc.invalidateQueries({ queryKey: ['all-assistants'] })
      setSelected(data)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => api<void>('DELETE', `/api/doctor/assistants/${id}`),
    onSuccess: () => {
      toast.success('Удалено')
      qc.invalidateQueries({ queryKey: ['my-assistants'] })
      setSelected(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { state: wsState, send } = useWebSocket((env) => {
    if (env.type === 'presence') {
      qc.invalidateQueries({ queryKey: ['my-assistants'] })
    } else if (env.type === 'ack') {
      callIDRef.current = env.payload.call_id
      setCurrentCallID(env.payload.call_id)
      setStatus({ text: `Вызов отправлен (id ${env.payload.call_id.slice(0, 8)}…)`, kind: 'warn' })
    } else if (env.type === 'accepted') {
      clearCallTimeout(); callIDRef.current = null
      setInCall(false)
      setCurrentCallID(null)
      setAck({ by: env.payload.by, at: env.payload.accepted_at })
      setStatus({ text: `Принято: ${env.payload.by}`, kind: 'ok' })
    } else if (env.type === 'cancelled') {
      clearCallTimeout(); callIDRef.current = null
      setInCall(false)
      setCurrentCallID(null)
      setCancelledMsg('Вызов отменён')
      setStatus({ text: 'Вызов отменён', kind: 'muted' })
    } else if (env.type === 'error') {
      clearCallTimeout(); callIDRef.current = null
      setInCall(false)
      setCurrentCallID(null)
      setStatus({ text: 'Ошибка: ' + (env.payload.message || env.payload.code), kind: 'err' })
    } else if (env.type === 'doctor_alert') {
      // Сообщение от ассистента → короткий громкий сигнал + всплывающее окно + системное уведомление
      playAlertBeep()
      setAsstMsg({ from: env.payload.from_assistant, message: env.payload.message, at: env.payload.sent_at })
      toast(`Сообщение от ${env.payload.from_assistant}`, { description: env.payload.message, duration: 10000 })
      showSystemNotif(`Сообщение от ${env.payload.from_assistant}`, env.payload.message)
    } else if (env.type === 'declined') {
      clearCallTimeout(); callIDRef.current = null
      setInCall(false); setCurrentCallID(null)
      const r = env.payload.reason ? `: ${env.payload.reason}` : ''
      setStatus({ text: `Ассистент отклонил вызов${r}`, kind: 'err' })
      toast.error('Ассистент отклонил вызов', { description: env.payload.reason, duration: 10000 })
    } else if (env.type === 'broadcast') {
      playFuturisticBeep()
      setBroadcast({ from: env.payload.from, message: env.payload.message, at: env.payload.sent_at })
      showSystemNotif(`📢 ${env.payload.from}`, env.payload.message)
    }
  })

  // Разблокировка звука + подписка на push при первом взаимодействии
  useEffect(() => {
    if (!('Notification' in window)) setNotifState('unsupported')
    else {
      setNotifState(Notification.permission as 'default' | 'granted' | 'denied')
      if (Notification.permission === 'granted') subscribePush()
      else setNotifBanner(true) // нет разрешения → проактивно предлагаем включить
    }
    if (isIOS() && !isStandalone()) setNotifBanner(true)
    const unlock = () => {
      ensureDoctorAudio()
      if ('Notification' in window && Notification.permission === 'granted') subscribePush()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // Явное включение уведомлений врачом: разрешение + подписка на push (сообщения/вызовы
  // при закрытом приложении) + разблокировка звука сигнала.
  async function enableNotifications() {
    ensureDoctorAudio()
    if (isIOS() && !isStandalone()) {
      toast('Установите приложение на iPhone', { description: '«Поделиться» ↑ → «На экран Домой», откройте оттуда и нажмите снова.', duration: 9000 })
      return
    }
    if (!('Notification' in window)) { toast.error('Браузер не поддерживает уведомления'); return }
    if (Notification.permission === 'denied') { toast.error('Уведомления заблокированы в настройках браузера'); return }
    const res = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    setNotifState(res as 'default' | 'granted' | 'denied')
    if (res === 'granted') { setNotifBanner(false); subscribePush(); toast.success('Уведомления включены') }
    else toast.error('Уведомления не получены')
  }

  // Сигнал в заголовок окна — нативная обёртка поднимает окно поверх всех.
  useEffect(() => {
    document.title = asstMsg ? '📨 Сообщение — NN+' : broadcast ? '📢 Сообщение — NN+' : 'NN+ Ассистент-Вызов'
  }, [asstMsg, broadcast])

  // Флаг занятости для авто-обновления: не перезагружать во время вызова/модалок.
  useEffect(() => { (window as any).__nnBusy = inCall || !!ack || !!asstMsg || !!broadcast }, [inCall, ack, asstMsg, broadcast])

  const { data: allAssistants = [] } = useQuery({
    queryKey: ['all-assistants'],
    queryFn: () => api<AllAssistant[]>('GET', '/api/doctor/all-assistants'),
    enabled: showAll,
  })

  useEffect(() => {
    if (wsState === 'closed' || wsState === 'reconnecting') {
      if (!inCall) setStatus({ text: 'Соединение потеряно, переподключаемся…', kind: 'warn' })
    } else if (wsState === 'open' && !inCall) {
      setStatus({ text: 'Готово к вызову', kind: 'muted' })
    }
  }, [wsState, inCall])

  // Lookup with debounce
  useEffect(() => {
    if (lookupTimer.current) window.clearTimeout(lookupTimer.current)
    const v = lookup.toUpperCase().trim()
    if (v.length < 4) { setLookupResult(null); setLookupError(''); return }
    lookupTimer.current = window.setTimeout(async () => {
      try {
        const r = await api<LookupResult>('GET', `/api/assistant/lookup?unique_id=${encodeURIComponent(v)}`)
        setLookupResult(r); setLookupError('')
      } catch (e: any) { setLookupResult(null); setLookupError(e.message) }
    }, 350)
  }, [lookup])

  const onlineCount = useMemo(() => myList.filter((a) => a.online).length, [myList])

  function handleCall() {
    if (!selected) return
    const text = message.trim()
    if (!text) { setStatus({ text: 'Введите сообщение', kind: 'err' }); return }
    // send() возвращает false, если WebSocket не открыт — тогда вызов не уйдёт,
    // и врач не должен застрять в «ожидании» (это была одна из причин «вызова нет»).
    const ok = send('call', { to: selected.unique_id, message: text })
    if (!ok) {
      setStatus({ text: 'Нет соединения с сервером — подождите переподключения и попробуйте снова', kind: 'err' })
      return
    }
    setInCall(true)
    setStatus({ text: 'Ожидаем ответа ассистента…', kind: 'warn' })
    // Авто-таймаут: если ассистент не принял за 45 секунд — снимаем ожидание
    // и отменяем вызов на сервере, чтобы не висело бесконечно.
    clearCallTimeout()
    callTimeout.current = window.setTimeout(() => {
      if (callIDRef.current) send('cancel', { call_id: callIDRef.current })
      callIDRef.current = null
      setInCall(false)
      setCurrentCallID(null)
      setStatus({ text: 'Ассистент не ответил за 2,5 минуты. Попробуйте ещё раз.', kind: 'err' })
    }, 150_000)
  }

  function handleCancel() {
    clearCallTimeout()
    const id = callIDRef.current || currentCallID
    if (id) send('cancel', { call_id: id })
    callIDRef.current = null
    setInCall(false)
    setCurrentCallID(null)
    setStatus({ text: id ? 'Вызов отменён' : 'Ожидание прервано', kind: 'muted' })
  }

  return (
    <Layout role="doctor" userLabel={me?.full_name || 'Врач'}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Кабинет врача</h1>
          <p className="text-muted-foreground text-sm mt-1">Управляйте списком ассистентов и отправляйте вызовы</p>
        </header>
      </motion.div>

      <AnimatePresence>
        {notifBanner && notifState !== 'granted' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] flex items-center gap-3"
          >
            <Bell className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{isIOS() && !isStandalone() ? 'Установите приложение на iPhone' : 'Включите уведомления'}</p>
              <p className="text-xs text-muted-foreground">{isIOS() && !isStandalone()
                ? 'На iPhone сообщения/вызовы в фоне приходят только из приложения на «Экране Домой».'
                : 'Иначе вы пропустите сообщение от ассистента, когда приложение в фоне или закрыто.'}</p>
            </div>
            {!(isIOS() && !isStandalone()) && (
              <Button onClick={enableNotifications} size="sm" variant="ghost">Включить</Button>
            )}
            <button onClick={() => setNotifBanner(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* LEFT: list + add */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }} className="min-w-0">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Мои ассистенты <Badge>{onlineCount} online</Badge>
                </h2>
              </div>

              {myList.length === 0 ? (
                <EmptyList />
              ) : (
                <ul className="space-y-2 mb-4">
                  <AnimatePresence>
                    {myList.map((a) => (
                      <motion.li
                        key={a.id}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        className={cn(
                          'group relative p-4 rounded-lg border bg-slate-50 transition-all cursor-pointer',
                          selected?.id === a.id
                            ? 'border-teal-500 bg-teal-50'
                            : 'border-border hover:border-teal-400 hover:translate-x-0.5',
                        )}
                        onClick={() => setSelected(a)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <MarqueeText className="font-semibold text-foreground" text={a.full_name} />
                            <p className="text-xs text-muted-foreground font-mono mt-0.5">{a.unique_id}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            {appHolders?.assistants?.includes(a.unique_id) && (
                              <Smartphone className="w-4 h-4 text-teal-600 shrink-0" aria-label="Установлено приложение — получит уведомление даже офлайн" />
                            )}
                            <StatusDot online={a.online} />
                            <button
                              onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить ${a.full_name}?`)) removeMut.mutate(a.id) }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-rose-500 hover:text-rose-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}

              <p className="text-[11px] text-muted-foreground/80 mb-4 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-teal-600 shrink-0" /> — установлено приложение: получит уведомление о вызове, даже если не онлайн.
              </p>

              {/* Add by ID */}
              <div className="border-t border-border/40 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <UserPlus className="w-3.5 h-3.5" /> Добавить по ID
                </h3>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={lookup}
                    onChange={(e) => setLookup(e.target.value)}
                    placeholder="NN-A4B7C2"
                    className="pl-10 font-mono uppercase tracking-wider"
                    maxLength={40}
                  />
                </div>

                <AnimatePresence mode="wait">
                  {lookupError && (
                    <motion.p key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-rose-500 mt-2">✖ {lookupError}</motion.p>
                  )}
                  {lookupResult && (
                    <motion.div
                      key="res"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="mt-3 p-4 rounded-lg border border-teal-300 bg-teal-50"
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <MarqueeText className="font-semibold text-foreground" text={lookupResult.full_name} />
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">{lookupResult.unique_id}</p>
                        </div>
                        <StatusDot online={lookupResult.online} />
                      </div>
                      <Button onClick={() => addMut.mutate(lookupResult.unique_id)} disabled={addMut.isPending} className="w-full">
                        {addMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Добавить в мой список
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Все ассистенты системы + поиск */}
              <div className="border-t border-border/40 pt-4 mt-4">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2 hover:text-teal-700 transition-colors"
                >
                  <Search className="w-3.5 h-3.5" /> {showAll ? 'Скрыть всех ассистентов' : 'Все ассистенты системы'}
                </button>
                {showAll && (
                  <div>
                    <div className="relative mb-2">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={allSearch}
                        onChange={(e) => setAllSearch(e.target.value)}
                        placeholder="Поиск по имени или ID…"
                        className="pl-10"
                      />
                    </div>
                    <ul className="space-y-1.5 max-h-72 overflow-auto pr-1">
                      {allAssistants
                        .filter((a) => {
                          const q = allSearch.toLowerCase().trim()
                          return !q || a.full_name.toLowerCase().includes(q) || a.unique_id.toLowerCase().includes(q)
                        })
                        .map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border/60 bg-slate-50">
                            <div className="min-w-0">
                              <MarqueeText className="text-sm font-semibold" text={a.full_name} />
                              <p className="text-[11px] font-mono text-muted-foreground">{a.unique_id}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <StatusDot online={a.online} />
                              {a.added ? (
                                <span className="text-[11px] text-teal-600 font-semibold">в списке</span>
                              ) : (
                                <Button size="sm" variant="ghost" disabled={addMut.isPending} onClick={() => addMut.mutate(a.unique_id)}>
                                  <Plus className="w-4 h-4" /> Добавить
                                </Button>
                              )}
                            </div>
                          </li>
                        ))}
                      {allAssistants.length === 0 && (
                        <li className="text-xs text-muted-foreground text-center py-3">Загрузка…</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* RIGHT: call panel */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }} className="min-w-0">
          <Card>
            <CardContent>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Вызов</h2>

              <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-border/40">
                <p className="text-xs text-muted-foreground mb-1">Выбран:</p>
                {selected ? (
                  <div>
                    <MarqueeText className="text-lg font-bold text-foreground leading-tight" text={selected.full_name} />
                    <p className="text-xs font-mono text-muted-foreground">{selected.unique_id}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Выберите ассистента из списка</p>
                )}
              </div>

              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Текст сообщения (например: «Нужна помощь в кабинете 12»)"
                maxLength={500}
                className="min-h-[100px] mb-3"
              />

              <Button
                onClick={handleCall}
                disabled={!selected || !message.trim() || inCall}
                className="w-full bg-primary text-primary-foreground h-16 text-lg font-bold !whitespace-normal leading-tight"
              >
                {inCall ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
                {inCall ? 'ОЖИДАНИЕ ОТВЕТА…' : 'ВЫЗВАТЬ АССИСТЕНТА'}
              </Button>

              {inCall && (
                <Button
                  onClick={handleCancel}
                  variant="ghost"
                  className="w-full h-11 mt-2 border-rose-300 text-rose-600 hover:bg-rose-50"
                >
                  ✖ Отменить вызов
                </Button>
              )}

              <p className={cn('text-xs mt-3', statusClass(status.kind))}>{status.text}</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Ack modal */}
      <AnimatePresence>
        {ack && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setAck(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-white border border-border shadow-xl p-8 text-center"
            >
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="w-20 h-20 mx-auto mb-5 rounded-full grid place-items-center bg-primary text-primary-foreground"
              >
                <Check className="w-10 h-10" strokeWidth={3} />
              </motion.div>
              <h2 className="text-xl font-bold text-foreground">Вызов принят</h2>
              <p className="text-sm text-muted-foreground mt-2">
                <span className="text-teal-700 font-semibold">{ack.by}</span> принял(а) вызов в {fmtTime(ack.at)}
              </p>
              <Button onClick={() => setAck(null)} className="w-full mt-6">Закрыть</Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Сообщение от ассистента */}
      <AnimatePresence>
        {asstMsg && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setAsstMsg(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-white border border-border shadow-xl p-7 text-center"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full grid place-items-center bg-primary text-primary-foreground">
                <Send className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Сообщение от ассистента</h2>
              <p className="text-sm text-teal-700 font-semibold mt-1">{asstMsg.from}</p>
              <p className="text-base text-foreground mt-3 whitespace-pre-wrap">{asstMsg.message}</p>
              <p className="text-xs text-muted-foreground mt-2">{fmtTime(asstMsg.at)}</p>
              <Button onClick={() => setAsstMsg(null)} className="w-full mt-5">Закрыть</Button>
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
              className="w-full max-w-sm rounded-2xl bg-white border border-border shadow-xl p-7 text-center"
            >
              <div className="text-3xl mb-2">📢</div>
              <h2 className="text-base font-bold text-cyan-700">{broadcast.from}</h2>
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

function statusClass(kind: 'muted' | 'ok' | 'err' | 'warn') {
  switch (kind) {
    case 'ok': return 'text-teal-600'
    case 'err': return 'text-rose-500'
    case 'warn': return 'text-amber-400'
    default: return 'text-muted-foreground'
  }
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold', online ? 'text-teal-600' : 'text-muted-foreground/60')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-teal-500 animate-pulse' : 'bg-current')} />
      {online ? 'online' : 'offline'}
    </span>
  )
}

function EmptyList() {
  return (
    <div className="text-center py-10 px-4 border border-dashed border-border/60 rounded-lg">
      <UserPlus className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
      <p className="text-sm text-muted-foreground">Пока пусто. Добавьте ассистента по ID или из списка всех — в разделах ниже.</p>
    </div>
  )
}
