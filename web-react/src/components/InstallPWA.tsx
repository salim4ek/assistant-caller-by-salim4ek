import { useEffect, useState } from 'react'
import { Download, Monitor, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'

const WIN_DOWNLOAD = '/download/NN_Vyzov.zip'

// Кнопка «Приложение» → мини-окно выбора: Windows (обёртка-.exe) или телефон (PWA).
export function InstallPWA() {
  const [deferred, setDeferred] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    if (standalone) setInstalled(true)
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => { setInstalled(true); setDeferred(null); toast.success('Приложение установлено') }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Уже запущено как установленное приложение — кнопка не нужна.
  if (installed) return null

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

  function installPhone() {
    setOpen(false)
    if (deferred) {
      deferred.prompt()
      try { deferred.userChoice.finally(() => setDeferred(null)) } catch { /* */ }
    } else if (isIos) {
      const inApp = /Telegram|FBAN|FBAV|Instagram|Line|MicroMessenger|VKClient/i.test(navigator.userAgent)
      toast(inApp ? 'Сначала откройте в Safari' : 'Установка на iPhone (Safari)', {
        description: inApp
          ? 'Нажмите «•••» → «Открыть в Safari», затем «Поделиться» ↑ → пролистайте вниз → «На экран «Домой»».'
          : 'Внизу нажмите «Поделиться» ↑ → пролистайте список ВНИЗ → «На экран «Домой»».',
        duration: 11000,
      })
    } else {
      toast('Установка из браузера', {
        description: 'Нажмите значок установки ⊕ в адресной строке, либо меню браузера → «Установить приложение».',
        duration: 8000,
      })
    }
  }

  function downloadWin() {
    setOpen(false)
    window.location.href = WIN_DOWNLOAD
    toast('Скачивание приложения для Windows', {
      description: 'Распакуйте архив и запустите NN_Vyzov.exe. Инструкция — на странице «Установка и автозапуск».',
      duration: 10000,
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Скачать приложение"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold
                   border border-teal-300 text-teal-700 hover:bg-teal-50 transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Приложение</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 backdrop-blur-md p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 relative">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold mb-1">Скачать приложение</h2>
            <p className="text-xs text-muted-foreground mb-5">Выберите устройство</p>
            <button onClick={downloadWin} className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-slate-50 hover:border-teal-400 transition-colors mb-3 text-left">
              <Monitor className="w-6 h-6 text-teal-600 shrink-0" />
              <div>
                <p className="font-semibold">Windows (ПК)</p>
                <p className="text-xs text-muted-foreground">Приложение в трее, всплывает поверх окон при вызове</p>
              </div>
            </button>
            <button onClick={installPhone} className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-slate-50 hover:border-teal-400 transition-colors text-left">
              <Smartphone className="w-6 h-6 text-teal-600 shrink-0" />
              <div>
                <p className="font-semibold">Android / iPhone</p>
                <p className="text-xs text-muted-foreground">Установить как приложение на телефон</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
