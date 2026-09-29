# wordsuper

Word-alapú AI-asszisztens tanácsadóknak: Office-bővítmény (munkaablak) és egy kis Node-szerver, amely az AI-modellt hívja.

A projekt a `word-add-in` repó `v1.1.0` zárványából indult (commit `8a18363`).

## Mit tud

- **Asszisztens:** szerkesztés korrektúrával (csak a módosított szavak cserélődnek, a formázás megmarad), vélemény megjegyzésként, szöveg generálása, a teljes dokumentum átvizsgálása. Minden javaslat előnézettel jön, finomítható, leállítható.
- **Szerkezet:** definiált fogalmak és kereszthivatkozások AI nélkül; a kurzor alatti fogalom definíciója vagy a hivatkozott pont szövege görgetés nélkül látszik; problémalista (nem használt, kétszer definiált, hibás hivatkozás).
- **Összevetés:** egy korábbi változat (.docx) és a megnyitott dokumentum különbségei, AI-értékeléssel (összefoglaló, kockázat, javaslat) és megjegyzésekkel a változásoknál.
- **Átláthatóság:** minden válasznál látszik, mit kapott az AI, hogyan gondolkodott, melyik modell válaszolt és hol; élő korlátjelző.

## Indítás

```bash
npm ci
cp .env.example .env   # állítsd be legalább az APP_ACCESS_KEY-t (min. 16 karakter) és a GEMINI_API_KEY-t
npm run dev            # http://localhost:3000
```

A böngészőben megnyitott oldal letölthető `manifest.xml`-t és telepítési útmutatót ad a Wordhöz.

| Parancs | Mit csinál |
|---|---|
| `npm run lint` | TypeScript-ellenőrzés |
| `npm test` | egységtesztek (Node beépített tesztfuttatója) |
| `npm run build` | production build (`dist/`) |

A környezeti változók leírása: [.env.example](.env.example). Vertex AI-jal EU-régióban: `AI_PROVIDER=vertex`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.

## Fázisok

| Fázis | Tartalom | Állapot |
|---|---|---|
| 0. Alapozás | code review javítások, modell-adapterréteg (Gemini API / Vertex AI EU) | kész |
| I. Tárgyalás és szerkezet | definíciók és kereszthivatkozások, verziók összevetése | kész |
| II. Biztonság és költség | Microsoft-fiókos belépés, anonimizálás, gyorsítótár, költség ügyfélcímkénként | következik |
| III. Jogi pontosság | magyar jogi sajátosságok, jogszabály-hivatkozások ellenőrzése, összevetés csatolt forrásokkal | |
| IV. Intelligencia | szabálykönyvek és témánkénti átvizsgálás, színkód, csomagos javaslat, receptek, kimenetek | |
