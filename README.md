# gary-terminal

로컬에서 완전히 도는 **코딩 에이전트 TUI**. Python 엔진이 Ollama의 로컬 모델과 대화하고,
Textual TUI가 화면을 담당한다. 토큰 비용 0, 오프라인 동작.

## 구조
- `gary_terminal/engine` — 모델/에이전트 (Ollama 연결, 대화 루프). UI와 분리돼 있어
  나중에 이 계층만 HTTP/WS 서버로 빼면 client/server 구조로 확장된다.
- `gary_terminal/tui` — Textual 기반 화면.

## 요구사항
- Python >= 3.11, uv, Ollama (모델 1개 이상 pull)

## 설치 / 실행
    uv sync
    uv run gt            # 또는: uv run python -m gary_terminal

## 설정 (환경변수)
- `GT_OLLAMA_HOST` (기본 `http://localhost:11434`)
- `GT_MODEL` (기본 `qwen2.5-coder:7b`)

## TUI 명령
- `/help` · `/models` · `/model <name>` · `/clear` · `/quit`
- 단축키: `Ctrl+L` 초기화 · `Esc` 생성 중단 · `Ctrl+C` 종료

## 스모크 테스트 (TUI 없이 엔진만)
    uv run python scripts/smoke_engine.py "1+1은?"
