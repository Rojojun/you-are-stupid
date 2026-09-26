import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'ai-insights-scheduled-'))
const runScheduled = (date) => run(process.execPath, ['server/init-scheduled.mjs', '--date', date, '--storage', join(root, 'events.jsonl'), '--out-dir', join(root, date)], { cwd: new URL('..', import.meta.url).pathname })

const ordinary = await runScheduled('2026-09-23')
assert.match(ordinary.stdout, /no init addendum scheduled/)

await runScheduled('2026-09-21')
const weekly = await readFile(join(root, '2026-09-21', 'codex.addendum.md'), 'utf8')
assert.match(weekly, /주간 집계/)
assert.doesNotMatch(weekly, /월간 집계/)

await runScheduled('2026-10-01')
const monthly = await readFile(join(root, '2026-10-01', 'codex.addendum.md'), 'utf8')
assert.match(monthly, /월간 집계/)

await runScheduled('2026-06-01')
const combined = await readFile(join(root, '2026-06-01', 'codex.addendum.md'), 'utf8')
assert.match(combined, /주간 집계/)
assert.match(combined, /월간 집계/)
console.log('scheduled init tests passed')
