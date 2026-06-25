import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// Врачи не жмут F5, поэтому в кабинетах держим данные свежими сами:
//  • каждые 10с тихо рефетчим все данные (списки, онлайн-статусы, заявки) — без мигания;
//  • если задеплоена новая версия приложения — мягко перезагружаем страницу,
//    но ТОЛЬКО когда это безопасно (не идёт вызов/модалка и пользователь не печатает).
export function AutoRefresh() {
  const qc = useQueryClient()

  useEffect(() => {
    // какой бандл сейчас загружен (для детекта нового деплоя); в dev его нет — тогда пропускаем
    const loaded =
      Array.from(document.scripts)
        .map((s) => (s.src.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0])
        .find(Boolean) || null

    const safeToReload = () => {
      const ae = document.activeElement as HTMLElement | null
      const typing = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')
      const busy = (window as any).__nnBusy === true
      return !typing && !busy && document.visibilityState === 'visible'
    }

    const tick = async () => {
      // 1) свежие данные без перезагрузки
      qc.invalidateQueries()
      // 2) подхват новой версии после деплоя
      if (!loaded) return
      try {
        const html = await fetch('/?v=' + Date.now(), { cache: 'no-store' }).then((r) => r.text())
        const served = (html.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0]
        if (served && served !== loaded && safeToReload()) location.reload()
      } catch {
        /* офлайн / сеть — не важно, повторим через 10с */
      }
    }

    const id = window.setInterval(tick, 10000)
    return () => window.clearInterval(id)
  }, [qc])

  return null
}
