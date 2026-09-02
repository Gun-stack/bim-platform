/** 다크 관제실 팔레트 — 모든 화면·3D·지도가 이 표 하나를 쓴다. index.css 의 :root 변수는 첫 페인트·서드파티 CSS 용 사본(theme.test.ts 가 일치 검사).
 *  규칙: 색은 뜻(상태·팀)에만, 인터랙션은 accent 하나, 정상·중립은 ink. 채움(accent/crit/warn/ok 배경) 위 글자는 bg.base — ink.1 은 대비가 안 나온다. */
export const T = {
  bg: { base: '#121417', surface: '#1a1d22', raised: '#23272e', line: '#2f343c' },
  ink: { 1: '#e6e8eb', 2: '#a3a9b3', 3: '#7c8390' },   // 1 본문·제목, 2 보조(라벨·시각), 3 힌트·비활성·플레이스홀더만 (대비 4.4 — 본문 금지)
  accent: '#7aa2f7', accentSoft: 'rgba(122,162,247,0.16)',
  ok: '#5cb87a', warn: '#e0a84a', crit: '#e5675f',
  okSoft: 'rgba(92,184,122,0.14)', warnSoft: 'rgba(224,168,74,0.14)', critSoft: 'rgba(229,103,95,0.16)',
  team: { fire: '#d46a62', trans: '#a39a91', mech: '#6a9ad9', comm: '#9591dd', elec: '#d1a54a' },
  axis: { x: '#d46a62', y: '#7fb069', z: '#6a9ad9' },   // 3D 축 기즈모·단면 슬라이더 공용
  radius: 6, pill: 999,
  fs: { xs: 11, sm: 12, md: 13, lg: 15, xl: 18 },
  fw: { normal: 400, bold: 600 },
  shadow: '0 8px 24px rgba(0,0,0,0.45)',   // 플로팅(툴바·메뉴·토스트·모달·독)만. 흐름 안 카드는 1px line
} as const
/** three.js 용 숫자색 */
export const num = (hex: string) => parseInt(hex.slice(1), 16)
