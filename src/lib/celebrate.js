// Dependency-free confetti burst. Spawns short-lived particles from the
// centre of the screen, animates them outward + down via the Web Animations
// API, then cleans up. Honours prefers-reduced-motion.

const COLORS = ['#185FA5', '#FFD23F', '#3B6D11', '#A32D2D', '#534AB7', '#0F6E56', '#EF9F27']

export function celebrate() {
  if (typeof document === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const container = document.createElement('div')
  container.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden'
  document.body.appendChild(container)

  const count = 90
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    const w = 6 + Math.random() * 7
    const h = w * (0.45 + Math.random() * 0.4)
    p.style.cssText =
      `position:absolute;top:42%;left:50%;width:${w}px;height:${h}px;` +
      `background:${COLORS[i % COLORS.length]};` +
      `border-radius:${Math.random() < 0.4 ? '50%' : '1px'};will-change:transform,opacity`
    container.appendChild(p)

    const angle = Math.random() * Math.PI * 2
    const dist = 110 + Math.random() * 280
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 140 // bias the launch upward
    const rot = Math.random() * 720 - 360

    p.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 340}px)) rotate(${rot * 1.4}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 700, easing: 'cubic-bezier(0.15,0.6,0.4,1)', fill: 'forwards' }
    )
  }

  setTimeout(() => container.remove(), 2000)
}
