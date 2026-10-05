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

Tiedosto muodossa `vuoro-backup` (kuten `vuoro-varmuuskopio_….json`):

1. Kirjaudu Render-Vuoroon adminina
2. **Asetukset → Tuo varmuuskopio**
3. Valitse JSON-tiedosto

Tai laita tiedosto palvelimen `data/vuoro-varmuuskopio.json` -polkuun ennen ekaa käynnistystä (tyhjä kanta tuo sen automaattisesti).

## Blueprint

`render.yaml` — Web Service + disk `/var/data`.
