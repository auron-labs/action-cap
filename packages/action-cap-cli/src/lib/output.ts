import { encode as jsonToToon } from '@toon-format/toon'
import Table from 'cli-table3'

export type OutputFormat = 'json' | 'table' | 'toon'

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined)
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        result[key] = stripUndefined(val)
      }
    }
    return result
  }
  return value
}

export function formatOutput(data: unknown, format: OutputFormat): string {
  const cleaned = stripUndefined(data)
  switch (format) {
    case 'json':
      return JSON.stringify(cleaned, null, 2)
    case 'table':
      return renderTable(cleaned)
    case 'toon':
      return jsonToToon(cleaned)
  }
}

function renderTable(data: unknown): string {
  if (Array.isArray(data)) {
    return renderArrayTable(data)
  }
  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Object.values(obj).every((v) => Array.isArray(v))) {
      const result: string[] = []
      for (const [key, value] of Object.entries(obj)) {
        result.push(`\n=== ${key} ===`)
        result.push(renderArrayTable(value as unknown[]))
      }
      return result.join('\n')
    }
    return renderKeyValueTable(obj)
  }
  return String(data)
}

function renderKeyValueTable(obj: Record<string, unknown>): string {
  const table = new Table({
    head: ['Key', 'Value'],
  })

  for (const [key, value] of Object.entries(obj)) {
    table.push([key, formatValue(value)])
  }

  return table.toString()
}

function renderArrayTable(items: unknown[]): string {
  if (items.length === 0) {
    return '(empty)'
  }

  const first = items[0]
  if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    const firstObj = first as Record<string, unknown>
    const headers = Object.keys(firstObj)

    const table = new Table({
      head: headers,
    })

    for (const item of items) {
      if (item !== null && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        table.push(headers.map((h) => formatValue(obj[h])))
      }
    }

    return table.toString()
  }

  const table = new Table({
    head: ['Value'],
  })

  for (const item of items) {
    table.push([formatValue(item)])
  }

  return table.toString()
}

function formatValue(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
