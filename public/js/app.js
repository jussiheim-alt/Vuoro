const $ = (sel, el = document) => el.querySelector(sel)
const app = $('#app')

const state = {
  user: null,
  tab: 'lectures',
  data: null,
  q: '',
  from: '',
  filter: 'upcoming',
}

const statusFi = {
  planned: 'suunniteltu',
  confirmed: 'vahvistettu',
  done: 'pidetty',
  declined: 'ei sovi',
  deferred: 'siirretty',
}
const kindFi = {
  talk: 'Esitelmä',
  circuit_week: 'Kierrosviikko',
  memorial: 'Muistojuhla',
  circuit_convention: 'Kierroskokous',
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Virhe ${res.status}`)
  return data
}

function toast(msg) {
  let t = $('#toast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'toast'
    t.className = 'toast'
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.classList.add('on')
  setTimeout(() => t.classList.remove('on'), 2200)
}

function byId(list, id) {
  return (list || []).find((x) => x.id === id) || null
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })
}

async function boot() {
  try {
    const me = await api('/me')
    state.user = me.user
    state.data = await api('/bootstrap')
    renderApp()
  } catch {
    state.user = null
    renderLogin()
  }
}

function renderLogin(err = '') {
  app.innerHTML = `
    <div class="login-wrap">
      <main class="login-card">
        <p class="brand">Vuoro</p>
        <h1>Kirjaudu sisään</h1>
        <p class="lede">Sunnuntaiesitelmien suunnittelu — data Renderissä, sama varmuuskopio kuin Netlifyssä.</p>
        ${err ? `<p class="err">${esc(err)}</p>` : ''}
        <form id="loginForm">
          <label>Käyttäjätunnus
            <input name="username" autocomplete="username" required value="${esc(localStorage.getItem('vuoro-login-user') || '')}" />
          </label>
          <label>Salasana
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <label class="remember"><input type="checkbox" name="remember" checked /> Muista minut tällä laitteella</label>
          <button class="btn primary" type="submit">Kirjaudu</button>
        </form>
      </main>
    </div>`
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    try {
      const username = String(fd.get('username') || '').trim()
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password: fd.get('password'),
          remember: !!fd.get('remember'),
        }),
      })
      if (fd.get('remember')) localStorage.setItem('vuoro-login-user', username)
      await boot()
    } catch (err2) {
      renderLogin(err2.message)
    }
  }
}

function renderApp() {
  const d = state.data
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <p class="brand">Vuoro</p>
        <span class="muted">${esc(d.settings?.eventName || 'Esitelmä')} · ${esc(state.user.name)}</span>
        <span class="spacer"></span>
        <button class="btn small" id="logoutBtn">Kirjaudu ulos</button>
      </header>
      <nav class="tabs">
        ${tabBtn('lectures', 'Esitelmät')}
        ${tabBtn('speakers', 'Puhujat')}
        ${tabBtn('themes', 'Teemat')}
        ${tabBtn('people', 'Pj & lukijat')}
        ${tabBtn('settings', 'Asetukset')}
      </nav>
      <section class="panel" id="panel"></section>
    </div>`
  $('#logoutBtn').onclick = async () => {
    await api('/logout', { method: 'POST' })
    renderLogin()
  }
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      state.tab = b.dataset.tab
      renderApp()
    }
  })
  renderPanel()
}

function tabBtn(id, label) {
  return `<button data-tab="${id}" class="${state.tab === id ? 'on' : ''}">${label}</button>`
}

function renderPanel() {
  const panel = $('#panel')
  if (state.tab === 'lectures') return renderLectures(panel)
  if (state.tab === 'speakers') return renderSpeakers(panel)
  if (state.tab === 'themes') return renderThemes(panel)
  if (state.tab === 'people') return renderPeople(panel)
  return renderSettings(panel)
}

function renderLectures(panel) {
  const today = new Date().toISOString().slice(0, 10)
  let list = [...state.data.lectures]
  if (state.filter === 'upcoming') list = list.filter((l) => l.date >= today)
  if (state.filter === 'past') list = list.filter((l) => l.date < today)
  if (state.q) {
    const q = state.q.toLowerCase()
    list = list.filter((l) => {
      const theme = byId(state.data.themes, l.themeId)
      const sp = byId(state.data.speakers, l.speakerId)
      const ch = byId(state.data.chairpersons, l.chairpersonId)
      const rd = byId(state.data.readers, l.readerId)
      return [l.date, l.status, l.customTitle, theme?.name, theme?.number, sp?.name, ch?.name, rd?.name]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }
  list.sort((a, b) => a.date.localeCompare(b.date))

  panel.innerHTML = `
    <h2 class="sec-title">Esitelmät (${list.length})</h2>
    <div class="toolbar">
      <input id="q" type="search" placeholder="Hae…" value="${esc(state.q)}" style="max-width:220px" />
      <select id="filter">
        <option value="upcoming" ${state.filter === 'upcoming' ? 'selected' : ''}>Tulevat</option>
        <option value="past" ${state.filter === 'past' ? 'selected' : ''}>Menneet</option>
        <option value="all" ${state.filter === 'all' ? 'selected' : ''}>Kaikki</option>
      </select>
      <button class="btn primary small" id="addLec">+ Uusi</button>
    </div>
    <div class="list" id="lecList"></div>`

  $('#q').oninput = (e) => {
    state.q = e.target.value
    renderPanel()
  }
  $('#filter').onchange = (e) => {
    state.filter = e.target.value
    renderPanel()
  }
  $('#addLec').onclick = async () => {
    const date = prompt('Päivä (YYYY-MM-DD)', today)
    if (!date) return
    try {
      const created = await api('/lectures', { method: 'POST', body: JSON.stringify({ date }) })
      state.data.lectures.push(created)
      toast('Esitelmä lisätty')
      renderPanel()
    } catch (e) {
      toast(e.message)
    }
  }

  const wrap = $('#lecList')
  wrap.innerHTML = list
    .map((l) => {
      const theme = byId(state.data.themes, l.themeId)
      const sp = byId(state.data.speakers, l.speakerId)
      const ch = byId(state.data.chairpersons, l.chairpersonId)
      const rd = byId(state.data.readers, l.readerId)
      const title =
        l.eventKind === 'talk'
          ? `${theme?.number ? theme.number + ' · ' : ''}${theme?.name || l.customTitle || 'Teema auki'}`
          : `${kindFi[l.eventKind] || l.eventKind}${l.customTitle ? ' · ' + l.customTitle : ''}`
      return `<article class="row" data-id="${l.id}">
        <div><span class="pill ${esc(l.status)}">${statusFi[l.status] || l.status}</span>
          <span class="pill">${kindFi[l.eventKind] || l.eventKind}</span></div>
        <h3>${esc(fmtDate(l.date))}</h3>
        <div>${esc(title)}</div>
        <div class="meta">🎤 ${esc(sp?.name || '—')} · 🪑 ${esc(ch?.name || '—')} · 📖 ${esc(rd?.name || '—')}</div>
        <div class="actions">
          <button class="btn small" data-act="status">Tila</button>
          <button class="btn small" data-act="speaker">Puhuja</button>
          <button class="btn small" data-act="theme">Teema</button>
          <button class="btn small" data-act="chair">Pj</button>
          <button class="btn small" data-act="reader">Lukija</button>
          <button class="btn small" data-act="msg">Viesti</button>
        </div>
      </article>`
    })
    .join('') || `<p class="muted">Ei esitelmiä.</p>`

  wrap.onclick = async (e) => {
    const btn = e.target.closest('[data-act]')
    const row = e.target.closest('[data-id]')
    if (!btn || !row) return
    const lec = byId(state.data.lectures, row.dataset.id)
    if (!lec) return
    try {
      if (btn.dataset.act === 'status') {
        const next = pick(
          Object.keys(statusFi),
          lec.status,
          (k) => statusFi[k],
        )
        if (!next) return
        Object.assign(lec, await api(`/lectures/${lec.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) }))
      }
      if (btn.dataset.act === 'speaker') {
        const id = pickId(state.data.speakers, lec.speakerId, (s) => s.name)
        if (id === undefined) return
        Object.assign(
          lec,
          await api(`/lectures/${lec.id}`, { method: 'PUT', body: JSON.stringify({ speakerId: id }) }),
        )
      }
      if (btn.dataset.act === 'theme') {
        const id = pickId(state.data.themes.filter((t) => !t.disabled), lec.themeId, (t) => `${t.number || ''} ${t.name}`)
        if (id === undefined) return
        Object.assign(
          lec,
          await api(`/lectures/${lec.id}`, { method: 'PUT', body: JSON.stringify({ themeId: id }) }),
        )
      }
      if (btn.dataset.act === 'chair') {
        const id = pickId(state.data.chairpersons, lec.chairpersonId, (c) => c.name)
        if (id === undefined) return
        Object.assign(
          lec,
          await api(`/lectures/${lec.id}`, {
            method: 'PUT',
            body: JSON.stringify({ chairpersonId: id }),
          }),
        )
      }
      if (btn.dataset.act === 'reader') {
        const id = pickId(state.data.readers, lec.readerId, (r) => r.name)
        if (id === undefined) return
        Object.assign(
          lec,
          await api(`/lectures/${lec.id}`, { method: 'PUT', body: JSON.stringify({ readerId: id }) }),
        )
      }
      if (btn.dataset.act === 'msg') {
        const sp = byId(state.data.speakers, lec.speakerId)
        const theme = byId(state.data.themes, lec.themeId)
        const tpl =
          state.data.settings?.messageTemplate ||
          'Hei {{nimi}}!\n\nOlisiko sinun mahdollista pitää esitelmä nr. {{numero}} {{teema}} {{päivä}}?'
        const text = tpl
          .replaceAll('{{nimi}}', sp?.name || '')
          .replaceAll('{{numero}}', theme?.number || '')
          .replaceAll('{{teema}}', theme?.name || '')
          .replaceAll('{{päivä}}', fmtDate(lec.date))
        await navigator.clipboard.writeText(text)
        toast('Viesti kopioitu')
        return
      }
      renderPanel()
    } catch (err) {
      toast(err.message)
    }
  }
}

function pick(keys, current, labelFn) {
  const lines = keys.map((k, i) => `${i + 1}. ${labelFn(k)}${k === current ? ' ←' : ''}`).join('\n')
  const ans = prompt(`Valitse numero:\n${lines}`, '')
  if (ans == null || ans === '') return null
  const idx = Number(ans) - 1
  return keys[idx] || null
}

function pickId(items, current, labelFn) {
  const keys = [null, ...items.map((x) => x.id)]
  const lines = keys
    .map((id, i) => `${i}. ${id ? labelFn(byId(items, id)) : '— tyhjä —'}${id === current ? ' ←' : ''}`)
    .join('\n')
  const ans = prompt(`Valitse numero:\n${lines.slice(0, 3500)}`, '')
  if (ans == null || ans === '') return undefined
  const idx = Number(ans)
  if (Number.isNaN(idx) || idx < 0 || idx >= keys.length) return undefined
  return keys[idx]
}

function renderSpeakers(panel) {
  const q = state.q.toLowerCase()
  const list = state.data.speakers.filter((s) =>
    !q || `${s.name} ${s.congregation} ${s.phone}`.toLowerCase().includes(q),
  )
  panel.innerHTML = `
    <h2 class="sec-title">Puhujat (${list.length}/${state.data.speakers.length})</h2>
    <div class="toolbar"><input id="q" type="search" placeholder="Hae puhujaa…" value="${esc(state.q)}" style="max-width:260px" /></div>
    <div class="list">${list
      .map(
        (s) => `<article class="row">
      <h3>${esc(s.name)}${s.assistant ? ' <span class="pill">apupuhuja</span>' : ''}${s.unavailable ? ' <span class="pill declined">ei käytettävissä</span>' : ''}</h3>
      <div class="meta">${esc(s.congregation || '—')} · ${esc(s.phone || '—')} · aiheet: ${(s.outlines || []).join(', ') || '—'}</div>
      ${s.notes ? `<div class="meta">${esc(s.notes)}</div>` : ''}
    </article>`,
      )
      .join('')}</div>`
  $('#q').oninput = (e) => {
    state.q = e.target.value
    renderPanel()
  }
}

function renderThemes(panel) {
  const q = state.q.toLowerCase()
  const list = state.data.themes.filter(
    (t) => !q || `${t.number} ${t.name}`.toLowerCase().includes(q),
  )
  panel.innerHTML = `
    <h2 class="sec-title">Teemat (${list.length})</h2>
    <div class="toolbar"><input id="q" type="search" placeholder="Hae teemaa…" value="${esc(state.q)}" style="max-width:260px" /></div>
    <div class="list">${list
      .map(
        (t) => `<article class="row">
      <h3>${esc(t.number || '—')} · ${esc(t.name)}${t.disabled ? ' <span class="pill declined">pois</span>' : ''}</h3>
      ${t.notes ? `<div class="meta">${esc(t.notes)}</div>` : ''}
    </article>`,
      )
      .join('')}</div>`
  $('#q').oninput = (e) => {
    state.q = e.target.value
    renderPanel()
  }
}

function renderPeople(panel) {
  panel.innerHTML = `
    <h2 class="sec-title">Puheenjohtajat</h2>
    <div class="list" style="margin-bottom:1.2rem">${state.data.chairpersons
      .map(
        (c) => `<article class="row"><h3>${esc(c.name)}</h3><div class="meta">${esc(c.phone || '—')}${c.alsoReads ? ' · lukee myös' : ''}</div></article>`,
      )
      .join('')}</div>
    <h2 class="sec-title">Lukijat</h2>
    <div class="list">${state.data.readers
      .map(
        (r) => `<article class="row"><h3>${esc(r.name)}</h3><div class="meta">${esc(r.phone || '—')}</div></article>`,
      )
      .join('')}</div>`
}

function renderSettings(panel) {
  const isAdmin = state.user.role === 'admin'
  panel.innerHTML = `
    <h2 class="sec-title">Asetukset & varmuuskopio</h2>
    <p class="meta">Tuonti korvaa nykyisen datan Netlify-varmuuskopiolla (<code>vuoro-backup</code>).</p>
    <div class="actions" style="margin:1rem 0">
      <button class="btn primary" id="exportBtn">⬇ Lataa varmuuskopio</button>
      ${isAdmin ? `<label class="btn">⬆ Tuo varmuuskopio<input id="importFile" type="file" accept="application/json,.json" hidden /></label>` : '<span class="muted">Tuonti vain ylläpitäjälle</span>'}
    </div>
    <h3 class="sec-title" style="font-size:1.1rem">PDF-arkisto (${state.data.pdfArchives.length})</h3>
    <div class="list">${state.data.pdfArchives
      .map(
        (p) => `<article class="row">
      <h3>${esc(p.filename || p.id)}</h3>
      <div class="meta">${esc(p.fromDate || '')} – ${esc(p.toDate || '')} · ${p.entryCount || 0} riviä</div>
      <div class="actions"><a class="btn small" href="/api/pdf-archives/${p.id}">Lataa PDF</a></div>
    </article>`,
      )
      .join('') || '<p class="muted">Ei PDF-arkistoja.</p>'}</div>
    ${
      isAdmin
        ? `<h3 class="sec-title" style="font-size:1.1rem;margin-top:1.2rem">Käyttäjät</h3>
      <div class="grid2">
        <input id="nu" placeholder="tunnus" />
        <input id="nn" placeholder="nimi" />
        <input id="np" type="password" placeholder="salasana (min. 6)" />
        <button class="btn primary" id="addUser">Lisää käyttäjä</button>
      </div>
      <div class="list" id="userList" style="margin-top:.8rem"></div>`
        : ''
    }`

  $('#exportBtn').onclick = async () => {
    const res = await fetch('/api/backup/export', { credentials: 'include' })
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `vuoro-varmuuskopio_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  const file = $('#importFile')
  if (file) {
    file.onchange = async () => {
      const f = file.files?.[0]
      if (!f) return
      try {
        const json = JSON.parse(await f.text())
        const out = await api('/backup/import', { method: 'POST', body: JSON.stringify(json) })
        toast(`Tuotu: ${out.stats.lectures} esitelmää`)
        state.data = await api('/bootstrap')
        renderApp()
      } catch (e) {
        toast(e.message)
      }
    }
  }
  if (isAdmin) {
    loadUsers()
    $('#addUser').onclick = async () => {
      try {
        await api('/users', {
          method: 'POST',
          body: JSON.stringify({
            username: $('#nu').value.trim(),
            name: $('#nn').value.trim(),
            password: $('#np').value,
            role: 'editor',
          }),
        })
        toast('Käyttäjä lisätty')
        loadUsers()
      } catch (e) {
        toast(e.message)
      }
    }
  }
}

async function loadUsers() {
  const el = $('#userList')
  if (!el) return
  try {
    const users = await api('/users')
    el.innerHTML = users
      .map((u) => `<article class="row"><h3>${esc(u.name)}</h3><div class="meta">${esc(u.username)} · ${esc(u.role)}</div></article>`)
      .join('')
  } catch (e) {
    el.textContent = e.message
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

boot()
