import { api } from './api'

// Единый источник правды «пользователь выключил уведомления».
// Без него авто-подписка на страницах врача/ассистента «воскрешала» бы push
// сразу после выключения колокольчиком.
const OFF_KEY = 'nn_push_off'

export function isPushOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false }
}
export function setPushOff(off: boolean) {
  try { localStorage.setItem(OFF_KEY, off ? '1' : '0') } catch { /* */ }
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}
// Запущено как установленный PWA (на iOS push работает ТОЛЬКО так, iOS 16.4+).
export function isStandalone(): boolean {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as any).standalone === true
  } catch { return false }
}
export function pushSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Подписать на web-push. Уважает флаг «выключено» (если не force).
// true — подписка реально создана/подтверждена на сервере.
export async function subscribePush(force = false): Promise<boolean> {
  try {
    if (!force && isPushOff()) return false
    if (!pushSupported() || Notification.permission !== 'granted') return false
    const reg = await navigator.serviceWorker.ready
    const vp = await api<{ public_key: string; enabled: boolean }>('GET', '/api/push/vapid-public')
    if (!vp.enabled || !vp.public_key) return false
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vp.public_key).buffer as ArrayBuffer,
      })
    }
    const j: any = sub.toJSON()
    await api('POST', '/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys })
    return true
  } catch {
    return false
  }
}

// Отписать: удалить запись на сервере + снять локальную подписку.
export async function unsubscribePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const endpoint = sub.endpoint
      try { await api('POST', '/api/push/unsubscribe', { endpoint }) } catch { /* */ }
      await sub.unsubscribe()
    }
  } catch { /* */ }
}

// Включены ли уведомления сейчас: не выключено + разрешение + активная подписка.
export async function pushIsOn(): Promise<boolean> {
  // «Включено» = пользователь не выключал + есть разрешение. Активную push-подписку
  // НЕ требуем: в десктоп-обёртке (QtWebEngine) PushManager нет, но Notification есть.
  if (isPushOff()) return false
  return 'Notification' in window && Notification.permission === 'granted'
}
