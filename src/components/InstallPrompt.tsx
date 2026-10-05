import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

type Props = {
  /** When true, always show install help (e.g. Asetukset), ignoring dismiss. */
  force?: boolean
}

/**
 * Offers “Add to Home Screen” so Vuoro opens like a native app (no browser chrome).
 */
export function InstallPrompt({ force = false }: Props) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [showIosHelp, setShowIosHelp] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    if (force) return false
    try {
      return localStorage.getItem('vuoro-install-dismissed') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (isStandalone()) return
    if (dismissed && !force) return

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBip)

    if (isIos()) setShowIosHelp(true)

    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [dismissed, force])

  if (isStandalone()) {
    if (!force) return null
    return (
      <div className="install-banner install-banner-ok" role="status">
        <div className="install-banner-text">
          <strong>Vuoro on asennettu</strong>
          <span>Käytät sovellustilaa — ei selainpalkkia.</span>
        </div>
      </div>
    )
  }

  if (dismissed && !force) return null
  if (!deferred && !showIosHelp && !force) return null

  function dismiss() {
    if (force) return
    setDismissed(true)
    setDeferred(null)
    setShowIosHelp(false)
    try {
      localStorage.setItem('vuoro-install-dismissed', '1')
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }

  return (
    <div className="install-banner" role="status">
      <div className="install-banner-text">
        <strong>Asenna Vuoro sovellukseksi</strong>
        {deferred ? (
          <span>
            Asennuksen jälkeen Vuoro aukeaa omasta kuvakkeesta, ilman Safaria.
          </span>
        ) : isIos() ? (
          <span>
            iPhonessa: napauta Jaa (□↑) → <em>Lisää Koti-valikkoon</em> → Lisää.
            Sen jälkeen avaa Vuoro kuvakkeesta — ei hypi enää selainpäivityksiin.
          </span>
        ) : (
          <span>
            Lisää Koti-valikkoon selaimen valikosta, niin Vuoro toimii kuin app.
          </span>
        )}
      </div>
      <div className="install-banner-actions">
        {deferred && (
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void install()}
          >
            Asenna
          </button>
        )}
        {!force && (
          <button type="button" className="btn btn-ghost" onClick={dismiss}>
            Ei nyt
          </button>
        )}
      </div>
    </div>
  )
}
