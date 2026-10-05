import { useEffect, useState } from 'react'
import {
  changePin,
  clearBiometricUnlock,
  disableLock,
  enableLockWithPin,
  hasBiometricUnlock,
  isLockEnabled,
  isValidPin,
  markSessionLocked,
  platformAuthenticatorAvailable,
  registerBiometricUnlock,
} from '../lib/appLock'

type Props = {
  showToast: (msg: string) => void
  onLockNow?: () => void
}

export function LockSettings({ showToast, onLockNow }: Props) {
  const [enabled, setEnabled] = useState(() => isLockEnabled())
  const [hasBio, setHasBio] = useState(() => hasBiometricUnlock())
  const [bioDevice, setBioDevice] = useState(false)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void platformAuthenticatorAvailable().then(setBioDevice)
  }, [])

  function refresh() {
    setEnabled(isLockEnabled())
    setHasBio(hasBiometricUnlock())
  }

  async function enable() {
    if (!isValidPin(pin)) {
      showToast('PIN:n on oltava 4–8 numeroa')
      return
    }
    if (pin !== pin2) {
      showToast('PIN-koodit eivät täsmää')
      return
    }
    setBusy(true)
    try {
      await enableLockWithPin(pin)
      setPin('')
      setPin2('')
      refresh()
      showToast('Lukitus käytössä')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lukituksen aktivointi epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      await disableLock(currentPin)
      setCurrentPin('')
      refresh()
      showToast('Lukitus poistettu')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Poisto epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  async function change() {
    if (!isValidPin(pin)) {
      showToast('Uuden PIN:n on oltava 4–8 numeroa')
      return
    }
    if (pin !== pin2) {
      showToast('Uudet PIN-koodit eivät täsmää')
      return
    }
    setBusy(true)
    try {
      await changePin(currentPin, pin)
      setCurrentPin('')
      setPin('')
      setPin2('')
      refresh()
      showToast('PIN vaihdettu')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Vaihto epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  async function enableBio() {
    setBusy(true)
    try {
      const ok = await registerBiometricUnlock()
      refresh()
      showToast(ok ? 'Face ID / Touch ID kytketty' : 'Biometriaa ei rekisteröity')
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Biometrian kytkentä epäonnistui (tai peruutettiin)',
      )
    } finally {
      setBusy(false)
    }
  }

  async function disableBio() {
    setBusy(true)
    try {
      await clearBiometricUnlock(currentPin)
      refresh()
      showToast('Biometria poistettu')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Poisto epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div>
        <h2 className="section-title">Lukitus ja tietoturva</h2>
        <p className="lede">
          PIN suojaa puhujien nimet ja numerot tällä laitteella. Halutessasi voit
          avata myös Face ID:llä tai Touch ID:llä. Lukittuu uudelleen, kun
          sovellus on ollut taustalla yli minuutin.
        </p>
      </div>

      {!enabled ? (
        <>
          <div className="field-row two">
            <div className="field">
              <label htmlFor="lock-pin-new">Uusi PIN (4–8 numeroa)</label>
              <input
                id="lock-pin-new"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="lock-pin-confirm">Vahvista PIN</label>
              <input
                id="lock-pin-confirm"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]*"
                maxLength={8}
                value={pin2}
                onChange={(e) =>
                  setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
              />
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-accent"
              disabled={busy}
              onClick={() => void enable()}
            >
              Ota lukitus käyttöön
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Lukitus on päällä
            {hasBio ? ' · Face ID / Touch ID kytketty' : ''}.
          </p>
          <div className="field-row two">
            <div className="field">
              <label htmlFor="lock-pin-current">Nykyinen PIN</label>
              <input
                id="lock-pin-current"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]*"
                maxLength={8}
                value={currentPin}
                onChange={(e) =>
                  setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="lock-pin-change">Uusi PIN</label>
              <input
                id="lock-pin-change"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="lock-pin-change2">Vahvista uusi PIN</label>
              <input
                id="lock-pin-change2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]*"
                maxLength={8}
                value={pin2}
                onChange={(e) =>
                  setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
              />
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void change()}
            >
              Vaihda PIN
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                markSessionLocked()
                onLockNow?.()
                showToast('Vuoro lukittu')
              }}
            >
              Lukitse nyt
            </button>
            {bioDevice && !hasBio ? (
              <button
                type="button"
                className="btn btn-accent"
                disabled={busy}
                onClick={() => void enableBio()}
              >
                Kytke Face ID / Touch ID
              </button>
            ) : null}
            {hasBio ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || currentPin.length < 4}
                onClick={() => void disableBio()}
              >
                Poista biometria
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || currentPin.length < 4}
              onClick={() => void disable()}
            >
              Poista lukitus
            </button>
          </div>
          {!bioDevice ? (
            <p className="hint">
              Tämä laite/selain ei ilmoita Face ID -tukea. PIN toimii silti.
              Asennetussa Vuoro-sovelluksessa (Koti-valikko) biometria toimii
              usein paremmin kuin tavallisessa Safari-välilehdessä.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
