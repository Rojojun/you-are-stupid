import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Keep local secrets server-only. Existing process environment values win.
export function loadLocalEnv(path = resolve(process.cwd(), '.env')) {
  let content
  try { content = readFileSync(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[match[1]] = value
  }
}

loadLocalEnv()
