const BAD = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g

type Issue = {
  path: string
  count: number
}

type Encoded = {
  text: string
  issues: Issue[]
}

function scalar(s: string): { text: string; count: number } {
  let count = 0
  const text = s.replace(BAD, m => {
    if (m.length === 2) return m
    count += 1
    return "�"
  })
  return { text, count }
}

export function encode(v: unknown): Encoded {
  const paths = new WeakMap<object, string>()
  const issues: Issue[] = []
  const text = JSON.stringify(v, function (this: unknown, key, value: unknown) {
    const holder = this && typeof this === "object" ? paths.get(this) : undefined
    const path = key ? `${holder ?? "$"}.${key}` : "$"
    if (value && typeof value === "object") paths.set(value, path)
    if (typeof value !== "string") return value
    const next = scalar(value)
    if (next.count > 0) issues.push({ path, count: next.count })
    return next.text
  }) ?? "null"
  return { text, issues }
}
