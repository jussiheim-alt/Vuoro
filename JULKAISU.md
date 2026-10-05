# Vuoro — julkaisu Renderiin

## Julkinen osoite

**https://vuoro.onrender.com**

(Frontend + API samassa palvelussa. Vanha Netlify-demo: https://vuoro.netlify.app)

## Levy (pakollinen pysyvälle datalle)

Jos palvelu luotiin ilman Blueprintiä, lisää levy käsin:

1. Render → palvelu **vuoro** → **Disks**
2. **Add Disk**
3. Name: `vuoro-data`
4. Mount Path: **`/var/data`**
5. Size: 1 GB
6. Save → redeploy

Ilman levyä sovellus käynnistyy kyllä (`./data`-fallback), mutta SQLite nollautuu jokaisessa deployssa.

## Jos deploy kaatuu (`tsx: not found`)

`tsx` on `dependencies`-osiossa (ei vain dev). Manual Deploy → latest commit `main`ista.

## Blueprint (`render.yaml`)

1. Pushaa tämä repo GitHubiin (`main` tai merge PR)
2. Render Dashboard → **New** → **Blueprint** → valitse `jussiheim-alt/Vuoro`
3. `render.yaml` luo Web Servicen + 1 GB diskin (`/var/data`)
4. Deployin jälkeen:
   - Avaa https://vuoro.onrender.com
   - Kirjaudu Firebase-tunnuksella (projekti `vuoro-app`) tai rekisteröidy
   - Superadmin / omistaja: kutsu valmentajat **Hallinta**-näkymästä

Jos palvelu `vuoro` on jo olemassa mutta suspendoituna: Dashboard → Resume → Manual Deploy → latest commit. Kytke GitHub-repo tähän repoon (Settings → Build & Deploy → connect `jussiheim-alt/Vuoro`).

## Ympäristömuuttujat

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |
| `APP_PUBLIC_URL` | `https://vuoro.onrender.com` |
| `FIREBASE_PROJECT_ID` | `vuoro-app` |
| `AUTH_DISABLED` | `false` (tuotanto) |
| `SEED_DEMO` | `true` ensimmäisellä deploylla (luo TrainWithMarjo + Studio Flow) |
| `SUPERADMIN_EMAIL` | sinun sähköposti — ensimmäinen Firebase-rekisteröityminen tällä osoitteella → superadmin |

## Monikäyttäjyys

- **Superadmin** — hallitsee kaikkia yrityksiä (tenanteja)
- **Owner / coach** — yrityksen treenit, hyväksynnät, kutsut
- **Customer** — varaukset, jonotus, sijaispyynnöt
- Kutsulinkit: `/?invite=<token>`

Data (SQLite) säilyy levyllä redeployjen yli.

## Paikallinen kehitys

```bash
npm install
export AUTH_DISABLED=true SEED_DEMO=true
npm run dev
```

Avaa http://localhost:8788 — DEV-tilassa valitse yläpalkista Valmentaja / Asiakas.
