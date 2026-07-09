# gary-terminal — 프로젝트 컨텍스트

로컬에서 완전히 도는 코딩 에이전트 TUI. Python 엔진이 Ollama 로컬 모델과 대화하고,
Textual TUI가 화면을 담당한다.

## 구조
- `gary_terminal/engine/` — 모델/에이전트 (Ollama 연결, 툴콜 루프). UI와 분리.
  - `ollama_client.py` 스트리밍 · `agent.py` 대화+툴 루프 · `tools.py` 도구 · `context.py` 컨텍스트
- `gary_terminal/tui/` — Textual 화면 (`app.py`, `styles.tcss`).

## 규칙
- 응답은 간결하게, 코드 위주로.
- 파일/셸 도구를 활용해 먼저 확인한 뒤 답한다.
- 새 기능은 engine(로직)과 tui(표시)를 분리해 추가한다.
