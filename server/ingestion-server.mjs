import { createServer } from 'node:http'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import './load-env.mjs'
import { analyzeEvents } from './analysis-engine.mjs'
import { aggregateClarity } from './aggregation.mjs'
import { createModelAdapter } from './model-adapter.mjs'
import { AnalysisStore } from './analysis-store.mjs'

const port = Number(process.env.CENTRAL_PORT ?? 8787)
const token = process.env.CENTRAL_INGESTION_TOKEN ?? 'local-dev-token'
if (process.env.NODE_ENV === 'production' && token === 'local-dev-token') throw new Error('CENTRAL_INGESTION_TOKEN must be set in production')
const storagePath = resolve(process.env.CENTRAL_STORAGE ?? './.data/ingestion-events.jsonl')
const modelAdapter = createModelAdapter()
let analysisStore

function getAnalysisStore() {
  analysisStore ??= new AnalysisStore()
  return analysisStore
}

const sources = new Set(['codex', 'claude_code', 'antigravity'])
const roles = new Set(['user', 'assistant', 'tool', 'system'])

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

async function bodyOf(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  if (body.length > 5_000_000) throw new Error('PAYLOAD_TOO_LARGE')
  return JSON.parse(body)
}

function validateEvent(event, workspaceId) {
  if (!event || typeof event !== 'object') return 'EVENT_INVALID'
  if ('text' in event) return 'RAW_TEXT_NOT_ALLOWED'
  const required = ['schemaVersion', 'eventId', 'conversationId', 'source', 'role', 'occurredAt', 'redactedText', 'tokenUsage', 'provenance']
  if (required.some((key) => !(key in event))) return 'EVENT_REQUIRED_FIELD_MISSING'
  if (event.schemaVersion !== 1 || event.workspaceId !== workspaceId) return 'EVENT_SCHEMA_INVALID'
  if (typeof event.eventId !== 'string' || event.eventId.length < 1 || event.eventId.length > 300) return 'EVENT_ID_INVALID'
  if (!sources.has(event.source) || !roles.has(event.role)) return 'EVENT_ENUM_INVALID'
  if (typeof event.redactedText !== 'string' || event.redactedText.length > 200_000) return 'REDACTED_TEXT_INVALID'
  if (Number.isNaN(Date.parse(event.occurredAt))) return 'EVENT_DATE_INVALID'
  return null
}

async function loadIds(path = storagePath) {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean)
    return new Set(lines.map((line) => JSON.parse(line).eventId))
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set()
    throw error
  }
}

async function loadEvents(path = storagePath) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function ingestBatch(payload, existingIds = new Set()) {
  if (!payload || typeof payload !== 'object' || typeof payload.workspaceId !== 'string' || !Array.isArray(payload.events)) {
    return { status: 400, body: { error: 'BATCH_INVALID' } }
  }
  if (payload.events.length > 500) return { status: 400, body: { error: 'BATCH_TOO_LARGE' } }
  const errors = payload.events.map((event) => validateEvent(event, payload.workspaceId)).filter(Boolean)
  if (errors.length > 0) return { status: 400, body: { error: errors[0], rejected: payload.events.length } }
  const unique = []
  const seen = new Set(existingIds)
  let duplicates = 0
  for (const event of payload.events) {
    if (seen.has(event.eventId)) duplicates += 1
    else { seen.add(event.eventId); unique.push(event) }
  }
  return { status: 200, body: { accepted: unique.length, duplicates, rejected: 0, eventIds: unique.map((event) => event.eventId) }, events: unique }
}

export function createIngestionServer({ expectedToken = token, path = storagePath } = {}) {
  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' })
      return res.end()
    }
    if (req.method !== 'POST' || !['/v1/ingestions/batches', '/v1/analysis/classifications', '/v1/analysis/clarity/daily'].includes(req.url)) return json(res, 404, { error: 'NOT_FOUND' })
    if (req.headers.authorization !== `Bearer ${expectedToken}`) return json(res, 401, { error: 'UNAUTHORIZED' })
    try {
      const payload = await bodyOf(req)
      if (req.url === '/v1/analysis/classifications') {
        if (typeof payload.workspaceId !== 'string' || (payload.eventIds !== undefined && !Array.isArray(payload.eventIds))) return json(res, 400, { error: 'ANALYSIS_REQUEST_INVALID' })
        const requestedIds = payload.eventIds ? new Set(payload.eventIds) : undefined
        const allEvents = (await loadEvents(path)).filter((event) => event.workspaceId === payload.workspaceId && (!requestedIds || requestedIds.has(event.eventId)))
        const store = getAnalysisStore()
        const cached = payload.refresh === true ? [] : allEvents.map((event) => store.get(payload.workspaceId, event.eventId)).filter(Boolean)
        const cachedIds = new Set(cached.map((item) => item.eventId))
        const events = allEvents.filter((event) => !cachedIds.has(event.eventId))
        try {
          const fresh = await modelAdapter.classify(events)
          for (const classification of fresh) store.put(payload.workspaceId, classification)
          const classifications = [...cached, ...fresh]
          return json(res, 200, { engine: modelAdapter.name, classifications, cache: { cached: cached.length, fresh: fresh.length } })
        } catch (error) {
          return json(res, 502, { error: error instanceof Error ? error.message : 'MODEL_UNAVAILABLE' })
        }
      }
      if (req.url === '/v1/analysis/clarity/daily') {
        if (typeof payload.workspaceId !== 'string') return json(res, 400, { error: 'ANALYSIS_REQUEST_INVALID' })
        const timeZone = payload.timeZone ?? 'Asia/Seoul'
        const events = (await loadEvents(path)).filter((event) => event.workspaceId === payload.workspaceId)
        let classifications
        try { classifications = await modelAdapter.classify(events) }
        catch (error) { return json(res, 502, { error: error instanceof Error ? error.message : 'MODEL_UNAVAILABLE' }) }
        return json(res, 200, { engine: modelAdapter.name, timeZone, daily: aggregateClarity(classifications, events, timeZone) })
      }
      const existingIds = await loadIds(path)
      const result = await ingestBatch(payload, existingIds)
      if (result.events?.length) {
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, result.events.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8')
      }
      return json(res, result.status, result.body)
    } catch (error) {
      return json(res, 400, { error: error?.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'JSON_INVALID' })
    }
  })
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createIngestionServer().listen(port, () => console.log(`central ingestion listening on http://127.0.0.1:${port}`))
}
