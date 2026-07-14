const SENSITIVE_TOKENS = ['password', 'token', 'authorization', 'cookie', 'secret', 'phone', 'idcard']
const MASK_PLACEHOLDER = '***'
const MASKED_KEY_PLACEHOLDER = '[masked]'
const UNMASKED_CONTROL_KEYS = new Set([
  'Alt',
  'AltGraph',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'CapsLock',
  'Control',
  'Delete',
  'End',
  'Enter',
  'Escape',
  'Home',
  'Insert',
  'Meta',
  'PageDown',
  'PageUp',
  'Shift',
  'Tab',
])

export function shouldMaskKey(key: string | undefined | null) {
  if (!key) {
    return false
  }

  const lowered = key.toLowerCase()
  const normalized = lowered.replace(/[\s_-]+/g, '')

  return SENSITIVE_TOKENS.some((token) => lowered.includes(token) || normalized.includes(token))
}

export function isSensitiveInputTarget(target: HTMLElement | null) {
  const fieldName =
    target?.getAttribute('name') ||
    target?.getAttribute('id') ||
    target?.getAttribute('aria-label') ||
    ''

  return (target instanceof HTMLInputElement && target.type === 'password') || shouldMaskKey(fieldName)
}

export function maskValue(value: string | undefined | null) {
  if (!value) {
    return value ?? undefined
  }

  return MASK_PLACEHOLDER
}

export function maskValueIfSensitive(target: HTMLElement | null, value: string | undefined | null) {
  return isSensitiveInputTarget(target) ? maskValue(value) : value ?? undefined
}

export function maskPrintableKeyIfSensitive(key: string, sensitive: boolean) {
  if (!sensitive || UNMASKED_CONTROL_KEYS.has(key) || /^F\d{1,2}$/.test(key)) {
    return { key, masked: false }
  }

  return {
    key: MASKED_KEY_PLACEHOLDER,
    masked: true,
  }
}

export function sanitizeHeaders(headers: Record<string, unknown> | undefined) {
  if (!headers) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (shouldMaskKey(key)) {
        return [key, MASK_PLACEHOLDER]
      }

      return [key, String(value)]
    }),
  )
}

export function mergeHeaders(
  currentHeaders?: Record<string, string>,
  nextHeaders?: Record<string, string>,
) {
  if (!currentHeaders && !nextHeaders) {
    return undefined
  }

  return {
    ...(currentHeaders ?? {}),
    ...(nextHeaders ?? {}),
  }
}

export function truncateBody(body: string | undefined, maxLength = 1_000_000) {
  if (!body) {
    return { body, truncated: false }
  }

  if (body.length <= maxLength) {
    return { body, truncated: false }
  }

  return {
    body: `${body.slice(0, maxLength)}\n\n...[truncated ${body.length - maxLength} chars]`,
    truncated: true,
  }
}

export function isProbablyTextMimeType(mimeType?: string) {
  if (!mimeType) {
    return true
  }

  const lowered = mimeType.toLowerCase()
  return (
    lowered.startsWith('text/') ||
    lowered.includes('json') ||
    lowered.includes('xml') ||
    lowered.includes('javascript') ||
    lowered.includes('svg') ||
    lowered.includes('form-urlencoded')
  )
}
