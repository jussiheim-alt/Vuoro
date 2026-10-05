# Vuoro (esitelmät) — julkaisu Renderiin

## Kirjautuminen

Render-palvelun URL (Dashboard → Vuoro → yläreunan linkki).

Ensimmäinen tunnus: `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Ympäristömuuttujat

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |
| `JWT_SECRET` | pitkä satunnainen |
| `ADMIN_USERNAME` | esim. `jussi` |
| `ADMIN_PASSWORD` | vahva salasana |
| `ADMIN_NAME` | `Jussi Heimonen` |

## Levy

Disks → Mount Path **`/var/data`** (1 GB).

## Varmuuskopio Netlifystä

Repo sisältää kevyen siemendatan (esitelmät/puhujat/teemat **ilman PDF-blobia**), joka tuodaan automaattisesti tyhjään kantaan.

PDF-arkistot: kirjaudu → **Asetukset → Tuo varmuuskopio** → valitse Netlify-tiedosto `vuoro-varmuuskopio_….json`.

Jos Render kaatui exit 134: vanha deploy yritti ladata kaikki PDF:t bootissa. Uusi versio korjaa tämän — merge / redeploy.

## Blueprint

`render.yaml` — Web Service + disk `/var/data`.
