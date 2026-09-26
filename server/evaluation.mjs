import { readFile } from 'node:fs/promises'
import { analyzeEvents } from './analysis-engine.mjs'
import { ENGINE_VERSION } from './analysis-engine.mjs'

const cases = JSON.parse(await readFile(new URL('./evaluation-set.json', import.meta.url), 'utf8'))
const events = cases.map((item, index) => ({ schemaVersion: 1, eventId: `eval-${index}`, workspaceId: 'eval', conversationId: 'eval', source: 'codex', role: 'user', occurredAt: new Date(2026, 0, index + 1).toISOString(), redactedText: item.text, tokenUsage: { state: 'unavailable' }, provenance: 'user_import' }))
const results = analyzeEvents(events)
const correct = results.filter((result, index) => result.primaryKind === cases[index].expectedKind).length
const accuracy = Math.round(correct / cases.length * 100)
console.log(JSON.stringify({ engine: ENGINE_VERSION, cases: cases.length, correct, accuracy }, null, 2))
if (accuracy < 80) process.exitCode = 1
