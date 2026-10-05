# Vuoro — sunnuntaiesitelmien suunnittelu (Vääksy)

**Tuotanto (Render):** palvelun URL dashboardissa (esim. `https://vuoro-….onrender.com`)  
**Vanha Netlify:** https://vuoro-vaaksy.netlify.app

## Käyttö Renderissä

1. Merge PR / deploy
2. Environment:
   - `ADMIN_USERNAME` + `ADMIN_PASSWORD` (min. 6)
   - `JWT_SECRET` (pitkä satunnainen)
   - `DATA_DIR=/var/data`
   - Disk mount: `/var/data`
3. Avaa palvelun URL → kirjaudu admin-tunnuksella
4. Jos data ei tullut automaattisesti: **Asetukset → Tuo varmuuskopio** (`vuoro-backup` JSON)

## Paikallisesti

```bash
npm install
export ADMIN_USERNAME=jussi ADMIN_PASSWORD=salasana123 JWT_SECRET=dev
# varmuuskopio polussa data/vuoro-varmuuskopio.json
npm run dev
```

Avaa http://localhost:8788
