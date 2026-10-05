import { useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import type { AppData } from '../types'
import { applyPdfListsToData } from '../lib/mergeImports'
import {
  applyVarauslistaToData,
  parseVarauslistaBuffer,
} from '../lib/parseVarauslista'
import { applySeedToData, fetchKierrosSeed } from '../lib/seed'
import { applySyksy2026Roles } from '../lib/seedRolesFromSchedule'
import { uniqueCongregations } from '../lib/recommend'

type Props = {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
  showToast: (msg: string) => void
}

export function ImportAndFilters({ data, setData, showToast }: Props) {
  const [busy, setBusy] = useState(false)
  const congregations = useMemo(
    () => uniqueCongregations(data.speakers),
    [data.speakers],
  )

  async function onPdfFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      const { parseKierrosPdfFiles } = await import('../lib/parseKierrosPdf')
      const parsed = await parseKierrosPdfFiles(files)
      setData((prev) => applyPdfListsToData(prev, parsed))
      const summary = parsed.files
        .map((f) => `${f.name}: ${f.kind} (${f.count})`)
        .join(' · ')
      showToast(
        `PDF tuotu — teemoja ${parsed.themes.length}, puhujia ${parsed.speakers.length}. ${summary}`,
      )
    } catch (err) {
      console.error(err)
      showToast('PDF-tuonti epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  async function onVarausFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!data.themes.length || !data.speakers.length) {
      showToast('Lataa ensin teema- ja puhujalistat (PDF)')
      return
    }
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseVarauslistaBuffer(buffer, data.themes, data.speakers)
      setData((prev) => applyVarauslistaToData(prev, parsed))
      showToast(
        `Varauslista: ${parsed.matched} esitelmää` +
          (parsed.futureBooked
            ? ` (joista ${parsed.futureBooked} tulevaa)`
            : '') +
          (parsed.guestSpeakers.length
            ? `, ${parsed.guestSpeakers.length} vierailijaa`
            : ''),
      )
    } catch (err) {
      console.error(err)
      showToast('Varauslistan tuonti epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  async function loadBundled() {
    setBusy(true)
    try {
      const seed = await fetchKierrosSeed()
      setData((prev) => applySyksy2026Roles(applySeedToData(prev, seed)))
      showToast(
        `Valmis paketti: ${seed.themes.length} teemaa, ${seed.speakers.length} puhujaa, ${seed.history?.length ?? 0} esitelmää` +
          (seed.historyStats &&
          typeof seed.historyStats.futureBooked === 'number'
            ? ` (joista ${seed.historyStats.futureBooked} tulevaa varausta)`
            : ''),
      )
    } catch {
      showToast('Pakettilataus epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  function toggleCongregation(name: string) {
    setData((prev) => {
      const current = prev.settings.allowedCongregations
      const next = current.includes(name)
        ? current.filter((c) => c !== name)
        : [...current, name]
      return {
        ...prev,
        settings: { ...prev.settings, allowedCongregations: next },
      }
    })
  }

  return (
    <section className="panel stack">
      <div>
        <h2 className="section-title">Tuonti & suodattimet</h2>
        <p className="lede">
          Kun PDF-listat tai Excel-varauslista päivittyvät, tuo ne tähän.
          Historia säilyy mahdollisuuksien mukaan.
        </p>
      </div>

      <div className="import-grid">
        <div className="import-card">
          <h3>1. Teema- ja puhuja-PDF</h3>
          <p className="hint">
            Lataa yksi tai molemmat listat (jäsennykset + puhujat). Voit valita
            useita tiedostoja kerralla.
          </p>
          <label className={`btn btn-primary file-input ${busy ? 'disabled' : ''}`}>
            Tuo PDF-listat
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={busy}
              onChange={(e) => void onPdfFiles(e)}
            />
          </label>
        </div>

        <div className="import-card">
          <h3>2. Varauslista (Excel)</h3>
          <p className="hint">
            `.xlsb` / `.xlsx` vuosivälilehdillä (2020–). Päivittää historian ja
            &quot;viimeksi&quot;-päivät.
          </p>
          <label className={`btn btn-accent file-input ${busy ? 'disabled' : ''}`}>
            Tuo varauslista
            <input
              type="file"
              accept=".xlsb,.xlsx,.xls,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => void onVarausFile(e)}
            />
          </label>
        </div>

        <div className="import-card">
          <h3>Valmis paketti</h3>
          <p className="hint">
            Aiemmin tähän ympäristöön tallennettu kierros 6 + historia.
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void loadBundled()}
          >
            Lataa kierros 6 + historia
          </button>
        </div>
      </div>

      <div className="divider" />

      <div>
        <h2 className="section-title">Suodattimet</h2>
        <p className="lede">
          Vaikuttavat automaattiseen suositukseen. Tyhjät seurakunnat = kaikki
          sallittuja.
        </p>
      </div>

      <div className="filter-checks">
        <label>
          <input
            type="checkbox"
            checked={data.settings.includeAssistants}
            onChange={(e) =>
              setData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  includeAssistants: e.target.checked,
                },
              }))
            }
          />{' '}
          Sisällytä avustavat palvelijat
        </label>
        <label>
          <input
            type="checkbox"
            checked={data.settings.includeLocalOnly}
            onChange={(e) =>
              setData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  includeLocalOnly: e.target.checked,
                },
              }))
            }
          />{' '}
          Sisällytä &quot;vain lähiseurakuntiin&quot;
        </label>
        <label>
          <input
            type="checkbox"
            checked={data.settings.recommendSpecialOutlines}
            onChange={(e) =>
              setData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  recommendSpecialOutlines: e.target.checked,
                },
              }))
            }
          />{' '}
          Suosittele myös S-jäsennyksiä (esim. S-31)
        </label>
      </div>

      <div className="field">
        <label>Sallitut seurakunnat</label>
        <div className="actions" style={{ marginBottom: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                settings: { ...prev.settings, allowedCongregations: [] },
              }))
            }
          >
            Kaikki
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              setData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  allowedCongregations: congregations,
                },
              }))
            }
          >
            Valitse kaikki listasta
          </button>
        </div>
        {!congregations.length ? (
          <p className="hint">Ei seurakuntia — tuo ensin puhujalista.</p>
        ) : (
          <div className="cong-grid">
            {congregations.map((c) => {
              const active =
                data.settings.allowedCongregations.length === 0 ||
                data.settings.allowedCongregations.includes(c)
              const checked = data.settings.allowedCongregations.includes(c)
              return (
                <label
                  key={c}
                  className={`cong-chip ${active ? 'on' : ''} ${checked ? 'checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCongregation(c)}
                  />
                  {c}
                </label>
              )
            })}
          </div>
        )}
        <p className="hint">
          {data.settings.allowedCongregations.length === 0
            ? 'Nyt: kaikki seurakunnat mukana suosituksessa.'
            : `Nyt: ${data.settings.allowedCongregations.length} seurakuntaa valittuna.`}
        </p>
      </div>
    </section>
  )
}
