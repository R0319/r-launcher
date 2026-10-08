// 最小限の線画アイコン（自作）。文字のラベルが主で、アイコンは添えるだけ。
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  'aria-hidden': true,
} as const

export const IconSettings = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
)

export const IconLog = () => (
  <svg {...base}>
    <path d="M3 2.5h7l3 3v8H3z" />
    <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
  </svg>
)

export const IconReload = () => (
  <svg {...base}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" />
    <path d="M13 2.5v3h-3" />
  </svg>
)

export const IconFolder = () => (
  <svg {...base}>
    <path d="M2 4h4l1.5 1.5H14v7.5H2z" />
  </svg>
)
