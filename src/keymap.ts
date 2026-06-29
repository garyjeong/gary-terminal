// ── Mode types ─────────────────────────────────────────────────────────────────
/** Overlay modes that sit on top of the base key routing. */
export type KeyMode = 'cheatsheet' | 'resume' | 'slash' | 'file' | 'permission' | 'newsession' | 'copy' | 'bind';

// ── Context-based key binding map ──────────────────────────────────────────────
export type KeyContext =
  | 'global'
  | 'select'
  | 'active-input'
  | 'active-agents'
  | 'active-reference'
  | 'active-conversation'
  | 'overlay-slash'
  | 'overlay-file'
  | 'overlay-resume'
  | 'overlay-cheatsheet'
  | 'overlay-permission'
  | 'overlay-newsession'
  | 'overlay-copy'
  | 'overlay-bind';

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
    { key: 'Ctrl+X',      desc: '현재 턴 인터럽트 (실행 중)',  action: 'interrupt' },
    { key: 'Ctrl+Y',      desc: 'Copy mode (텍스트 선택/복사)', action: 'copyMode' },
    { key: 'Ctrl+B',      desc: '프로세스 바인딩',       action: 'bindProcess' },
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
    { key: 'Ctrl+U',              desc: '입력창 전체 지우기 (kill-line)',  action: 'clearLine' },
    { key: '↑ (비어있을 때)',     desc: '이전 메시지 히스토리',            action: 'historyUp' },
    { key: '↓ (히스토리 탐색 중)', desc: '다음 메시지 / 초안 복원',         action: 'historyDown' },
  ],
  'active-agents': [
    { key: '↑↓',         desc: '에이전트 전환',         action: 'switchAgent' },
    { key: 'Ctrl+F',     desc: '필터 순환 (전체/활성/대기중)', action: 'cycleFilter' },
    { key: 'Esc',         desc: '패널 나가기',           action: 'exitPanel' },
  ],
  'active-reference': [
    { key: '↑↓',         desc: '참조 섹션 이동',        action: 'moveSection' },
    { key: '→/←',        desc: '섹션 펼침/접음',        action: 'expandCollapseSection' },
    { key: 'Space',       desc: '섹션 펼침/접기 토글',   action: 'toggleSection' },
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
  'overlay-file': [
    { key: '↑↓',         desc: '파일 이동',             action: 'navigate' },
    { key: 'Tab / Enter', desc: '파일 선택',             action: 'select' },
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
  'overlay-permission': [
    { key: 'y',          desc: '승인 (allow)',           action: 'allow' },
    { key: 'n / Esc',   desc: '거부 (deny)',             action: 'deny' },
  ],
  'overlay-newsession': [
    { key: '↑↓',        desc: '모델/effort 행 이동',    action: 'moveRow' },
    { key: '←→',        desc: '옵션 변경',               action: 'cycleOption' },
    { key: 'Enter',     desc: '세션 생성',               action: 'spawn' },
    { key: 'Esc',       desc: '취소',                    action: 'close' },
  ],
  'overlay-copy': [
    { key: 'Ctrl+Y',    desc: 'Copy mode 종료 / 복귀',  action: 'exitCopyMode' },
  ],
  'overlay-bind': [
    { key: '↑↓',       desc: '프로세스 선택',           action: 'navigate' },
    { key: 'Enter',    desc: '바인딩 확정',              action: 'bind' },
    { key: 'Delete',   desc: '바인딩 제거',              action: 'unbind' },
    { key: 'Esc',      desc: '닫기',                    action: 'close' },
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
  { key: '→/← (참조)',       desc: '섹션 펼침/접음' },
  { key: 'Space (참조)',      desc: '섹션 펼침/접기 토글' },
  { key: '↑↓ (대화)',        desc: '대화 스크롤' },
  { key: 'PgUp / Ctrl+U',    desc: '대화 위로 스크롤' },
  { key: 'PgDn / Ctrl+D',    desc: '대화 아래로 스크롤' },
  { key: 'Ctrl+N',            desc: '새 세션 생성 (옵션 피커)' },
  { key: 'Ctrl+O',            desc: '세션 재개 (resume)' },
  { key: 'Ctrl+X (실행 중)', desc: '현재 턴 중단 (인터럽트)' },
  { key: 'Ctrl+W',            desc: '현재 세션 닫기' },
  { key: '?',                 desc: '단축키 도움말' },
  { key: 'q / Ctrl+C',       desc: '종료' },
  { key: 'Enter (입력창)',    desc: '메시지 전송' },
  { key: '/ (입력창)',        desc: '슬래시 자동완성 팝업' },
  { key: '↑↓ (팝업)',        desc: '항목 이동' },
  { key: 'Tab / Enter (팝업)', desc: '명령어 선택' },
  { key: 'Esc (팝업)',        desc: '팝업 닫기' },
  { key: 'Ctrl+Y',            desc: 'Copy mode 진입/복귀 (텍스트 선택)' },
  { key: 'Ctrl+B',            desc: '프로세스 바인딩 다이얼로그' },
  { key: 'Ctrl+U (입력창)',             desc: '입력창 전체 지우기 (kill-line)' },
  { key: '↑↓ (입력창 비어있을 때)',     desc: '명령 히스토리 탐색 (최근 50개)' },
];
