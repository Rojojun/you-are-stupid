import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'ai-insights-'))
await writeFile(join(root, 'events.jsonl'), `${JSON.stringify({ eventId: 'e', workspaceId: 'w', conversationId: 'c', source: 'codex', role: 'user', occurredAt: '2026-09-21T01:00:00.000Z', redactedText: '구현해줘', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly' })}\n${JSON.stringify({ eventId: 'e2', workspaceId: 'w', conversationId: 'c', source: 'codex', role: 'user', occurredAt: '2026-09-21T02:00:00.000Z', redactedText: '구현해줘', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly' })}\n`)
await run(process.execPath, ['server/init-update.mjs', '--period', 'combined', '--date', '2026-09-21', '--storage', join(root, 'events.jsonl'), '--out-dir', join(root, 'out')], { cwd: new URL('..', import.meta.url).pathname })
const output = await readFile(join(root, 'out', 'codex.addendum.md'), 'utf8')
assert.match(output, /주간 집계/)
assert.match(output, /월간 집계/)
assert.match(output, /기존 init\/MD 내용을 대체하지 않는/)
assert.match(output, /질문 작성 형식/)
console.log('init update tests passed')
