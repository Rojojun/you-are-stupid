import { spawn } from 'node:child_process'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (!value.startsWith('--')) return pairs
  pairs.push([value.slice(2), values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : 'true'])
  return pairs
}, []))

const timeZone = args.timezone ?? process.env.INIT_TIMEZONE ?? 'Asia/Seoul'
const date = args.date ?? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const current = new Date(`${date}T00:00:00Z`)
if (Number.isNaN(current.getTime())) throw new Error(`invalid date: ${date}`)
const dayOfWeek = current.getUTCDay() || 7
const isWeekly = dayOfWeek === 1
const isMonthly = current.getUTCDate() === 1
const period = args.period ?? (isWeekly && isMonthly ? 'combined' : isMonthly ? 'monthly' : isWeekly ? 'weekly' : 'none')

if (period === 'none') {
  console.log(`no init addendum scheduled for ${date}`)
  process.exit(0)
}

const forwarded = [
  '--period', period,
  '--date', date,
  ...['timezone', 'storage', 'analysis-db', 'workspace', 'out-dir'].flatMap((key) => args[key] && args[key] !== 'true' ? [`--${key}`, args[key]] : []),
]
const child = spawn(process.execPath, [new URL('./init-update.mjs', import.meta.url).pathname, ...forwarded], { stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
