import { useEffect, useRef } from 'react'

// Фон приложения:
//  • постоянные мягкие teal-шары по рамке окна (всегда видны, не зависят от курсора);
//  • медленно плавающие медицинские атрибуты — каждый привязан к своей точке,
//    тянется к курсору при приближении, но НЕ может уйти далеко (пружинит назад).
// Учитывает prefers-reduced-motion (статичная мягкая раскладка, без слежки).

type GType = 'cross' | 'pulse' | 'heart' | 'pluscircle' | 'capsule' | 'beaker'
interface Glyph { type: GType; x: number; y: number; size: number; spd: number; ph: number; amp: number }

const GLYPHS: Glyph[] = [
  { type: 'cross',      x: 0.08, y: 0.18, size: 46, spd: 0.5, ph: 0.0, amp: 12 },
  { type: 'pulse',      x: 0.24, y: 0.70, size: 52, spd: 0.7, ph: 1.1, amp: 14 },
  { type: 'heart',      x: 0.40, y: 0.30, size: 34, spd: 0.6, ph: 2.0, amp: 10 },
  { type: 'pluscircle', x: 0.58, y: 0.78, size: 40, spd: 0.55, ph: 0.7, amp: 12 },
  { type: 'capsule',    x: 0.74, y: 0.22, size: 38, spd: 0.65, ph: 3.0, amp: 11 },
  { type: 'beaker',     x: 0.88, y: 0.60, size: 40, spd: 0.5, ph: 1.6, amp: 12 },
  { type: 'pulse',      x: 0.15, y: 0.48, size: 34, spd: 0.6, ph: 2.5, amp: 9 },
  { type: 'cross',      x: 0.66, y: 0.50, size: 30, spd: 0.7, ph: 0.3, amp: 9 },
  { type: 'heart',      x: 0.91, y: 0.36, size: 28, spd: 0.6, ph: 1.9, amp: 8 },
]

function GlyphSvg({ type, size }: { type: GType; size: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: '#0d9488', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (type) {
    case 'cross': return <svg {...common} fill="#0d9488" stroke="none"><path d="M10 2h4v6h6v4h-6v6h-4v-6H4V8h6V2z" /></svg>
    case 'pulse': return <svg {...common}><path d="M2 12h4l2-7 4 14 2-7h8" /></svg>
    case 'heart': return <svg {...common} fill="#0d9488" stroke="none"><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" /></svg>
    case 'pluscircle': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
    case 'capsule': return <svg {...common}><path d="M7 13 13 7a4 4 0 0 1 6 6l-6 6a4 4 0 0 1-6-6z" /><path d="M9.5 9.5 14.5 14.5" /></svg>
    case 'beaker': return <svg {...common}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M7.5 15h9" /></svg>
  }
}

export function CursorOrbs() {
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-glyph]'))
    if (nodes.length === 0) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // учёт CSS-zoom корня (на ПК 125%), иначе координаты глифов/курсора «уедут»
    const Z = () => parseFloat((getComputedStyle(document.documentElement) as any).zoom) || 1
    let W = window.innerWidth / Z()
    let H = window.innerHeight / Z()
    const cur = GLYPHS.map(() => ({ x: 0, y: 0 }))

    const place = (i: number, ox: number, oy: number) => {
      const g = GLYPHS[i]
      const hx = g.x * W
      const hy = g.y * H
      nodes[i].style.transform = `translate3d(${hx + ox - g.size / 2}px, ${hy + oy - g.size / 2}px, 0)`
    }

    const onResize = () => { W = window.innerWidth / Z(); H = window.innerHeight / Z() }
    window.addEventListener('resize', onResize)

    if (reduce) {
      GLYPHS.forEach((_, i) => place(i, 0, 0))
      window.removeEventListener('resize', onResize)
      return
    }

    let mx = -9999, my = -9999
    const onMove = (e: PointerEvent) => { mx = e.clientX / Z(); my = e.clientY / Z() }
    window.addEventListener('pointermove', onMove, { passive: true })

    const R = 240          // радиус, в котором курсор «притягивает»
    const MAXPULL = 38     // максимальный отрыв от своей точки (px) — дальше нельзя
    let raf = 0, t = 0
    const loop = () => {
      t += 0.006
      for (let i = 0; i < GLYPHS.length; i++) {
        const g = GLYPHS[i]
        const hx = g.x * W, hy = g.y * H
        // лёгкий собственный дрейф
        const fx = Math.sin(t * g.spd + g.ph) * g.amp
        const fy = Math.cos(t * g.spd * 0.9 + g.ph) * g.amp
        // притяжение к курсору, ограниченное MAXPULL (привязка к точке)
        let px = 0, py = 0
        const dx = mx - hx, dy = my - hy
        const dist = Math.hypot(dx, dy)
        if (dist < R && dist > 0.001) {
          const f = 1 - dist / R
          const s = f * f * MAXPULL
          px = (dx / dist) * s
          py = (dy / dist) * s
        }
        const tx = fx + px, ty = fy + py
        cur[i].x += (tx - cur[i].x) * 0.15
        cur[i].y += (ty - cur[i].y) * 0.15
        place(i, cur[i].x, cur[i].y)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div ref={wrap} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <style>{`
        @keyframes nnFrameDrift { 0%{transform:translate(0,0) scale(1)} 100%{transform:translate(3%,2%) scale(1.06)} }
        @media (prefers-reduced-motion: reduce){ .nn-frame-orb{animation:none!important} }
      `}</style>

      {/* постоянные шары по рамке окна */}
      <div className="nn-frame-orb" style={{ position: 'absolute', top: -180, left: -180, width: 580, height: 580, borderRadius: '50%', background: 'radial-gradient(circle at 38% 38%, rgba(13,148,136,0.46), rgba(13,148,136,0) 70%)', filter: 'blur(42px)', animation: 'nnFrameDrift 16s ease-in-out infinite alternate' }} />
      <div className="nn-frame-orb" style={{ position: 'absolute', bottom: -200, right: -160, width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(20,184,166,0.30), rgba(20,184,166,0) 70%)', filter: 'blur(48px)', animation: 'nnFrameDrift 22s ease-in-out infinite alternate-reverse' }} />
      <div className="nn-frame-orb" style={{ position: 'absolute', top: '8%', right: -120, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(45,212,191,0.20), rgba(45,212,191,0) 70%)', filter: 'blur(46px)', animation: 'nnFrameDrift 19s ease-in-out infinite alternate' }} />

      {/* плавающие медицинские атрибуты (привязаны к точкам, тянутся к курсору) */}
      {GLYPHS.map((g, i) => (
        <div key={i} data-glyph style={{ position: 'absolute', top: 0, left: 0, opacity: 0.14, willChange: 'transform' }}>
          <GlyphSvg type={g.type} size={g.size} />
        </div>
      ))}
    </div>
  )
}
