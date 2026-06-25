// NN+ Ассистент-Вызов — минимальный service worker.
// Нужен для установки приложения (PWA) и показа уведомлений из вкладки.
// БЕЗ офлайн-кэша: приложение работает в реальном времени (API + WebSocket),
// поэтому всё всегда идёт в сеть — так не бывает «залипшего» старого бандла.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Наличие fetch-обработчика требуется браузером для установки PWA.
// Просто проксируем в сеть (поведение по умолчанию).
self.addEventListener('fetch', () => {})

// Web Push: уведомление о вызове даже когда приложение закрыто или свёрнуто (в трее).
// Если приложение УЖЕ открыто (есть окно) — пропускаем, чтобы не было дубля с
// уведомлением из самого приложения.
self.addEventListener('push', (event) => {
  let data = { title: 'Вызов', body: 'Вас вызывает врач', url: '/assistant' }
  try { if (event.data) data = Object.assign(data, event.data.json()) } catch (e) { /* */ }
  event.waitUntil((async () => {
    const ua = (self.navigator && self.navigator.userAgent) || ''
    const isIOS = /iphone|ipad|ipod/i.test(ua)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const focused = wins.some((c) => c.focused === true || c.visibilityState === 'visible')
    // iOS требует показывать уведомление на КАЖДЫЙ push — иначе Apple урезает доставку.
    // Поэтому на iOS показываем всегда. На Android/десктопе пропускаем, только если окно
    // активно на экране (там вызов и так виден внутри приложения и звучит свой звук).
    if (focused && !isIOS) return
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'nn-call',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: { url: data.url || '/assistant' },
    })
  })())
})

// Клик по системному уведомлению — фокус/открытие вкладки приложения.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/assistant'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate && c.navigate(url); return c.focus() }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
