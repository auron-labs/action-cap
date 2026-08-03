const SENSITIVE_TOKENS = [
  'password',
  'passwd',
  'passcode',
  'token',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'clientkey',
  'privatekey',
  'credential',
  'csrf',
  'xsrf',
  'nonce',
  'otp',
  'pin',
  'cvv',
  'cvc',
  'ssn',
  'taxid',
  'passport',
  'phone',
  'idcard',
]
const MASK_PLACEHOLDER = '***'
const MASKED_KEY_PLACEHOLDER = '[masked]'
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `((?:${SENSITIVE_TOKENS.join('|')})[\\s_-]*(?:id|key|code|number)?["']?\\s*(?:=|:|\\b)\\s*["']?)([^\\s&;,}"']+)`,
  'gi',
)
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

export function sanitizeBody(body: string | undefined, contentType?: string) {
  if (!body) {
    return body
  }

  const normalizedContentType = contentType?.toLowerCase() ?? ''
  const structured = sanitizeStructuredBody(body, normalizedContentType)
  if (structured !== undefined) {
    return structured
  }

  return sanitizeTextSecrets(body)
}

export function sanitizeUrl(url: string | undefined) {
  if (!url) {
    return url
  }

  try {
    const parsed = new URL(url)
    for (const key of new Set(parsed.searchParams.keys())) {
      if (shouldMaskKey(key)) {
        parsed.searchParams.set(key, MASK_PLACEHOLDER)
      }
    }
    return sanitizeTextSecrets(parsed.toString())
  } catch {
    return sanitizeTextSecrets(url)
  }
}

export function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeTextSecrets(value)
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        shouldMaskKey(key) ? maskUnknownValue(entry) : sanitizeJsonValue(entry),
      ]),
    )
  }
  return value
}

function sanitizeStructuredBody(body: string, contentType: string) {
  if (contentType.includes('json') || /^[\s]*[\[{]/.test(body)) {
    try {
      return JSON.stringify(sanitizeJsonValue(JSON.parse(body)))
    } catch {
      return undefined
    }
  }

  if (contentType.includes('form-urlencoded') || looksLikeFormBody(body)) {
    const params = new URLSearchParams(body)
    let changed = false
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key)
      params.delete(key)
      for (const value of values) {
        params.append(key, shouldMaskKey(key) ? MASK_PLACEHOLDER : sanitizeTextSecrets(value))
      }
      changed ||= shouldMaskKey(key) || values.some((value) => sanitizeTextSecrets(value) !== value)
    }
    return changed ? params.toString() : body
  }

  return undefined
}

function looksLikeFormBody(body: string) {
  return !body.includes('\n') && /^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/.test(body)
}

function maskUnknownValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(() => MASK_PLACEHOLDER)
  }
  return value == null ? value : MASK_PLACEHOLDER
}

function sanitizeTextSecrets(value: string) {
  return value
    .replace(BEARER_PATTERN, `Bearer ${MASK_PLACEHOLDER}`)
    .replace(JWT_PATTERN, MASK_PLACEHOLDER)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1${MASK_PLACEHOLDER}`)
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
