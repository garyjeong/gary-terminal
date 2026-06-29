#!/usr/bin/env node
// gary-terminal 전역 실행 진입점.
// `npm link`로 전역 `gt` 명령에 연결되며, 호출한 디렉토리(process.cwd())를
// 그대로 사용한다 — 즉 `claude`처럼 "지금 있는 폴더"에서 세션이 돈다.
// tsx 런타임으로 TS 소스를 직접 실행하므로 별도 빌드가 필요 없다.
import { tsImport } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
await tsImport(join(here, '../src/index.tsx'), import.meta.url);
