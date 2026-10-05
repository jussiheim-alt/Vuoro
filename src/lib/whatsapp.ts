/** Normalize phone for WhatsApp wa.me (digits only, Finnish 0 → 358). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  if (digits.startsWith('0') && digits.length >= 9) {
    return `358${digits.slice(1)}`
  }
  if (digits.startsWith('358')) return digits
  if (digits.length >= 10) return digits
  return digits
}

const WRAP_QUOTES: Array<[string, string]> = [
  ['"', '"'],
  ['\u201C', '\u201D'],
  ['\u201D', '\u201D'],
  ['\u00AB', '\u00BB'],
  ['\u2018', '\u2019'],
]

/** Strip all outer quote layers, then wrap once with straight quotes. */
export function quotedThemeName(name: string): string {
  let inner = name.trim()
  let changed = true
  while (changed && inner.length >= 2) {
    changed = false
    for (const [open, close] of WRAP_QUOTES) {
      if (inner.startsWith(open) && inner.endsWith(close) && inner.length > open.length + close.length) {
        inner = inner.slice(open.length, -close.length).trim()
        changed = true
        break
      }
    }
  }
  return `"${inner}"`
}

/** First name for a casual WhatsApp greeting (e.g. "Hei Jani!"). */
export function greetingFirstName(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return ''
  // Keep hyphenated first names (Ari-Pekka); drop surname and extras.
  const first = trimmed.split(/\s+/)[0] ?? trimmed
  return first
}

export function buildMessage(
  template: string,
  vars: {
    nimi: string
    teema: string
    päivä: string
    tapahtuma?: string
    numero?: string
  },
): string {
  const teema = quotedThemeName(vars.teema)
  const nimi = greetingFirstName(vars.nimi) || vars.nimi
  // Drop any quotes the template still wraps around {{teema}}.
  let out = template.replace(/["“”«»]\s*\{\{teema\}\}\s*["“”«»]/g, '{{teema}}')
  out = out
    .replaceAll('{{teema}}', teema)
    .replaceAll('{{nimi}}', nimi)
    .replaceAll('{{numero}}', vars.numero ?? '')
    .replaceAll('{{päivä}}', vars.päivä)
    .replaceAll('{{tapahtuma}}', vars.tapahtuma ?? 'esitelmä')

  // Collapse accidental double quotes / duplicate clock times
  out = out.replace(/"{2,}([^"\n]+)"{2,}/g, '"$1"')
  out = out.replace(/(\bklo\s*11[.,]00\s*){2,}/gi, 'klo 11.00 ')
  return out.replace(/[ \t]+\n/g, '\n').replace(/ +([.?])/g, '$1')
}

export function whatsappUrl(phone: string, message: string): string | null {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}

export function formatLectureDateFi(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const date = d.toLocaleDateString('fi-FI', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return `${date} klo 11.00`
}
