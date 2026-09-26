import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class AnalysisStore {
  constructor(path = resolve(process.env.CENTRAL_ANALYSIS_DB ?? './.data/analysis.sqlite')) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS analysis_results (
        workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        engine TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (workspace_id, event_id)
      )
    `)
    this.readStatement = this.database.prepare('SELECT payload FROM analysis_results WHERE workspace_id = ? AND event_id = ?')
    this.listStatement = this.database.prepare('SELECT payload FROM analysis_results WHERE workspace_id = ? ORDER BY analyzed_at ASC')
    this.writeStatement = this.database.prepare(`
      INSERT INTO analysis_results (workspace_id, event_id, engine, analyzed_at, payload)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, event_id) DO UPDATE SET
        engine = excluded.engine,
        analyzed_at = excluded.analyzed_at,
        payload = excluded.payload
    `)
  }

  get(workspaceId, eventId) {
    const row = this.readStatement.get(workspaceId, eventId)
    if (!row) return undefined
    return JSON.parse(row.payload)
  }

  list(workspaceId) {
    return this.listStatement.all(workspaceId).map((row) => JSON.parse(row.payload))
  }

  put(workspaceId, classification) {
    const analyzedAt = new Date().toISOString()
    this.writeStatement.run(workspaceId, classification.eventId, classification.engine ?? 'unknown', analyzedAt, JSON.stringify(classification))
  }

  close() {
    this.database.close()
  }
}
