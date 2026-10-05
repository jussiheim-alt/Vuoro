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
  <meta name="theme-color" content="#0F3D34" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Vuoro — kirjaudu</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --pine: #0f3d34;
      --pine-mid: #1a5c4e;
      --accent: #178a72;
      --ink: #0e1c19;
      --ink-soft: #3a4f4a;
      --muted: #667a74;
      --line: rgba(14, 28, 25, 0.12);
      --surface: rgba(245, 248, 249, 0.94);
      --font-display: "Fraunces", Georgia, serif;
      --font-body: "Plus Jakarta Sans", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      font-family: var(--font-body);
      color: #e8f0e9;
      background:
        radial-gradient(120% 80% at 8% 0%, #1a5c4e 0%, transparent 55%),
        radial-gradient(90% 60% at 100% 10%, rgba(23, 138, 114, 0.28) 0%, transparent 50%),
        linear-gradient(165deg, #0f3d34 0%, #0a241f 55%, #14352f 100%);
      display: grid;
      place-items: center;
      padding: max(1.25rem, env(safe-area-inset-top)) 1.25rem max(1.25rem, env(safe-area-inset-bottom));
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.25;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
      background-size: 180px 180px;
      mix-blend-mode: soft-light;
    }
    .card {
      position: relative;
      z-index: 1;
      width: min(100%, 26rem);
      background: var(--surface);
      color: var(--ink);
      border: 1px solid rgba(255,255,255,0.55);
      border-radius: 20px;
      padding: 1.75rem 1.4rem 1.55rem;
      box-shadow: 0 28px 64px rgba(0, 0, 0, 0.32);
      animation: rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
      backdrop-filter: blur(12px);
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .brand {
      font-family: var(--font-display);
      font-size: clamp(2.6rem, 8vw, 3.2rem);
      font-weight: 700;
      letter-spacing: -0.04em;
      color: var(--pine);
      line-height: 0.92;
      margin: 0 0 0.4rem;
    }
    h1 {
      font-family: var(--font-display);
      font-size: 1.4rem;
      margin: 0 0 0.35rem;
      color: var(--pine);
      letter-spacing: -0.02em;
    }
    .lede {
      margin: 0 0 1.3rem;
      color: var(--ink-soft);
      line-height: 1.45;
      font-size: 0.98rem;
      font-weight: 500;
    }
    form { display: grid; gap: 0.9rem; }
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
      border-radius: 10px;
      padding: 0.85rem 0.95rem;
      font: inherit;
      color: var(--ink);
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
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
      border-radius: 10px;
      background: var(--accent);
      color: #f4fffb;
      font: inherit;
      font-weight: 700;
      padding: 0.95rem 1.1rem;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(23, 138, 114, 0.28);
      transition: filter 0.15s ease, transform 0.15s ease;
    }
    button[type="submit"]:hover { filter: brightness(1.05); }
    button[type="submit"]:active { transform: translateY(1px); }
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
