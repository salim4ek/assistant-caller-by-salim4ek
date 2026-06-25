import { useEffect, useRef, useState } from 'react'
import { getToken, clearAndRedirect } from './api'

export type WsEnvelope = { type: string; payload?: any }

export function useWebSocket(onMessage: (env: WsEnvelope) => void) {
  const [state, setState] = useState<'connecting' | 'open' | 'closed' | 'reconnecting' | 'no-token'>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    let stopped = false
    let backoff = 1000
    const maxBackoff = 10_000
    let pingTimer: number | undefined
    let reconnectTimer: number | undefined

    function clearPing() {
      if (pingTimer !== undefined) { window.clearInterval(pingTimer); pingTimer = undefined }
    }

    function connect() {
      if (stopped) return
      if (reconnectTimer !== undefined) { window.clearTimeout(reconnectTimer); reconnectTimer = undefined }
      // не плодим параллельные соединения
      const rs = wsRef.current?.readyState
      if (rs === 0 || rs === 1) return
      const token = getToken()
      if (!token) { setState('no-token'); return }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`
      setState('connecting')
      let ws: WebSocket
      try { ws = new WebSocket(url) } catch { scheduleReconnect(); return }
      wsRef.current = ws
      ws.onopen = () => {
        backoff = 1000
        setState('open')
        // Клиентский keepalive: пинг каждые 20с, чтобы прокси/edge не убивали
        // простаивающее WS-соединение (это и была причина «соединение потеряно»).
        clearPing()
        pingTimer = window.setInterval(() => {
          if (ws.readyState === 1) { try { ws.send(JSON.stringify({ type: 'ping' })) } catch { /* */ } }
        }, 20_000)
      }
      ws.onmessage = (ev) => {
        try {
          const env = JSON.parse(ev.data)
          if (env && typeof env === 'object' && env.type && env.type !== 'pong') onMessageRef.current(env)
        } catch { /* ignore */ }
      }
      ws.onerror = () => { /* onclose will follow */ }
      ws.onclose = (ev) => {
        clearPing()
        // 4401/4403 means server explicitly rejected auth. Just stop reconnecting.
        // Do NOT redirect — user stays on their page until they click Logout.
        if (ev.code === 4401 || ev.code === 4403) {
          setState('closed')
          stopped = true
          return
        }
        if (!stopped) scheduleReconnect()
      }
    }

    function scheduleReconnect() {
      setState('reconnecting')
      const delay = backoff
      backoff = Math.min(backoff * 2, maxBackoff)
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(connect, delay)
    }

    // Мгновенный реконнект при возврате на вкладку / восстановлении сети
    function kick() {
      if (stopped || document.visibilityState !== 'visible') return
      const rs = wsRef.current?.readyState
      if (rs === undefined || rs === 2 || rs === 3) { backoff = 1000; connect() }
    }
    document.addEventListener('visibilitychange', kick)
    window.addEventListener('online', kick)

    connect()
    return () => {
      stopped = true
      clearPing()
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', kick)
      window.removeEventListener('online', kick)
      if (wsRef.current) try { wsRef.current.close() } catch { /* ignore */ }
    }
  }, [])

  function send(type: string, payload?: any) {
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1) return false
    const env: WsEnvelope = { type, payload }
    ws.send(JSON.stringify(env))
    return true
  }

  return { state, send }
}
