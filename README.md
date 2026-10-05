# Vuoro

Monikäyttäjäinen ajanvaraus — treenit, varaukset, jonotus ja sijaisuus. Useita yrityksiä (tenantteja) samassa palvelussa.

**Tuotanto (Render):** https://vuoro.onrender.com  
**Vanha demosivu (Netlify):** https://vuoro.netlify.app

## Ominaisuudet

- Kalenteri (päivä / viikko / kuukausi) + tulevat treenit
- Asiakasvaraukset, hyväksyntä, jonotus ja vahvistus
- Valmentajan sijaisuuspyyntö + chat
- Asiakkaan “en pääse” -sijaispyynnöt
- Yrityskohtainen brändiväri ja logo
- Kutsut (owner / coach) ja superadmin-hallinta

## Pysyvä käyttö (Render)

Katso **[JULKAISU.md](./JULKAISU.md)**. Lyhyesti:

1. Render → Blueprint → tämä repo (`render.yaml`)
2. **Starter** + persistent disk `/var/data`
3. `APP_PUBLIC_URL=https://vuoro.onrender.com`, `FIREBASE_PROJECT_ID=vuoro-app`

## Paikallinen kehitys

```bash
npm install
export AUTH_DISABLED=true SEED_DEMO=true
npm run dev
```

Avaa http://localhost:8788

DEV-tilassa yläpalkin **Valmentaja** / **Asiakas** vaihtaa identiteettiä ilman Firebasea.

## Rakenne

```
public/          # selain-UI (staattinen)
server/          # Express API + SQLite
render.yaml      # Render Blueprint
```

API: `/api/*` · terveys: `/api/health`
