import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()
const ignored = new Set(['.git', '.data', 'node_modules', 'dist', 'target', '.turbo'])
const ignoredFiles = new Set(['.env.example', 'server/public-check.mjs', 'src/redaction.ts'])
const secretPatterns = [
  /TYPESAFE_API_KEY\s*=\s*(?!$|여기에|your_|YOUR_)[^\s#]+/i,
  /(?:apikey_|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|github_pat_|xox[baprs]-)/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
]
const textExtensions = new Set(['.mjs', '.js', '.ts', '.rs', '.json', '.md', '.toml', '.yaml', '.yml', '.env', '.example'])
const findings = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (ignoredFiles.has(relative(root, path))) continue
    else if (textExtensions.has(path.slice(path.lastIndexOf('.')))) {
      const text = await readFile(path, 'utf8')
      for (const pattern of secretPatterns) if (pattern.test(text)) findings.push(relative(root, path))
    }
  }
}

await walk(root)
if (findings.length > 0) {
  console.error(`공개 저장소에 올리기 전에 민감정보를 확인하세요: ${[...new Set(findings)].join(', ')}`)
  process.exit(1)
}
console.log('public repository check passed')
