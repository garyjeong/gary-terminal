# gary-terminal

개인용 **AI 오케스트레이터 조종석** TUI. 로컬 `claude` 바이너리를 headless로 구동해
(구독 인증 그대로) 여러 세션·codex·서브에이전트를 한 화면에서 띄우고 모니터링한다.

- 좌측: 모니터 4분할 (에이전트 / 시스템 / 사용량·작업 / 참조[Skills·MCP·Codex])
- 우측: 대화(메인) + 입력
- 스택: TypeScript + ink, 상태 zustand, 프로세스 execa

## 실행

### 개발 모드
```bash
pnpm install
pnpm dev
```

### 전역 명령 `gt` (어디서든 실행)
```bash
npm link        # 1회: 전역 명령 등록 (이 디렉토리에 심볼릭 연결)
gt              # 이후 아무 폴더에서나 실행 — 그 폴더 기준으로 세션이 돈다 (claude 동일)
```
- `npm link`는 이 프로젝트 디렉토리를 전역 `gt`(`/opt/homebrew/bin/gt`)에 연결한다. **프로젝트를 옮기면 다시 `npm link` 필요.**
- tsx 런타임으로 소스를 직접 실행하므로 빌드 불필요(항상 최신 소스). 시작이 더 빨라야 하면 추후 컴파일 빌드로 전환 가능.
- 해제: `npm unlink -g gary-terminal`

## 단축키
- `Tab` 포커스 순환 · `↑↓` 에이전트 선택 · `Enter` 전송
- `Ctrl+N` 새 세션 · `Ctrl+W` 세션 닫기
- `Space` 참조 섹션 접기/펼치기 · `Ctrl+R` Skills/MCP/사용량 새로고침
- `PgUp/PgDn`(또는 `Ctrl+U/D`) 대화 스크롤 · `?` 치트시트 · `q`/`Ctrl+C` 종료

## 요구사항
- node ≥ 20, pnpm, `claude` CLI(구독 로그인 상태)
