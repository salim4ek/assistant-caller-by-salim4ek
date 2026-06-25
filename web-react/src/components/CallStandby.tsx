// Индикатор «живого» ожидания вызова:
//  • полноширинная бегущая ЭКГ (~65 уд/мин);
//  • трубка в своём кружке-«окне» не звонит, а лениво качается и «вздыхает»
//    (персонаж, мучающийся от скуки);
//  • статус-бейдж.
// online=false → янтарный, медленнее. Учитывает prefers-reduced-motion.

// Тайл ЭКГ: 5 ударов на ширину 1000 (по одному каждые 200) → при прокрутке
// одного тайла за 4.4с получаем ~68 уд/мин.
const ECG = 'M0 40 H90 l7 -22 l7 44 l7 -22 H290 l7 -22 l7 44 l7 -22 H490 l7 -22 l7 44 l7 -22 H690 l7 -22 l7 44 l7 -22 H890 l7 -22 l7 44 l7 -22 H1000'

export function CallStandby({ online }: { online: boolean }) {
  const c = online ? '#0d9488' : '#d9912f'
  const tint = online ? 'rgba(13,148,136,0.10)' : 'rgba(217,145,47,0.12)'

  return (
    <div className="nn-cs" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, width: '100%' }}>
      <style>{`
        @keyframes nnCsEcg { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes nnCsBlink { 0%,100% { opacity:1 } 50% { opacity:.2 } }
        @keyframes nnBored {
          0%   { transform: rotate(-6deg) translateX(-2px) }
          18%  { transform: rotate(6deg)  translateX(2px) }
          32%  { transform: rotate(-4deg) translateX(-1px) }
          43%  { transform: rotate(0deg)  translateY(3px) scaleY(.92) }
          50%  { transform: rotate(0deg)  translateY(0)   scaleY(1) }
          68%  { transform: rotate(7deg)  translateX(2px) }
          84%  { transform: rotate(-3deg) translateX(-1px) }
          100% { transform: rotate(-6deg) translateX(-2px) }
        }
        @media (prefers-reduced-motion: reduce){ .nn-cs *{ animation:none !important } }
      `}</style>

      {/* трубка скучает в своём «окне» (не звонит) */}
      <div style={{ width: 96, height: 96, borderRadius: '50%', background: tint, display: 'grid', placeItems: 'center', boxShadow: `inset 0 0 0 1px ${c}33` }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transformOrigin: '50% 80%', animation: 'nnBored 6.5s ease-in-out infinite' }}>
          <path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
        </svg>
      </div>

      {/* ЭКГ на всю ширину, ~65 уд/мин */}
      <div style={{ width: '100%', height: 64, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)', maskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)' }}>
        <div style={{ display: 'flex', width: '200%', height: '100%', animation: `nnCsEcg ${online ? 4.4 : 6}s linear infinite` }}>
          {[0, 1].map((k) => (
            <svg key={k} viewBox="0 0 1000 80" preserveAspectRatio="none" style={{ flex: '0 0 50%', height: '100%', filter: `drop-shadow(0 0 3px ${c}55)` }}>
              <path d={ECG} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ))}
        </div>
      </div>

      {/* статус-бейдж */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, color: c, background: tint, boxShadow: `inset 0 0 0 1px ${c}33` }}>
        <i style={{ width: 8, height: 8, borderRadius: '50%', background: c, animation: 'nnCsBlink 1.4s ease-in-out infinite' }} />
        {online ? 'В сети · ждём вызова' : 'Переподключение…'}
      </span>
    </div>
  )
}
