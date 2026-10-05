# Vuoro (esitelmät) — julkaisu Renderiin

## Tärkeää: Web Service, ei Private Service

Palvelun tyypin pitää olla **Web Service** (julkinen URL).  
Private Service ei aukea selaimella.

## Kirjautuminen

Render-palvelun URL (Dashboard → Vuoro → yläreunan linkki), esim. `https://vuoro-….onrender.com`.

Tunnus: `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Ympäristömuuttujat

| Key | Value |
|-----|--------|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |
| `JWT_SECRET` | pitkä satunnainen |
| `ADMIN_USERNAME` | esim. `jussi` |
| `ADMIN_PASSWORD` | vahva salasana |
| `ADMIN_NAME` | `Jussi Heimonen` |

## Levy

Disks → Mount Path **`/var/data`** (1 GB).

## Varmuuskopio Netlifystä

Repo sisältää kevyen siemendatan (esitelmät/puhujat/teemat ilman PDF-blobia).

PDF-arkistot: kirjaudu → **Asetukset → Tuo varmuuskopio** → Netlify-JSON.

## Blueprint

`render.yaml` — Web Service + disk `/var/data`. Käyttää Node 22 + `node:sqlite` (ei better-sqlite3).
