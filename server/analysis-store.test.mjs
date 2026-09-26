import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnalysisStore } from './analysis-store.mjs'

const root = await mkdtemp(join(tmpdir(), 'ai-usage-analysis-'))
const path = join(root, 'analysis.sqlite')
try {
  const first = new AnalysisStore(path)
  const classification = { eventId: 'event-1', engine: 'jev-latest', primaryKind: 'productive_work', clarityScore: 88 }
  assert.equal(first.get('workspace', 'event-1'), undefined)
  first.put('workspace', classification)
  assert.deepEqual(first.get('workspace', 'event-1'), classification)
  first.close()

  const reopened = new AnalysisStore(path)
  assert.equal(reopened.get('workspace', 'event-1').clarityScore, 88)
  assert.equal(reopened.get('other-workspace', 'event-1'), undefined)
  reopened.close()
  console.log('analysis store tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
