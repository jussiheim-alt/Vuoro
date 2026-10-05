import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Soft update prompt — never force-reload the page while the user is working.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Check for a new build at most every 6 hours (not on every focus)
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      const SIX_HOURS = 6 * 60 * 60 * 1000
      window.setInterval(() => {
        void registration.update()
      }, SIX_HOURS)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="install-banner" role="status">
      <div className="install-banner-text">
        <strong>Uusi versio saatavilla</strong>
        <span>Voit päivittää kun sinulle sopii — työsi ei katoa.</span>
      </div>
      <div className="install-banner-actions">
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void updateServiceWorker(true)}
        >
          Päivitä
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setNeedRefresh(false)}
        >
          Myöhemmin
        </button>
      </div>
    </div>
  )
}
