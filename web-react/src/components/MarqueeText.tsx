import { useEffect, useRef } from 'react'

// Бегущая строка для длинных имён: если текст не влезает в контейнер — плавно
// прокручивается (туда-обратно с паузами), если влезает — стоит на месте.
// Использует Web Animations API (поддерживается в т.ч. iOS Safari). Заодно
// показывает полный текст в title (подсказка при наведении).
export function MarqueeText({ text, className = '' }: { text: string; className?: string }) {
  const wrap = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const w = wrap.current
    const i = inner.current
    if (!w || !i) return
    let anim: Animation | null = null
    const measure = () => {
      if (anim) { anim.cancel(); anim = null }
      const diff = Math.ceil(i.scrollWidth - w.clientWidth)
      if (diff > 4 && typeof i.animate === 'function') {
        anim = i.animate(
          [
            { transform: 'translateX(0)', offset: 0 },
            { transform: 'translateX(0)', offset: 0.15 },
            { transform: `translateX(${-diff}px)`, offset: 0.5 },
            { transform: `translateX(${-diff}px)`, offset: 0.65 },
            { transform: 'translateX(0)', offset: 1 },
          ],
          { duration: Math.max(5000, diff * 80), iterations: Infinity, easing: 'linear' },
        )
      }
    }
    measure()
    let ro: ResizeObserver | null = null
    if ('ResizeObserver' in window) { ro = new ResizeObserver(measure); ro.observe(w) }
    return () => { if (anim) anim.cancel(); if (ro) ro.disconnect() }
  }, [text])

  return (
    <span ref={wrap} className={`block overflow-hidden ${className}`} title={text}>
      <span ref={inner} className="inline-block whitespace-nowrap will-change-transform">{text}</span>
    </span>
  )
}
