# Word Writer – adatvédelmi tájékoztató ügyvédeknek

*ICT Europa Legal · 2026. szeptember · a `phase-1` változat alapján. A tájékoztató a rendszer műszaki működését írja le; nem jogi vélemény. A Google-feltételekre vonatkozó állításokat a hivatkozott oldalak aktuális szövegével kell összevetni.*

## 1. Röviden

| Kérdés | Válasz |
|---|---|
| Hová kerül a szerződés szövege? | A saját szerverünkre, onnan a beállított AI-szolgáltatóhoz: **Vertex AI, EU-régió** (ajánlott) vagy Gemini API. Máshová nem. |
| Látja az AI a neveket, cégeket, azonosítókat? | **Alapból nem.** Küldés előtt a gépen helyettesítőkre cseréljük őket (`[CÉG_1]`, `[SZEMÉLY_2]`…), a választ a gépen cseréljük vissza. |
| Használja a Google a tanításhoz? | Vertex AI-n és a fizetős Gemini API-n **nem**. Az **ingyenes** Gemini API-n **igen**, és emberi ellenőrök is olvashatják: ügyféladathoz tilos. |
| Mi marad meg a szerveren? | Csak auditnapló, **tartalom nélkül** (ki, mikor, mit, mekkora méretben, melyik modellel, hány tokenből). |
| A diktálás hangja? | Alapból **a gépen marad**: a beszédfelismerő a munkaablakban fut. Felhős diktálás Vertex AI EU mellett szabad; máshol csak a felhasználó kifejezett, saját felelősségű elfogadásával (az üzemeltető letilthatja). |
| Kerül-e bármi a dokumentumba jóváhagyás nélkül? | Nem. Minden javaslat előnézettel jön, és korrektúrával (Track Changes) vagy megjegyzésként kerül be. |

## 2. Az adat útja

1. **Word (a felhasználó gépe):** a munkaablak kiolvassa a kijelölést vagy a dokumentumot.
2. **Helyi kitakarás:** szabályalapú felismerés, még a gépen. Mindig ugyanaz az érték kapja ugyanazt a helyettesítőt. A felhasználó saját kifejezéseket is felvehet, amelyeket mindig el kell rejteni.
   - Felismert adatok: cégnév, személynév, e-mail, telefonszám, bankszámlaszám / IBAN, adószám, adóazonosító, cégjegyzékszám, cím, helyrajzi szám, TAJ és más személyes azonosító, születési adat.
3. **Saját szerver (HTTPS):**
   - hozzáférési kulcs nélkül nem fogad kérést, és percenként legfeljebb 20 kérést fogad el;
   - a szöveget nem tárolja, csak továbbítja;
   - a félbeszakadt vagy hibás választ nem engedi a dokumentumba.
4. **AI-szolgáltató:** feldolgozza a kérést, és folyamatosan visszaküldi a választ.
5. **Vissza a gépre:** visszacseréljük a helyettesítőket, megmutatjuk a javaslatot, és a felhasználó dönt.

A **Kétnyelvű** fül (fordítás) ugyanezt az utat járja, csak a teljes dokumentumot küldi, kb. 12 000 karakteres részekben, egy futáson belül végig ugyanazokkal a helyettesítőkkel. A kész kétnyelvű dokumentum a gépen áll össze, és egy új, mentetlen Word-ablakban nyílik meg; a szerver nem tárolja.

A munkaablak **„Részletek”** paneljén minden válasznál látszik:
- pontosan mit kapott az AI (kijelölés vagy részlet, méret, korlátok);
- mit takartunk ki (táblázat: helyettesítő → eredeti érték);
- melyik modell dolgozott és hol (pl. „Vertex AI (europe-west1)”).

## 3. AI-szolgáltató: mit garantál a Google, és mit kell beállítani

**Vertex AI (ajánlott, `AI_PROVIDER=vertex`)**
- **Tanítás:** a Google alapértelmezés szerint nem használja az ügyféladatot modelltanításra. [1]
- **Feldolgozás helye:** regionális végpontnál (pl. `europe-west1` Belgium, `europe-west4` Hollandia) vagy az `eu` joghatósági végpontnál a modellfuttatás az EU-n belül marad. A **global** végpontnál nem ismert, hol fut a kérés, ezért azt nem használjuk. [2]
  - A választott modellnek elérhetőnek kell lennie az EU-régióban; ezt a modell kiválasztásakor ellenőrizni kell.
- **Gyorsítótár:** a Gemini-modellek alapból legfeljebb 24 óráig, memóriában gyorsítótárazzák a bemenetet. A **teljes adatmegőrzés-mentességhez ezt projektszinten ki kell kapcsolni.** [1]
- **Visszaélés-figyelés:** a Google naplózhatja a promptokat a felhasználási szabályzat megsértésének kiszűrésére, legfeljebb 30 napig, a választott régióban.
  - Ez csak a GCP Terms of Service alá tartozó, **nem számlás (invoiced) fizetésű** fiókokra vonatkozik.
  - Számlás fiók esetén nem érintett, egyébként kivétel kérhető. [1][3]
- **Google-keresés alapú válasz (grounding):** 30 napos megőrzéssel jár. **A Word Writer nem használja.** [1]

**Gemini API kulccsal (`AI_PROVIDER=gemini`)**
- **Ingyenes keret:** a Google a be- és kimenetet termékfejlesztésre használja, és azt emberi ellenőrök is olvashatják. **Ügyféladathoz nem használható.** [4]
- **Fizetős keret:** tanításra nem használja. Korlátozott ideig naplóz a visszaélések kiszűrésére és jogi kötelezettség teljesítésére. [4]
- **Feldolgozás helye:** nem választható EU-régió, ezért ezen a módon **a felhős diktálás tiltott** (szerveroldali szabály).

## 4. Diktálás

- **Alapértelmezés: helyi felismerés.** Whisper modell fut a munkaablakban (WebAssembly vagy WebGPU); a hangfelvétel **nem hagyja el a gépet**.
  - A modellt az első használatkor egyszer le kell tölteni (huggingface.co, kb. 80–250 MB), utána a gép tárolja.
  - A felismert szöveg a küldéskor ugyanúgy maszkolódik, mint a begépelt.
- **Felhős diktálás:** csak a Beállításokban bekapcsolva.
  - Vertex AI EU-régióban (`europe-*` vagy `eu`) szabadon használható: a hang nem hagyja el az EU-t.
  - Máshol (pl. Gemini API) a felhasználónak előbb ki kell jelölnie az „Elfogadom, saját felelősségemre” négyzetet. Ezt a használatot az auditnapló külön jelöli. Az üzemeltető ezt le is tilthatja (`DICTATION_POLICY=eu-only`).
  - A hang nem maszkolható, ezért ezt csak akkor ajánljuk, ha a helyi felismerés nem fut.

## 5. Auditnapló

- **Minden AI-műveletről egy sor készül:**
  - időpont, felhasználói azonosító (a Beállításokban megadott név vagy e-mail), IP-cím;
  - művelet (szerkesztés, vélemény, átvizsgálás, összevetés, diktálás);
  - a küldött szöveg mérete karakterben, a maszkolás be/ki és a kitakart elemek száma;
  - modell, feldolgozási hely, státusz (kész / félbeszakadt / hiba / leállítva / elutasítva), időtartam, tokenfogyasztás.
- **Soha nem kerül bele** a dokumentum szövege, az utasítás, a válasz vagy a hangfelvétel.
- **Helye:** a szerver naplója (Cloud Runon: Cloud Logging), és ha be van állítva, egy fájl (`AUDIT_LOG_FILE`).
- **Megjegyzés:**
  - A felhasználói azonosítót most a felhasználó adja meg, a szerver nem ellenőrzi.
  - Az IP-cím személyes adat; a napló megőrzési idejét az iroda szabályzata szerint kell beállítani.
  - A Microsoft-fiókos belépés (ellenőrzött azonosító) a következő fázisban jön.

## 6. Korlátok, amelyekről tudni kell

- **A kitakarás szabályalapú, nem tökéletes.**
  - Egy ritka utónevű személynév kulcsszó, személyes adat vagy szerepkör nélkül a szöveg közepén, vagy az ügyletből kikövetkeztethető információ (egyedi összeg, ingatlan leírása) átjuthat.
  - Ha az AI a választ fel nem oldható helyettesítővel adja vissza, azt a program nem írja be a dokumentumba.
  - Érzékeny ügyben érdemes a „mindig elrejtendő kifejezések” közé felvenni a kulcsneveket, és bekapcsolni a „Küldés előtt mutasd meg, mit kap az AI” ellenőrzést.
  - A maszkolás alapból kötelező: a szerver a maszkolatlan kérést visszautasítja (az üzemeltető `MASKING_POLICY=optional` beállítással engedheti a kikapcsolását).
- **Nem maszkolt adat:** a szerződés tartalma és az összegek nem maszkolódnak, mert ezek nélkül az elemzés értelmetlen lenne. Ezeket a Vertex AI EU garanciái védik.
- **Hozzáférés:** egy közös hozzáférési kulcs védi a szervert, ezért a kulcsot bizalmasan kell kezelni.
- **Jogszabály-ellenőrzés:** a modell tudása nem élő jogszabálytár. Amiben bizonytalan, azt jelzi, és njt.hu-s ellenőrzést kér.

## 7. Ajánlott beállítás ügyfélmunkához (ellenőrzőlista)

- [ ] `AI_PROVIDER=vertex`, `GOOGLE_CLOUD_LOCATION=europe-west1` (vagy `europe-west4`, `eu`); a modell elérhető a régióban.
- [ ] Vertex AI adat-gyorsítótár kikapcsolva a projektben. [1]
- [ ] Számlás (invoiced) Cloud Billing fiók, vagy kivételkérelem a visszaélés-figyelés alól. [1][3]
- [ ] Adatfeldolgozási kiegészítés (Cloud Data Processing Addendum) elfogadva a Google Cloud-fiókban.
- [ ] `APP_ACCESS_KEY` erős, bizalmasan kezelt; a Beállításokban a felhasználói azonosító kitöltve.
- [ ] Maszkolás bekapcsolva (alapértelmezés); diktálás helyben (alapértelmezés).
- [ ] Auditnapló megőrzési ideje beállítva (`AUDIT_LOG_FILE` vagy Cloud Logging-szabály).

**Források**
[1] Google Cloud: Vertex AI and zero data retention – https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance
[2] Google Cloud: Where your data lives and is processed – https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency
[3] Google Cloud: Abuse monitoring – https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring
[4] Gemini API Additional Terms of Service – https://ai.google.dev/gemini-api/terms
