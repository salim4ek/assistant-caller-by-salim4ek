import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Stethoscope, UserRound, ShieldCheck, Copy, Check, ArrowRight, Clock, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { api, setToken, getToken, decodeJWT } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Logo } from '@/components/Logo'
import { Layout } from '@/components/Layout'
import { isIOS, isStandalone } from '@/lib/push'

type Role = 'doctor' | 'assistant' | 'admin'
type AssistantMode = 'login' | 'register'
type DoctorMode = 'login' | 'register'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function LoginPage() {
  const nav = useNavigate()
  const [role, setRole] = useState<Role>('doctor')
  const [asmMode, setAsmMode] = useState<AssistantMode>('login')
  const [docMode, setDocMode] = useState<DoctorMode>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [regUID, setRegUID] = useState<string | null>(null)
  const [doctorPending, setDoctorPending] = useState<string | null>(null)
  const [pendingPass, setPendingPass] = useState('')
  const [notifBusy, setNotifBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Если уже авторизован — не показываем форму входа, уводим в кабинет.
  // Только кнопка «Выйти» (clearAndRedirect) должна оставлять на странице входа.
  useEffect(() => {
    const t = getToken()
    if (!t) return
    const claims = decodeJWT<{ role?: string }>(t)
    if (claims?.role === 'doctor' || claims?.role === 'assistant' || claims?.role === 'admin') {
      nav('/' + claims.role, { replace: true })
    }
  }, [])

  async function loginDoctor(fullName: string, password: string) {
    setLoading(true); setError('')
    try {
      const data = await api<{ token: string; role: string }>('POST', '/auth/doctor/login', { full_name: fullName, password })
      setToken(data.token)
      nav('/doctor')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  async function registerDoctor(fullName: string, password: string) {
    setLoading(true); setError('')
    try {
      await api('POST', '/auth/doctor/register', { full_name: fullName, password })
      setDoctorPending(fullName)
      setPendingPass(password)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  // Пока врач на экране ожидания — тихо опрашиваем вход: как только админ одобрит,
  // входим автоматически (работает, пока вкладка открыта; push покрывает закрытое).
  useEffect(() => {
    if (!doctorPending || !pendingPass) return
    const t = setInterval(async () => {
      try {
        const data = await api<{ token: string }>('POST', '/auth/doctor/login', { full_name: doctorPending, password: pendingPass })
        if (data?.token) { setToken(data.token); clearInterval(t); nav('/doctor') }
      } catch { /* ещё на модерации */ }
    }, 15000)
    return () => clearInterval(t)
  }, [doctorPending, pendingPass])

  // Подписка врача «на модерации» на push об одобрении (придёт даже при закрытом приложении).
  async function enableApprovalNotif() {
    if (!doctorPending) return
    setNotifBusy(true)
    try {
      if (isIOS() && !isStandalone()) {
        toast('Установите приложение на iPhone', { description: '«Поделиться» ↑ → «На экран Домой», откройте оттуда и нажмите снова.', duration: 9000 })
        return
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast.error('Браузер не поддерживает уведомления'); return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { toast.error('Уведомления не разрешены'); return }
      const vp = await api<{ public_key: string; enabled: boolean }>('GET', '/auth/vapid-public')
      if (!vp.enabled || !vp.public_key) { toast.error('Push не настроен на сервере'); return }
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vp.public_key).buffer as ArrayBuffer })
      const j: any = sub.toJSON()
      await api('POST', '/auth/doctor/pending-subscribe', { full_name: doctorPending, password: pendingPass, endpoint: j.endpoint, keys: j.keys })
      toast.success('Готово — пришлём уведомление, как только одобрят')
    } catch (e: any) {
      toast.error('Не удалось включить: ' + (e?.message || 'ошибка'))
    } finally { setNotifBusy(false) }
  }

  async function registerAssistant(fullName: string) {
    setLoading(true); setError('')
    try {
      const data = await api<{ token: string; unique_id: string; full_name: string }>('POST', '/auth/assistant/register', { full_name: fullName })
      setToken(data.token)
      localStorage.setItem('asm_name', data.full_name)
      localStorage.setItem('asm_uid', data.unique_id)
      setRegUID(data.unique_id)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  async function loginAssistant(identifier: string) {
    setLoading(true); setError('')
    try {
      const data = await api<{ token: string; unique_id: string; full_name: string }>('POST', '/auth/assistant/login', { identifier })
      setToken(data.token)
      localStorage.setItem('asm_name', data.full_name)
      localStorage.setItem('asm_uid', data.unique_id)
      nav('/assistant')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  async function loginAdmin(username: string, password: string) {
    setLoading(true); setError('')
    try {
      const data = await api<{ token: string; role: string }>('POST', '/admin/login', { username, password })
      setToken(data.token)
      nav('/admin')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <Layout>
      <div className="min-h-[70vh] flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-10"
        >
          <Logo size="xl" className="mb-4 nn-ring" />
          <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
            Ассистент-Вызов
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            Мгновенная связь врача и ассистента
          </p>
        </motion.div>

        {regUID ? (
          <RegResult uid={regUID} copied={copied} setCopied={setCopied} onContinue={() => nav('/assistant')} />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md"
          >
            <Card>
              <CardContent className="space-y-6">
                {/* Role tabs */}
                <div className="flex gap-1 p-1 rounded-full bg-slate-100 border border-border/60">
                  {([
                    { id: 'doctor', label: 'Врач', icon: Stethoscope },
                    { id: 'assistant', label: 'Ассистент', icon: UserRound },
                    { id: 'admin', label: '', icon: ShieldCheck },
                  ] as const).map((t) => {
                    const Icon = t.icon
                    const active = role === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setRole(t.id); setError('') }}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-sm font-semibold transition-all ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {t.label && <span>{t.label}</span>}
                      </button>
                    )
                  })}
                </div>

                <AnimatePresence mode="wait">
                  {role === 'doctor' && (
                    <motion.div
                      key="doctor"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      {doctorPending ? (
                        <div className="text-center py-6 space-y-4">
                          <div className="w-14 h-14 rounded-full mx-auto grid place-items-center bg-amber-100 text-amber-600 border border-amber-300">
                            <Clock className="w-7 h-7" />
                          </div>
                          <h2 className="text-lg font-bold">Заявка отправлена</h2>
                          <p className="text-sm text-muted-foreground">
                            <span className="text-foreground font-semibold">{doctorPending}</span>, ваша заявка ожидает подтверждения администратора. Как только одобрят — вы войдёте автоматически.
                          </p>
                          <Button onClick={enableApprovalNotif} disabled={notifBusy} className="w-full">
                            <Bell className="w-4 h-4" /> {notifBusy ? 'Включаем…' : 'Уведомить, когда одобрят'}
                          </Button>
                          <Button variant="ghost" onClick={() => { setDoctorPending(null); setPendingPass(''); setError(''); setDocMode('login') }} className="w-full">
                            Назад ко входу
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex gap-1 p-0.5 rounded-full bg-slate-100 border border-border/60 w-fit text-xs">
                            {(['login', 'register'] as const).map((m) => (
                              <button
                                key={m}
                                onClick={() => { setDocMode(m); setError('') }}
                                className={`px-4 py-1.5 rounded-full font-semibold transition-all ${
                                  docMode === m
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {m === 'login' ? 'Войти' : 'Регистрация'}
                              </button>
                            ))}
                          </div>

                          {docMode === 'login' ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                const fd = new FormData(e.currentTarget)
                                loginDoctor(String(fd.get('full_name')), String(fd.get('password')))
                              }}
                              className="space-y-4"
                            >
                              <Field label="ФИО" name="full_name" placeholder="Иванов Иван Иванович" required />
                              <Field label="Пароль" name="password" type="password" required />
                              <SubmitBlock loading={loading} error={error}>Войти как врач</SubmitBlock>
                            </form>
                          ) : (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                const fd = new FormData(e.currentTarget)
                                registerDoctor(String(fd.get('full_name')), String(fd.get('password')))
                              }}
                              className="space-y-4"
                            >
                              <Field label="Ваше ФИО" name="full_name" placeholder="Иванов Иван Иванович" required />
                              <Field label="Придумайте пароль" name="password" type="password" placeholder="не короче 4 символов" required />
                              <p className="text-xs text-muted-foreground -mt-2">
                                После регистрации администратор подтвердит заявку — только тогда вы сможете войти.
                              </p>
                              <SubmitBlock loading={loading} error={error}>Отправить заявку</SubmitBlock>
                            </form>
                          )}
                        </>
                      )}
                    </motion.div>
                  )}

                  {role === 'assistant' && (
                    <motion.div
                      key="assistant"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      <div className="flex gap-1 p-0.5 rounded-full bg-slate-100 border border-border/60 w-fit text-xs">
                        {(['login', 'register'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => { setAsmMode(m); setError('') }}
                            className={`px-4 py-1.5 rounded-full font-semibold transition-all ${
                              asmMode === m
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {m === 'login' ? 'Войти' : 'Регистрация'}
                          </button>
                        ))}
                      </div>

                      {asmMode === 'login' ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            const fd = new FormData(e.currentTarget)
                            loginAssistant(String(fd.get('identifier')))
                          }}
                          className="space-y-4"
                        >
                          <Field label="ID или ФИО / № кабинета" name="identifier" placeholder="NN-A4B7C2  или  Сидорова Анна" required />
                          <p className="text-xs text-muted-foreground -mt-2">
                            Войдите по уникальному ID или по ФИО/кабинету (если вы зарегистрированы в системе).
                          </p>
                          <SubmitBlock loading={loading} error={error}>Войти как ассистент</SubmitBlock>
                        </form>
                      ) : (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            const fd = new FormData(e.currentTarget)
                            registerAssistant(String(fd.get('full_name')))
                          }}
                          className="space-y-4"
                        >
                          <Field label="Ваше ФИО или № кабинета" name="full_name" placeholder="Сидорова Анна / Кабинет 12" required />
                          <p className="text-xs text-muted-foreground -mt-2">
                            Можно указать ФИО или номер кабинета. Уникальный ID сгенерируется автоматически и будет показан после регистрации.
                          </p>
                          <SubmitBlock loading={loading} error={error}>Зарегистрироваться</SubmitBlock>
                        </form>
                      )}
                    </motion.div>
                  )}

                  {role === 'admin' && (
                    <motion.form
                      key="admin"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={(e) => {
                        e.preventDefault()
                        const fd = new FormData(e.currentTarget)
                        loginAdmin(String(fd.get('username')), String(fd.get('password')))
                      }}
                      className="space-y-4"
                    >
                      <Field label="Логин" name="username" autoComplete="username" required />
                      <Field label="Пароль" name="password" type="password" autoComplete="current-password" required />
                      <SubmitBlock loading={loading} error={error}>Войти как админ</SubmitBlock>
                    </motion.form>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </Layout>
  )
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground tracking-wide">{label}</span>
      <Input {...props} className={`mt-2 ${props.mono ? 'font-mono uppercase tracking-wider' : ''}`} />
    </label>
  )
}

function SubmitBlock({ children, loading, error }: { children: React.ReactNode; loading: boolean; error?: string }) {
  return (
    <>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Отправляем…' : children}
      </Button>
      {error && <p className="text-sm text-rose-500">{error}</p>}
    </>
  )
}

function RegResult({ uid, copied, setCopied, onContinue }: { uid: string; copied: boolean; setCopied: (b: boolean) => void; onContinue: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md"
    >
      <Card>
        <CardContent className="text-center space-y-5">
          <div>
            <div className="w-14 h-14 rounded-full mx-auto mb-3 grid place-items-center bg-primary text-primary-foreground">
              <Check className="w-7 h-7" strokeWidth={3} />
            </div>
            <h2 className="text-xl font-bold text-foreground">Регистрация успешна</h2>
            <p className="text-sm text-muted-foreground mt-1">Сохраните ваш ID — он понадобится для входа</p>
          </div>

          <div className="relative overflow-hidden rounded-lg border border-teal-300 bg-teal-50 p-5">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent animate-shimmer pointer-events-none" />
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 mb-1">Ваш ID</p>
            <p className="font-mono font-bold text-2xl text-foreground tracking-wider">{uid}</p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={async () => {
                try { await navigator.clipboard.writeText(uid); setCopied(true); setTimeout(() => setCopied(false), 1500); toast.success('Скопировано') } catch { toast.error('Не удалось скопировать') }
              }}
            >
              {copied ? <><Check className="w-4 h-4" /> Скопировано</> : <><Copy className="w-4 h-4" /> Скопировать</>}
            </Button>
            <Button onClick={onContinue} className="flex-1">
              Войти в кабинет <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
