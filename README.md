# gary-terminal

로컬/구독 모델로 도는 **코딩 에이전트 TUI**. Python 엔진 + Textual TUI.

## 백엔드
- **ollama** (로컬, 기본) — 완전 오프라인·무료. 기본 모델 `qwen2.5-coder:7b`
- **claude** (구독) — 로컬 `claude` CLI를 헤드리스로 구동해 **구독 인증을 그대로 상속**
  전환: `/model claude [sonnet|opus|haiku]` · 되돌리기 `/model ollama`

## 기능
- 툴콜 루프 — `read_file`·`list_dir`(자동) / `write_file`·`run_shell`(승인 게이트)
- 코드 도구 — `search_code`(grep) · `run_tests`(승인) · `diagnostics`(린터/타입체크)
- 에이전트 — 자동 에스컬레이션(로컬 실패→Claude) · `spawn_agents`(병렬 서브에이전트, 진행 표시·쓰기위임 옵션) · `update_plan`(계획/TODO)
- 의미검색(RAG) — `/index`로 색인 후 `codebase_search`(nomic-embed-text). 캐시는 `~/.cache/gary-terminal/index/`
- MCP — `~/.config/gary-terminal/mcp.json` 서버 연결(예: Obsidian). 읽기 자동·쓰기 승인
- 마크다운/코드 syntax 렌더링
- 코드베이스 인식 — `AGENTS.md` 자동 로드 + `@파일` 첨부
- 세션 저장/재개(턴마다 자동 저장) · `Tab` 자동완성
- 사용량 추적(토큰·환산비용) · 자동 컨텍스트 압축(요약)

## 구조
- `gary_terminal/engine/` — 백엔드(`backend.py`: ollama/claude)·에이전트 루프·도구·MCP·세션·사용량·컨텍스트
- `gary_terminal/tui/` — Textual 화면(`app.py`, `styles.tcss`), 자동완성

## 요구사항
- Python ≥ 3.11, uv, Ollama(로컬 모델), (선택) 로그인된 `claude` CLI

## 실행
    uv sync
    uv run gt

## 전역 설치 (어디서든 `gt`)
    uv tool install .          # ~/.local/bin/gt 설치
    gt                         # 아무 폴더에서 실행
코드 변경 후 갱신: `uv tool install . --force` · 제거: `uv tool uninstall gary-terminal`

## 설정 (환경변수)
- `GT_MODEL` (기본 `qwen2.5-coder:7b`) · `GT_OLLAMA_HOST` · `GT_CLAUDE_MODEL` (기본 `sonnet`) · `GT_CONTEXT_LIMIT` (기본 8000)

## 명령 (`/help`)
`/model` `/models` `/theme` `/usage` `/compact` `/reload` `/index` `/save` `/sessions` `/resume` `/search` `/copy` `/auto` `/plan` `/clear` `/quit`
단축키: `Enter` 전송 · `Shift+Enter`/`Ctrl+J` 줄바꿈 · `Tab` 완성 · `위/아래` 히스토리 · `Ctrl+R` 검색 · `Ctrl+L` 다시그리기 · `Esc` 중단 · `Ctrl+C`/`Ctrl+D` 종료

## MCP 설정 예시 (`~/.config/gary-terminal/mcp.json`)
    {
      "servers": [
        {"name": "obsidian", "url": "http://127.0.0.1:27200/mcp",
         "headers": {"Authorization": "Bearer <token>"},
         "tools": ["get_vault_file", "search_vault_simple", "list_vault_files"]}
      ]
    }
`tools` 는 선택(allowlist) — 생략 시 서버의 모든 도구 등록(작은 모델은 과부하 주의).

## 설정 파일
`~/.config/gary-terminal/config.toml` 로 기본값 지정(예제: `examples/config.toml`).
환경변수 `GT_*` 가 파일보다 우선.

## 테마
내장: `gary-dark` · `gary-light` · `gary-mono`. 앱에서 `/theme <이름>` 으로 전환.
커스텀: `examples/theme.toml` 을 `~/.config/gary-terminal/themes/<이름>.toml` 로 복사·편집(파일명=테마명).

## 의미검색(RAG)
임베딩 모델 준비: `ollama pull nomic-embed-text`. 앱에서 `/index`로 코드베이스 색인(증분) 후,
모델이 `codebase_search`로 의미 기반 검색. 한글 질의는 문서에, 코드 식별자 검색은 영어 질의가 유리
(다국어 강화가 필요하면 `embed_model = "bge-m3"`).
