// ── Mode types ─────────────────────────────────────────────────────────────────
/** Overlay modes that sit on top of the base key routing. */
export type KeyMode = 'cheatsheet' | 'resume' | 'slash';

// ── Context-based key binding map ──────────────────────────────────────────────
export type KeyContext =
  | 'global'
  | 'select'
  | 'active-input'
  | 'active-agents'
  | 'active-reference'
  | 'active-conversation'
  | 'overlay-slash'
  | 'overlay-resume'
  | 'overlay-cheatsheet';

export interface ContextKeyEntry {
  key: string;
  desc: string;
  action: string;
}

/**
 * Structured key binding map by context.
 * - "global"          : always active when no overlay is open (base mode)
 * - "select"          : focusMode === 'select'
 * - "active-*"        : focusMode === 'active', focusRegion matches suffix
 * - "overlay-*"       : modeStack top === matching KeyMode
 *
 * CheatSheet and test scripts read from this map.
 */
export const KEYMAP_CONTEXTS: Record<KeyContext, ContextKeyEntry[]> = {
  global: [
    { key: 'q / Ctrl+C',  desc: '종료',                action: 'quit' },
    { key: 'Ctrl+N',      desc: '새 세션 생성',         action: 'newSession' },
    { key: 'Ctrl+W',      desc: '현재 세션 닫기',        action: 'closeSession' },
    { key: 'Ctrl+R',      desc: '모니터링 새로고침',     action: 'refresh' },
    { key: 'Ctrl+O',      desc: '세션 재개 (resume)',   action: 'openResume' },
    { key: 'Ctrl+F',      desc: '에이전트 필터 순환',    action: 'cycleFilter' },
    { key: '?',           desc: '단축키 도움말',         action: 'cheatsheet' },
  ],
  select: [
    { key: '↑↓ / ←→',   desc: '패널 이동',            action: 'movePanel' },
    { key: 'Enter',       desc: '패널 진입',            action: 'enterPanel' },
  ],
  'active-input': [
    { key: 'Enter',       desc: '메시지 전송',           action: 'send' },
    { key: '/',           desc: '슬래시 자동완성 팝업',   action: 'slash' },
    { key: 'Esc',         desc: '패널 나가기',           action: 'exitPanel' },
    { key: '↑↓ (입력창)', desc: '패널 이동',            action: 'movePanelFromInput' },
  ],
  'active-agents': [
    { key: '↑↓',         desc: '에이전트 전환',         action: 'switchAgent' },
    { key: 'Ctrl+F',     desc: '필터 순환 (전체/활성/대기중)', action: 'cycleFilter' },
    { key: 'Esc',         desc: '패널 나가기',           action: 'exitPanel' },
  ],
  'active-reference': [
    { key: '↑↓',         desc: '참조 섹션 이동',        action: 'moveSection' },
    { key: 'Space',       desc: '섹션 펼침/접기',        action: 'toggleSection' },
    { key: 'Esc',         desc: '패널 나가기',           action: 'exitPanel' },
  ],
  'active-conversation': [
    { key: '↑↓',         desc: '대화 스크롤',           action: 'scroll' },
    { key: 'PgUp / Ctrl+U', desc: '대화 위로 스크롤',   action: 'scrollUp' },
    { key: 'PgDn / Ctrl+D', desc: '대화 아래로 스크롤', action: 'scrollDown' },
    { key: 'Esc',         desc: '패널 나가기',           action: 'exitPanel' },
  ],
  'overlay-slash': [
    { key: '↑↓',         desc: '항목 이동',             action: 'navigate' },
    { key: 'Tab / Enter', desc: '명령어 선택',           action: 'select' },
    { key: 'Esc',         desc: '팝업 닫기',             action: 'close' },
  ],
  'overlay-resume': [
    { key: '↑↓',         desc: '세션 이동',             action: 'navigate' },
    { key: 'Enter',       desc: '세션 재개',             action: 'resume' },
    { key: 'Esc',         desc: '닫기',                  action: 'close' },
  ],
  'overlay-cheatsheet': [
    { key: '? / Esc',    desc: '닫기',                  action: 'close' },
  ],
};

// ── Legacy constant (used by App.tsx for action names) ─────────────────────────
export const KEYMAP = {
  referenceToggle: ' ',
  cheatSheet: '?',
  quit: 'q',
  newSession: 'ctrl+n',
  closeSession: 'ctrl+w',
  resumeSession: 'ctrl+o',
} as const;

// ── Flat display list for CheatSheet (order = display order) ──────────────────
export const CHEATSHEET_ENTRIES = [
  { key: '↑↓ (선택 모드)',    desc: '패널 이동' },
  { key: 'Enter (선택 모드)', desc: '패널 진입' },
  { key: 'Esc (활성 모드)',   desc: '패널 나가기' },
  { key: '↑↓ (에이전트)',    desc: '에이전트 전환' },
  { key: 'Ctrl+F',            desc: '에이전트 필터 순환 (전체/활성/대기중)' },
  { key: '↑↓ (참조)',        desc: '참조 섹션 이동' },
  { key: 'Space (참조)',      desc: '섹션 펼침/접기' },
  { key: '↑↓ (대화)',        desc: '대화 스크롤' },
  { key: 'PgUp / Ctrl+U',    desc: '대화 위로 스크롤' },
  { key: 'PgDn / Ctrl+D',    desc: '대화 아래로 스크롤' },
  { key: 'Ctrl+N',            desc: '새 세션 생성' },
  { key: 'Ctrl+O',            desc: '세션 재개 (resume)' },
  { key: 'Ctrl+W',            desc: '현재 세션 닫기' },
  { key: '?',                 desc: '단축키 도움말' },
  { key: 'q / Ctrl+C',       desc: '종료' },
  { key: 'Enter (입력창)',    desc: '메시지 전송' },
  { key: '/ (입력창)',        desc: '슬래시 자동완성 팝업' },
  { key: '↑↓ (팝업)',        desc: '항목 이동' },
  { key: 'Tab / Enter (팝업)', desc: '명령어 선택' },
  { key: 'Esc (팝업)',        desc: '팝업 닫기' },
];
