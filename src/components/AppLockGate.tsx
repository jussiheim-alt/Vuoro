import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  hasBiometricUnlock,
  isLockEnabled,
  isSessionUnlocked,
  markSessionLocked,
  markSessionUnlocked,
  noteAppHidden,
  shouldRelockAfterBackground,
  unlockWithBiometric,
  verifyPin,
} from '../lib/appLock'

type Props = {
  children: React.ReactNode
  /** Increment to force the lock screen (e.g. “Lukitse nyt”). */
  lockNonce?: number
}

/**
 * Blocks the app behind PIN / Face ID when lock is enabled in settings.
 */
export function AppLockGate({ children, lockNonce = 0 }: Props) {
  const [locked, setLocked] = useState(() => {
    if (!isLockEnabled()) return false
    return !isSessionUnlocked()
  })
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (lockNonce > 0) {
      markSessionLocked()
      setLocked(true)
      setPin('')
      setError(null)
    }
  }, [lockNonce])

  useEffect(() => {
    setBioAvailable(hasBiometricUnlock())
  }, [locked])

  useEffect(() => {
    if (!isLockEnabled()) {
      setLocked(false)
      return
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        noteAppHidden()
        return
      }
      if (shouldRelockAfterBackground()) {
        markSessionLocked()
        setLocked(true)
        setPin('')
        setError(null)
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', noteAppHidden)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', noteAppHidden)
    }
  }, [])

  useEffect(() => {
    if (!locked) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 200)
    return () => window.clearTimeout(t)
  }, [locked])

  useEffect(() => {
    if (!locked || !bioAvailable) return
    void (async () => {
      setBusy(true)
      try {
        const ok = await unlockWithBiometric()
        if (ok) {
          setLocked(false)
          setPin('')
        }
      } catch {
        /* cancelled */
      } finally {
        setBusy(false)
      }
    })()
  }, [locked, bioAvailable])

  async function tryBiometric() {
    setBusy(true)
    setError(null)
    try {
      const ok = await unlockWithBiometric()
      if (ok) {
        setLocked(false)
        setPin('')
      }
    } catch {
      /* cancelled */
    } finally {
      setBusy(false)
    }
  }

  async function submitPin(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const ok = await verifyPin(pin)
      if (!ok) {
        setError('Väärä PIN-koodi')
        setPin('')
        inputRef.current?.focus()
        return
      }
      markSessionUnlocked()
      setLocked(false)
      setPin('')
    } catch {
      setError('Avaus epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  if (!locked) return <>{children}</>

  return (
    <div className="app-lock" role="dialog" aria-modal="true" aria-label="Vuoro lukittu">
      <div className="app-lock-card">
        <p className="brand-mark">Vuoro</p>
        <h1>Lukittu</h1>
        <p className="lede">
          Syötä PIN{bioAvailable ? ' tai avaa kasvotunnistuksella' : ''}, jotta
          puhuja- ja puhelintiedot pysyvät suojattuina.
        </p>
        <form className="stack" onSubmit={(e) => void submitPin(e)}>
          <div className="field">
            <label htmlFor="vuoro-pin">PIN-koodi</label>
            <input
              ref={inputRef}
              id="vuoro-pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
              }
              disabled={busy}
            />
          </div>
          {error ? <p className="lock-error">{error}</p> : null}
          <div className="actions">
            <button
              type="submit"
              className="btn btn-accent"
              disabled={busy || pin.length < 4}
            >
              Avaa
            </button>
            {bioAvailable ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void tryBiometric()}
              >
                Face ID / Touch ID
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}
