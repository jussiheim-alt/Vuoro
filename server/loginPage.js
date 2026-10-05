function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function loginPageHtml(opts = {}) {
  const error = opts.error
    ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>`
    : ''
  const user = escapeHtml(opts.userPrefill || '')
  const next = escapeHtml(opts.nextPath || '/')
  const rememberChecked = opts.remember === false ? '' : ' checked'

  return `<!doctype html>
<html lang="fi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#1B3D36" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Vuoro — kirjaudu</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --pine: #1b3d36;
      --accent: #c45c26;
      --ink: #14241f;
      --ink-soft: #3d534b;
      --muted: #6a7f76;
      --line: rgba(20, 36, 31, 0.14);
      --surface: rgba(247, 251, 247, 0.92);
      --font-display: "Fraunces", Georgia, serif;
      --font-body: "Figtree", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      font-family: var(--font-body);
      color: #e8f0e9;
      background:
        radial-gradient(120% 80% at 8% 0%, #2a5a4c 0%, transparent 55%),
        radial-gradient(90% 60% at 100% 10%, rgba(196, 92, 38, 0.28) 0%, transparent 50%),
        linear-gradient(165deg, #1b3d36 0%, #0f241f 55%, #1a322c 100%);
      display: grid;
      place-items: center;
      padding: max(1.25rem, env(safe-area-inset-top)) 1.25rem max(1.25rem, env(safe-area-inset-bottom));
    }
    .card {
      width: min(100%, 26rem);
      background: var(--surface);
      color: var(--ink);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 1.6rem 1.35rem 1.5rem;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
      animation: rise 0.45s ease both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .brand {
      font-family: var(--font-display);
      font-size: clamp(2.4rem, 8vw, 3rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--pine);
      line-height: 0.95;
      margin: 0 0 0.35rem;
    }
    h1 {
      font-family: var(--font-display);
      font-size: 1.45rem;
      margin: 0 0 0.35rem;
      color: var(--pine);
    }
    .lede {
      margin: 0 0 1.25rem;
      color: var(--ink-soft);
      line-height: 1.45;
      font-size: 0.98rem;
    }
    form { display: grid; gap: 0.85rem; }
    label {
      display: grid;
      gap: 0.35rem;
      font-size: 0.85rem;
      font-weight: 650;
      color: var(--ink-soft);
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 0.8rem 0.9rem;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }
    input:focus {
      outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
      outline-offset: 1px;
      border-color: var(--accent);
    }
    .remember {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      color: var(--ink-soft);
      font-weight: 600;
      font-size: 0.95rem;
      user-select: none;
    }
    .remember input { width: 1.1rem; height: 1.1rem; accent-color: var(--pine); }
    .err {
      margin: 0;
      color: #9b2f2f;
      background: #f3dede;
      border-radius: 10px;
      padding: 0.65rem 0.8rem;
      font-size: 0.92rem;
      font-weight: 600;
    }
    button[type="submit"] {
      appearance: none;
      border: none;
      border-radius: 12px;
      background: var(--accent);
      color: #fff8f3;
      font: inherit;
      font-weight: 700;
      padding: 0.9rem 1.1rem;
      cursor: pointer;
    }
    .hint {
      margin: 0.15rem 0 0;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <main class="card">
    <p class="brand">Vuoro</p>
    <h1>Kirjaudu sisään</h1>
    <p class="lede">Sunnuntaiesitelmien suunnittelu — tunnukset muistetaan tällä laitteella.</p>
    ${error}
    <form method="post" action="/__vuoro_login" autocomplete="on">
      <input type="hidden" name="next" value="${next}" />
      <label>
        Käyttäjätunnus
        <input
          name="username"
          type="text"
          inputmode="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          value="${user}"
        />
      </label>
      <label>
        Salasana
        <input
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <label class="remember">
        <input type="checkbox" name="remember" value="1"${rememberChecked} />
        Muista minut tällä laitteella
      </label>
      <button type="submit">Kirjaudu</button>
      <p class="hint">Valinta pitää sinut kirjautuneena noin puoli vuotta. Voit kirjautua ulos Asetuksista.</p>
    </form>
  </main>
  <script>
    try {
      var saved = localStorage.getItem('vuoro-login-user');
      var input = document.querySelector('input[name="username"]');
      if (saved && input && !input.value) input.value = saved;
      document.querySelector('form').addEventListener('submit', function () {
        var u = document.querySelector('input[name="username"]').value.trim();
        var remember = document.querySelector('input[name="remember"]').checked;
        if (remember && u) localStorage.setItem('vuoro-login-user', u);
      });
    } catch (e) {}
  </script>
</body>
</html>`
}
