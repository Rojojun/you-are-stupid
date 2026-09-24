export type RedactionKind = 'private_key' | 'api_key' | 'bearer_token' | 'password' | 'email'

export type RedactionResult = Readonly<{
  text: string
  kinds: readonly RedactionKind[]
}> 

type Rule = Readonly<{ kind: RedactionKind; pattern: RegExp; replacement: string }>

const rules: readonly Rule[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    replacement: '<REDACTED:PRIVATE_KEY>',
  },
  {
    kind: 'api_key',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: '<REDACTED:API_KEY>',
  },
  {
    kind: 'bearer_token',
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi,
    replacement: '$1<REDACTED:TOKEN>',
  },
  {
    kind: 'password',
    pattern: /\b(password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi,
    replacement: '$1=<REDACTED:PASSWORD>',
  },
  {
    kind: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '<REDACTED:EMAIL>',
  },
]

export const redactText = (text: string): RedactionResult => {
  let redacted = text
  const kinds: RedactionKind[] = []
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(redacted)) kinds.push(rule.kind)
    rule.pattern.lastIndex = 0
    redacted = redacted.replace(rule.pattern, rule.replacement)
  }
  return { text: redacted, kinds: [...new Set(kinds)] }
}
