import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isSensitiveInputTarget,
  maskPrintableKeyIfSensitive,
  maskValue,
  maskValueIfSensitive,
  sanitizeHeaders,
  shouldMaskKey,
} from './sanitizer.ts'

test('maskValue fully redacts non-empty sensitive values with a constant placeholder', () => {
  const samples = ['abc', 'abcdef', 'super-secret-token-12345', 'Bearer very-sensitive-value']

  for (const sample of samples) {
    const masked = maskValue(sample)

    assert.equal(masked, '***')
    assert.equal(masked?.length, 3)
    if (sample.length !== 3) {
      assert.notEqual(masked?.length, sample.length)
    }
    assert.equal(masked?.includes(sample.slice(0, 1)), false)
    assert.equal(masked?.includes(sample.slice(-1)), false)
    assert.equal(masked?.includes(sample.slice(0, 2)), false)
    assert.equal(masked?.includes(sample.slice(-2)), false)
  }
})

test('sanitizeHeaders never preserves secret-derived substrings for sensitive keys', () => {
  const headers = sanitizeHeaders({
    Authorization: 'Bearer top-secret-token',
    'X-Api-Token': 'abc123xyz',
    'Content-Type': 'application/json',
  })

  assert.deepEqual(headers, {
    Authorization: '***',
    'X-Api-Token': '***',
    'Content-Type': 'application/json',
  })
  assert.equal(headers?.Authorization.includes('top'), false)
  assert.equal(headers?.['X-Api-Token'].includes('abc'), false)
})

test('shouldMaskKey detects common sensitive field names', () => {
  assert.equal(shouldMaskKey('password'), true)
  assert.equal(shouldMaskKey('authToken'), true)
  assert.equal(shouldMaskKey('session_cookie'), true)
  assert.equal(shouldMaskKey('pass word'), true)
  assert.equal(shouldMaskKey('ID Card Number'), true)
  assert.equal(shouldMaskKey('email'), false)
})

test('maskValueIfSensitive only masks values for sensitive targets', () => {
  const originalHtmlInputElement = globalThis.HTMLInputElement
  globalThis.HTMLInputElement ??= class HTMLInputElement {} as typeof HTMLInputElement

  const sensitiveTarget = {
    getAttribute(name: string) {
      return name === 'name' ? 'authToken' : null
    },
  } as unknown as HTMLElement

  const nonSensitiveTarget = {
    getAttribute() {
      return 'email'
    },
  } as unknown as HTMLElement

  try {
    assert.equal(maskValueIfSensitive(sensitiveTarget, 'Bearer top-secret-token'), '***')
    assert.equal(maskValueIfSensitive(nonSensitiveTarget, 'visible@example.com'), 'visible@example.com')
    assert.equal(maskValueIfSensitive(null, 'plain-text'), 'plain-text')
  } finally {
    if (originalHtmlInputElement) {
      globalThis.HTMLInputElement = originalHtmlInputElement
    } else {
      delete (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement
    }
  }
})

test('shared sensitive-target helper covers password, name, id, and aria-label for value and key masking', () => {
  const originalHtmlInputElement = globalThis.HTMLInputElement
  globalThis.HTMLInputElement ??= (class HTMLInputElement {
    type = 'text'

    getAttribute() {
      return null
    }
  } as unknown as typeof HTMLInputElement)

  const cases = [
    {
      label: 'password',
      target: Object.assign(new HTMLInputElement(), { type: 'password' }) as HTMLElement,
    },
    {
      label: 'name',
      target: {
        getAttribute(name: string) {
          return name === 'name' ? 'authToken' : null
        },
      } as unknown as HTMLElement,
    },
    {
      label: 'id',
      target: {
        getAttribute(name: string) {
          return name === 'id' ? 'customerSecret' : null
        },
      } as unknown as HTMLElement,
    },
    {
      label: 'aria-label',
      target: {
        getAttribute(name: string) {
          return name === 'aria-label' ? 'id card number' : null
        },
      } as unknown as HTMLElement,
    },
  ]

  try {
    for (const { label, target } of cases) {
      const sensitive = isSensitiveInputTarget(target)

      assert.equal(sensitive, true, `${label} target should be sensitive`)
      assert.equal(maskValueIfSensitive(target, 'visible value'), '***')
      assert.deepEqual(maskPrintableKeyIfSensitive('x', sensitive), {
        key: '[masked]',
        masked: true,
      })
    }
  } finally {
    if (originalHtmlInputElement) {
      globalThis.HTMLInputElement = originalHtmlInputElement
    } else {
      delete (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement
    }
  }
})

test('maskPrintableKeyIfSensitive masks printable keys only for sensitive inputs', () => {
  assert.deepEqual(maskPrintableKeyIfSensitive('a', true), {
    key: '[masked]',
    masked: true,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('secret', true), {
    key: '[masked]',
    masked: true,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('中', true), {
    key: '[masked]',
    masked: true,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('😊', true), {
    key: '[masked]',
    masked: true,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive(' ', true), {
    key: '[masked]',
    masked: true,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('Backspace', true), {
    key: 'Backspace',
    masked: false,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('ArrowLeft', true), {
    key: 'ArrowLeft',
    masked: false,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('F5', true), {
    key: 'F5',
    masked: false,
  })

  assert.deepEqual(maskPrintableKeyIfSensitive('a', false), {
    key: 'a',
    masked: false,
  })

  assert.equal(maskPrintableKeyIfSensitive('secret', true).key.includes('sec'), false)
  assert.equal(maskPrintableKeyIfSensitive('secret', true).key.length, '[masked]'.length)
})

test('password-field typing helpers never preserve raw printable characters', () => {
  const originalHtmlInputElement = globalThis.HTMLInputElement
  globalThis.HTMLInputElement ??= (class HTMLInputElement {
    type = 'text'

    getAttribute() {
      return null
    }
  } as unknown as typeof HTMLInputElement)

  try {
    const passwordTarget = new HTMLInputElement()
    passwordTarget.type = 'password'

    assert.equal(isSensitiveInputTarget(passwordTarget), true)
    assert.equal(maskValueIfSensitive(passwordTarget, 'P@ssw0rd!'), '***')
    assert.equal(maskValueIfSensitive(passwordTarget, 'visible label text'), '***')
    assert.deepEqual(maskPrintableKeyIfSensitive('P', isSensitiveInputTarget(passwordTarget)), {
      key: '[masked]',
      masked: true,
    })
  } finally {
    if (originalHtmlInputElement) {
      globalThis.HTMLInputElement = originalHtmlInputElement
    } else {
      delete (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement
    }
  }
})
