# Vuoro — esitelmäassistentti

Selainohjelma sunnuntaisten esitelmien suunnitteluun. Toimii myös **asennettavana sovelluksena** puhelimen kotinäytöllä (PWA).

**Nykyinen osoite (Netlify):** https://vuoro-vaaksy.netlify.app  

Render-julkaisun jälkeen käytä Renderin osoitetta. Sovellus näyttää Asetuksissa aina sen osoitteen, jolla se on auki.

## Mitä se tekee

1. **Teema- ja puhujalistat** — CSV tai Excel
2. **Suositus** — ehdottaa teemaa ja puhujaa (pisimpään käyttämättä / aihe / seurakunta)
3. **WhatsApp-kutsu** — avaa valmiin viestin (`wa.me`)
4. **PDF-ohjelma** — vie vahvistetut esitelmät ja erikoistapahtumat
5. **Käyttäjät** — ylläpitäjä voi lisätä tunnuksia (Render / oma palvelin)

## Käynnistys (kehitys)

```bash
npm install
npm run dev
```

Tuotantopalvelin paikallisesti (build + Express, monikäyttäjäkirjautuminen):

```bash
npm run build
ADMIN_USERNAME=vuoro ADMIN_PASSWORD='salasana' SESSION_SECRET='pitka-satunnainen' npm start
```

Avaa http://localhost:10000 — kirjautumissivu tulee vastaan. Asetukset → Käyttäjät: lisää uusia tunnuksia.

## Julkaisu GitHubiin + Renderiin

1. Luo yksityinen GitHub-repositorio (esim. `vuoro`) ja työnnä tämä koodi sinne.
2. Render Dashboard → **New → Blueprint** (tai Web Service) → valitse repositorio.
   - `render.yaml` on valmiina: Node 22, build `npm ci && npm run build`, start `npm start`, levy `/var/data`.
3. Aseta ympäristömuuttujat Renderissä:
   - `ADMIN_PASSWORD` — ensimmäisen ylläpitäjän salasana (pakollinen)
   - `ADMIN_USERNAME` — oletus `vuoro`
   - `SESSION_SECRET` — pitkä satunnainen merkkijono (Blueprint voi generoida)
4. Deploy. Osoite tulee muotoon `https://vuoro.onrender.com` (tai custom domain).
5. Kirjaudu admin-tunnuksella → **Asetukset → Käyttäjät** → lisää muut käyttäjät.

Netlify-versio toimii edelleen; Render-siirron jälkeen voit ohjata käyttäjät uuteen osoitteeseen.

## Asennus puhelimeen (sovellus)

1. Avaa tuotanto-osoite Safarissa / Chromessa.
2. **Android:** valikko → *Asenna sovellus* / *Lisää aloitusnäytölle*.
3. **iPhone:** Jaa → *Lisää Koti-valikkoon*.

## Tietosuoja

Nimet ja puhelinnumerot ovat henkilötietoja. Synkronoitu kopio tallentuu palvelimen levyyn (`DATA_DIR`). Organisaatio on rekisterinpitäjä. Katso Asetukset → Tietosuoja.
