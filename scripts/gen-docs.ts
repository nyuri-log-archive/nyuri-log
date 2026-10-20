// JSON仕様書を categories.ts の定義から生成する：npm run docs:json
import { writeFileSync } from 'node:fs';
import { buildJsonSpecMarkdown, buildAiPrompt } from '../src/lib/aiPrompt';

writeFileSync(new URL('../docs/json-import-spec.md', import.meta.url), buildJsonSpecMarkdown());
writeFileSync(new URL('../docs/ai-prompt.txt', import.meta.url), buildAiPrompt());
console.log('docs/json-import-spec.md と docs/ai-prompt.txt を更新しました');
