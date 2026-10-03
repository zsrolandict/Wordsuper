# Felhős telepítés (Google Cloud Run, EU) és központi kiadás a Wordben

Felhős telepítés után nem kell gépenként INDITAS.bat. A szerver a Google felhőjében fut Belgiumban
(`europe-west1`). A rendszergazda a Microsoft 365 felügyeleti központjából egyszerre adja ki a bővítményt mindenkinek,
és egy frissítés mindenkinél egyszerre érvényes.

Alapbeállításként az AI is az EU-ban dolgozik: Vertex AI, ugyanabban a régióban. Ehhez nem kell Gemini API-kulcs, a
szerver a saját szolgáltatásfiókjával éri el az AI-t.

**Állapot:** a kód és a telepítő szkript elkészült. Production módban helyben, konténer nélkül próbáltam ki: a manifest,
a belépés, a verzió és a kiszolgált oldal működik. Valódi Google Cloud-projektbe még nem telepítettem, és a
konténerépítést (Docker) sem tudtam lefuttatni. Az első telepítésnél ezért érdemes figyelni.

## Mi kell hozzá

- Google-fiók, bekapcsolt számlázással, és egy Google Cloud-projekt (console.cloud.google.com → Új projekt). Jegyezd
  fel a projekt **azonosítóját** (Project ID).
- A Microsoft-belépéshez és a központi kiadáshoz: Microsoft 365-rendszergazda.

## 1. A szerver telepítése (kb. 10 perc)

1. Nyisd meg a console.cloud.google.com oldalt, és jobb fent indítsd el a **Cloud Shellt** (`>_` ikon). Ez egy
   böngészős parancssor, minden szükséges eszköz megvan benne.
2. Töltsd le a kódot:
   ```
   git clone https://github.com/zsrolandict/Wordsuper.git
   cd Wordsuper
   git checkout phase-1
   ```
   A repó privát, ezért a GitHub jelszó helyett egy **hozzáférési tokent** kér: GitHub → Settings → Developer
   settings → Personal access tokens, csak olvasási joggal.
3. Indítsd a telepítést (a saját projektazonosítóddal):
   ```
   PROJECT=sajat-projekt-azonosito ./scripts/felho-telepites.sh
   ```
   A szkript sorban ezt végzi el:
   - bekapcsolja a szükséges Google-szolgáltatásokat;
   - létrehoz egy szolgáltatásfiókot, amely csak az AI-t és a saját titkait éri el;
   - készít egy véletlen hozzáférési kulcsot titokként, EU-ban tárolva;
   - megépíti és elindítja a szervert.

   A végén kiírja a szerver címét, például `https://ict-legalsuite-…-ew.a.run.app`.
4. Ellenőrzés: nyisd meg a címet a böngészőben. A telepítési oldalnak kell megjelennie, a manifest letöltő gombjával.
   A Beállítások alján a verziószám a telepített commit.

A hozzáférési kulcsot így nézheted meg (a Beállításokba ezt kell beírni, amíg nincs Microsoft-belépés):
```
gcloud secrets versions access latest --secret=app-access-key
```

**Ha a Vertex AI hibát ad** („model not found” vagy hasonló), lehet, hogy a modell ebben a régióban nem érhető el.
Próbáld egy másik EU-régióval: `VERTEX_LOCATION=europe-west4 PROJECT=… ./scripts/felho-telepites.sh`.

## 2. Microsoft-belépés (ajánlott)

Felhőben futó szervernél a Microsoft-belépés a jó megoldás: nincs közös kulcs, és az auditnapló névre szól.

1. Az Azure-regisztrációt a [MICROSOFT-BELEPES.md](MICROSOFT-BELEPES.md) szerint végezd el. Az **Application ID URI**
   legyen `api://<a szerver címe https:// nélkül>/<client ID>`. A telepítő szkript ki is írja.
2. Futtasd újra a telepítést a két azonosítóval:
   ```
   AUTH_MODE=both MS_CLIENT_ID=<client ID> MS_TENANT_ID=<tenant ID> PROJECT=… ./scripts/felho-telepites.sh
   ```
   Ha mindenkinél működik, futtasd újra `AUTH_MODE=microsoft` beállítással.

A szerver a `/manifest.xml` címen ilyenkor magától a Microsoft-belépéses manifestet adja.

## 3. Központi kiadás mindenkinek (Microsoft 365 felügyeleti központ)

1. Lépj be: admin.microsoft.com → **Beállítások → Integrált alkalmazások → Egyéni alkalmazások feltöltése**.
2. Típus: **Office-bővítmény**. Forrás: URL, a szerver `…/manifest.xml` címével. Vagy töltsd le a fájlt, és azt add meg.
3. Válaszd ki, kik kapják: mindenki, egy csoport vagy kijelölt felhasználók. Utána **Üzembe helyezés**.
4. A Word Kezdőlap szalagján megjelenik az **ICT LegalSuite** gomb. Ez akár 24 óráig is tarthat.

Ha valaki addig az INDITAS.bat-os helyi változatot használta, azt távolítsa el (`npm run word:remove`), különben két
gombja lesz.

## Frissítés és visszaállás

- **Frissítés:** a Cloud Shellben `cd Wordsuper && git pull`, majd ugyanaz a telepítő parancs, mint először. A szkript
  újrafuttatható; ami már megvan, azt nem hozza létre újra.
- **Visszaállás egy korábbi változatra:** a Cloud Run minden telepítést külön változatként (revision) megőriz.
  Konzolon: Cloud Run → ict-legalsuite → Revisions → a régi változat → „Manage traffic”, 100%.

## Beállítások a felhőben

| Mit | Hogyan |
|---|---|
| Irodai stílusok | `gcloud secrets create office-styles --data-file=office-styles.json --replication-policy=user-managed --locations=europe-west1`, majd a telepítő újra; zároláshoz `OFFICE_STYLES_LOCKED=true` |
| Irodai playbookok | `gcloud secrets create playbooks --data-file=playbookok.json --replication-policy=user-managed --locations=europe-west1`, majd a telepítő újra |
| Személyes hozzáférési kulcsok | `app-access-keys` titok „Név:kulcs, Név2:kulcs2” tartalommal, majd a telepítő újra |
| Gemini API a Vertex AI helyett | `gemini-api-key` titok (a szkript kiírja a parancsot), majd `AI_PROVIDER=gemini` |
| Hidegindítás nélkül | `MIN_INSTANCES=1` (mindig fut egy példány, kis havi fix díj) |
| Modell, maszkolás, diktálás | `AI_MODEL`, `AI_MODEL_DEEP`, `MASKING_POLICY`, `DICTATION_POLICY` a parancs elé írva |

## Auditnapló és hibakeresés

- Az auditnapló sorai a Cloud Loggingba kerülnek (Konzol → Logging), tartalom nélkül, mint helyben.
- A szerver naplója: `gcloud run services logs read ict-legalsuite --region europe-west1`.

## Költség (nagyságrend)

- **Cloud Run:** kis irodai forgalomnál `MIN_INSTANCES=0` mellett jellemzően a havi ingyenes kereten belül vagy
  néhány euró. `MIN_INSTANCES=1` mellett havi fix díj is van.
- **Secret Manager és a konténerek tárolása:** havi néhány cent, legfeljebb pár euró.
- **AI (Vertex AI / Gemini):** a használattal arányos tokendíj. Ez a fő költség, ugyanaz, mint helyi futtatásnál.

A pontos díjakat a Google árkalkulátora mutatja; ezeket a számokat nem ellenőriztem.

## Adatvédelem a felhőben

- A szerver és az AI is az EU-ban fut (Vertex AI, `europe-west1`), így a felhős diktálás is engedélyezett.
- A dokumentum szövegét a szerver nem tárolja. Az auditnapló csak méreteket és időpontokat rögzít.
- A titkok (kulcsok) a Secret Managerben vannak, csak az EU-ban tárolva, és csak a szerver olvashatja őket.
- A maszkolás ugyanúgy a felhasználó gépén történik, mint eddig.
