/**
 * Remove any controlling service worker.
 * Earlier builds used autoUpdate, which reloads the app whenever a new
 * deploy appears — disruptive during normal use. Manifest / home-screen
 * install still works without an active SW.
 */
export async function dismantleServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* ignore */
  }
}
