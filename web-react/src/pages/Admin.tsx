import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Check, X, Trash2, ShieldCheck, Users, ListChecks, Clock, Megaphone, Eye, EyeOff, Smartphone, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Layout } from '@/components/Layout'
import { MarqueeText } from '@/components/MarqueeText'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isIOS, isStandalone } from '@/lib/push'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
// Подписка админа на web-push (уведомления о новых заявках врачей при закрытой панели).
async function subscribePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.ready
    const vp = await api<{ public_key: string; enabled: boolean }>('GET', '/api/push/vapid-public')
    if (!vp.enabled || !vp.public_key) return
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vp.public_key).buffer as ArrayBuffer })
    const j: any = sub.toJSON()
    await api('POST', '/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys })
  } catch (e) { console.warn('push subscribe failed', e) }
}

interface Doctor { id: number; full_name: string; status: string; created_at: string }
interface Assistant { id: number; unique_id: string; full_name: string }
interface Admin { id: number; username: string; created_at: string }

export function AdminPage() {
  const qc = useQueryClient()
  const [newAdmUser, setNewAdmUser] = useState('')
  const [newAdmPass, setNewAdmPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [notifState, setNotifState] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')
  const [notifBanner, setNotifBanner] = useState(false)

  const [bcastMsg, setBcastMsg] = useState('')
  const broadcast = useMutation({
    mutationFn: (message: string) => api<{ delivered: number }>('POST', '/admin/broadcast', { message }),
    onSuccess: (r) => { toast.success(`Отправлено всем (${r.delivered} онлайн)`); setBcastMsg('') },
    onError: (e: Error) => toast.error(e.message),
  })

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('GET', '/admin/doctors') })
  const pending = useQuery({ queryKey: ['pending'], queryFn: () => api<Doctor[]>('GET', '/admin/doctors/pending'), refetchInterval: 10000 })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: () => api<Assistant[]>('GET', '/admin/assistants') })
  const admins = useQuery({ queryKey: ['admins'], queryFn: () => api<Admin[]>('GET', '/admin/admins') })
  const online = useQuery({ queryKey: ['online'], queryFn: () => api<{ online: Assistant[]; online_count: number; doctors_online: { id: number; full_name: string }[]; doctors_online_count: number }>('GET', '/admin/online'), refetchInterval: 5000 })

  const holders = useQuery({ queryKey: ['push-holders'], queryFn: () => api<{ assistants: string[]; doctors: number[] }>('GET', '/api/push/holders'), refetchInterval: 15000 })
  const hasApp = (kind: 'a' | 'd', key: string | number) =>
    kind === 'a' ? !!holders.data?.assistants?.includes(key as string) : !!holders.data?.doctors?.includes(key as number)

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ username: string }>('GET', '/api/me') })

  useEffect(() => {
    if (!('Notification' in window)) { setNotifState('unsupported'); return }
    setNotifState(Notification.permission as 'default' | 'granted' | 'denied')
    if (Notification.permission === 'granted') subscribePush()
    else setNotifBanner(true)
    if (isIOS() && !isStandalone()) setNotifBanner(true)
  }, [])

  async function enableNotifications() {
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

  const approve = useMutation({
    mutationFn: (id: number) => api<Doctor>('POST', `/admin/doctors/${id}/approve`),
    onSuccess: () => { toast.success('Врач подтверждён'); qc.invalidateQueries({ queryKey: ['doctors'] }); qc.invalidateQueries({ queryKey: ['pending'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const reject = useMutation({
    mutationFn: (id: number) => api<Doctor>('POST', `/admin/doctors/${id}/reject`),
    onSuccess: () => { toast.success('Заявка отклонена'); qc.invalidateQueries({ queryKey: ['doctors'] }); qc.invalidateQueries({ queryKey: ['pending'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const delDoc = useMutation({
    mutationFn: (id: number) => api<void>('DELETE', `/admin/doctors/${id}`),
    onSuccess: () => { toast.success('Врач удалён'); qc.invalidateQueries({ queryKey: ['doctors'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const delAsst = useMutation({
    mutationFn: (id: number) => api<void>('DELETE', `/admin/assistants/${id}`),
    onSuccess: () => { toast.success('Ассистент удалён'); qc.invalidateQueries({ queryKey: ['assistants'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const addAdm = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api<Admin>('POST', '/admin/admins', { username, password }),
    onSuccess: () => { toast.success('Админ создан'); setNewAdmUser(''); setNewAdmPass(''); qc.invalidateQueries({ queryKey: ['admins'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const rmAdm = useMutation({
    mutationFn: (id: number) => api<void>('DELETE', `/admin/admins/${id}`),
    onSuccess: () => { toast.success('Удалено'); qc.invalidateQueries({ queryKey: ['admins'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const myId = (() => {
    try {
      const t = localStorage.getItem('ac.token')!
      return JSON.parse(atob(t.split('.')[1])).uid
    } catch { return null }
  })()

  return (
    <Layout role="admin" userLabel={me.data?.username || 'Админ'}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Админ-панель</h1>
          <p className="text-muted-foreground text-sm mt-1">Управление врачами, ассистентами и админами</p>
        </header>
      </motion.div>

      {notifBanner && notifState !== 'granted' && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] flex items-center gap-3">
          <Bell className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{isIOS() && !isStandalone() ? 'Установите приложение на iPhone' : 'Включите уведомления'}</p>
            <p className="text-xs text-muted-foreground">{isIOS() && !isStandalone()
              ? 'На iPhone — установите PWA на «Экран Домой», тогда придёт push о новой заявке врача.'
              : 'Чтобы получать push о новой заявке врача, даже когда панель закрыта.'}</p>
          </div>
          {!(isIOS() && !isStandalone()) && (
            <Button onClick={enableNotifications} size="sm" variant="ghost">Включить</Button>
          )}
          <button onClick={() => setNotifBanner(false)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03, duration: 0.4 }} className="mb-6">
        <Card>
          <CardContent>
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Megaphone className="w-3.5 h-3.5" /> Рассылка всем пользователям
            </h2>
            <Textarea
              value={bcastMsg}
              onChange={(e) => setBcastMsg(e.target.value)}
              placeholder="Сообщение получат ВСЕ онлайн (врачи и ассистенты) — со звуковым уведомлением"
              maxLength={500}
              className="min-h-[72px] mb-3"
            />
            <Button onClick={() => bcastMsg.trim() && broadcast.mutate(bcastMsg.trim())} disabled={broadcast.isPending || !bcastMsg.trim()} className="w-full sm:w-auto">
              <Megaphone className="w-4 h-4" /> Отправить всем
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <p className="text-[11px] text-muted-foreground/80 mb-4 flex items-center gap-1.5">
        <Smartphone className="w-3.5 h-3.5 text-teal-600 shrink-0" /> — установлено приложение: пользователь получит уведомление, даже если не онлайн.
      </p>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pending doctor requests */}
        <SectionCard icon={Clock} title={`Заявки на регистрацию (${pending.data?.length ?? 0})`} delay={0.05}>
          {pending.data?.length ? (
            <ul className="space-y-2">
              {pending.data.map((d) => (
                <li key={d.id} className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{d.full_name}</p>
                    <p className="text-xs text-muted-foreground">Заявка от {new Date(d.created_at).toLocaleString('ru')}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button onClick={() => approve.mutate(d.id)} disabled={approve.isPending} size="sm">
                      <Check className="w-4 h-4" /> Подтвердить
                    </Button>
                    <Button onClick={() => reject.mutate(d.id)} disabled={reject.isPending} variant="ghost" size="sm">
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Нет новых заявок</p>
          )}
        </SectionCard>

        {/* Online doctors */}
        <SectionCard icon={Users} title={`Врачи онлайн (${online.data?.doctors_online_count ?? 0})`} delay={0.07}>
          {online.data?.doctors_online?.length ? (
            <ul className="space-y-1">
              {online.data.doctors_online.map((d) => (
                <li key={d.id} className="py-2 px-2 rounded border-b border-border/30 last:border-0 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="text-sm font-semibold">{d.full_name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Сейчас никто из врачей не в сети</p>
          )}
        </SectionCard>

        {/* Doctors */}
        <SectionCard icon={Users} title="Врачи" delay={0.1}>
          <ul className="space-y-1">
            {doctors.data?.length ? doctors.data.map((d) => (
              <li key={d.id} className="py-2 px-2 rounded hover:bg-slate-50 border-b border-border/30 last:border-0 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <MarqueeText className="min-w-0 flex-1" text={d.full_name} />
                    {hasApp('d', d.id) && <Smartphone className="w-3.5 h-3.5 text-teal-600 shrink-0" aria-label="Установлено приложение" />}
                    {d.status === 'pending' && <span className="text-[10px] uppercase tracking-wider text-amber-400 shrink-0">pending</span>}
                    {d.status === 'rejected' && <span className="text-[10px] uppercase tracking-wider text-rose-500 shrink-0">rejected</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.status === 'pending' && (
                    <>
                      <button onClick={() => approve.mutate(d.id)} className="text-teal-600 hover:text-teal-700" title="Подтвердить">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => reject.mutate(d.id)} className="text-muted-foreground hover:text-rose-500" title="Отклонить">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button onClick={() => { if (confirm(`Удалить ${d.full_name}?`)) delDoc.mutate(d.id) }} className="text-muted-foreground hover:text-rose-500" title="Удалить">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            )) : <li className="text-sm text-muted-foreground text-center py-4">Пока никого</li>}
          </ul>
        </SectionCard>

        {/* Assistants */}
        <SectionCard icon={Users} title={`Ассистенты (online: ${online.data?.online_count ?? 0})`} delay={0.15}>
          <ul className="space-y-1">
            {assistants.data?.length ? assistants.data.map((a) => {
              const isOn = online.data?.online.some((o) => o.unique_id === a.unique_id)
              return (
                <li key={a.id} className="py-2 px-2 rounded hover:bg-slate-50 border-b border-border/30 last:border-0 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <MarqueeText className="min-w-0 flex-1" text={a.full_name} />
                      {hasApp('a', a.unique_id) && <Smartphone className="w-3.5 h-3.5 text-teal-600 shrink-0" aria-label="Установлено приложение" />}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{a.unique_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold', isOn ? 'text-teal-600' : 'text-muted-foreground/60')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', isOn ? 'bg-primary' : 'bg-current')} />
                      {isOn ? 'online' : 'offline'}
                    </span>
                    <button onClick={() => { if (confirm(`Удалить ${a.full_name}?`)) delAsst.mutate(a.id) }} className="text-muted-foreground hover:text-rose-500" title="Удалить">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              )
            }) : <li className="text-sm text-muted-foreground text-center py-4">Пока никого</li>}
          </ul>
        </SectionCard>

        {/* Admins */}
        <SectionCard icon={ShieldCheck} title="Администраторы" delay={0.2}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newAdmUser.trim() && newAdmPass.length >= 6)
                addAdm.mutate({ username: newAdmUser.trim(), password: newAdmPass })
            }}
            className="space-y-2 mb-4"
          >
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Логин нового админа</span>
              <Input value={newAdmUser} onChange={(e) => setNewAdmUser(e.target.value)} placeholder="например, ivanov" autoComplete="off" required className="mt-1" />
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Пароль</span>
              <div className="relative mt-1">
                <Input
                  type={showPass ? 'text' : 'password'}
                  value={newAdmPass}
                  onChange={(e) => setNewAdmPass(e.target.value)}
                  placeholder="минимум 6 символов"
                  className="pr-10"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-teal-700 transition-colors"
                  title={showPass ? 'Скрыть пароль' : 'Показать пароль'}
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newAdmPass.length > 0 && newAdmPass.length < 6 && (
                <p className="text-[11px] text-amber-400 mt-1">Ещё {6 - newAdmPass.length} симв.</p>
              )}
            </div>
            <Button type="submit" disabled={addAdm.isPending || !newAdmUser.trim() || newAdmPass.length < 6} className="w-full">
              <Check className="w-4 h-4" /> Создать админа
            </Button>
          </form>
          <ul className="space-y-1">
            {admins.data?.length ? admins.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 px-2 rounded hover:bg-slate-50 border-b border-border/30 last:border-0">
                <span className="text-sm flex items-center gap-2">
                  {a.username}
                  {a.id === myId && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">(вы)</span>}
                </span>
                {a.id !== myId && (
                  <button onClick={() => { if (confirm('Удалить ' + a.username + '?')) rmAdm.mutate(a.id) }} className="text-muted-foreground hover:text-rose-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            )) : <li className="text-sm text-muted-foreground text-center py-4">Нет админов</li>}
          </ul>
        </SectionCard>
      </div>
    </Layout>
  )
}

function SectionCard({ icon: Icon, title, children, delay = 0 }: { icon: any; title: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <Card>
        <CardContent>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
            <Icon className="w-3.5 h-3.5" /> {title}
          </h2>
          {children}
        </CardContent>
      </Card>
    </motion.div>
  )
}
