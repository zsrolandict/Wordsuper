# Fejlesztési terv (II. fázis)

*Frissítve: 2026. október 3. (este) Ez a fájl az állapotjelző: minden lépés után frissül.*

**Az I. fázis és a 14 pontos fejlesztési lista** (kiküldés előtti ellenőrzés, szám–betű egyezés, hányadok, felek
elnevezése, számozás, definiált fogalmak, élőfej/élőláb, aláírási blokk, tartalomjegyzék, irodai stílusok, kétnyelvű
szinkron frissítés, Microsoft-belépés, hibajelentés): **kész**. A kód tesztelve van, de valódi Wordben még nem
próbáltuk ki; ehhez: [TESZT-WORDBEN.md](TESZT-WORDBEN.md).

A piacvezetőkkel való összevetés után (2026. október) ezek a tételek maradtak. Mindegyiknek rövid kódneve van, így
lehet rájuk hivatkozni.

| Kód | Mit | Állapot | Megjegyzés |
|---|---|---|---|
| `felho` | Felhős szerver (Cloud Run, EU) és központi kiadás a Microsoft 365-ben | kód kész, élesben nem kipróbálva | [FELHO-TELEPITES.md](FELHO-TELEPITES.md) |
| `playbook` | Iroda szabálykönyve záradéktípusonként (standard, Fallback 1, Fallback 2, walk-away), egy gombnyomásos ellenőrzés emberi jóváhagyással, kísérőlevél | **kód kész**, valódi Wordben nem kipróbálva | a tartalmát jogász írja (van minta); Autopilot (beavatkozás nélküli beírás) nem lesz |
| `jogref` | Jogszabály- és határozat-hivatkozások felismerése a Szerkezet fülön, megnyitás a Nemzeti Jogszabálytárban (njt.jog.gov.hu) | **kód kész**, valódi Wordben nem kipróbálva | kulcs és licenc nélkül |
| `tobbagens` | Többágensű átvizsgálás: öt szakértő párhuzamosan, majd összegzés | **kód kész**, valódi Wordben nem kipróbálva | alapból ki; Beállításokban: ki / csak „Alapos”-nál / mindig; használatkor kb. 5–7-szeres tokenköltség |
| `zaradektar` | Mintazáradék-tár egy SharePoint-mappából, a Microsoft-belépésre építve | **kód kész**, valódi Wordben és SharePointtal nem kipróbálva | előbb: ki gondozza, mi kerülhet bele |
| `apijog` | Automatikus „létezik-e, hatályos-e” ellenőrzés kereskedelmi jogtár API-jával | **félretéve** | lásd lent |
| `benchmark` | Piaci statisztikai összevetés | **elvetve** | magyar piacra nincs adat |

## `playbook` – így működik

- **Hol:** Asszisztens → Átvizsgálás mód, a lila „Playbook” sáv: playbook kiválasztása, **Ellenőrzés**.
- **Eredmény:** pontonkénti összesítő (Standard, Fallback 1, Fallback 2, Elfogadhatatlan, Hiányzik, Nem vizsgálta).
  Ami nem standard, az észrevétel lesz, a legrosszabb elöl, javasolt szöveggel a standard pozícióra. Egyenként
  Mutasd / Elfogadom / Elvetem, korrektúrával, mint minden átvizsgálásnál. Magától semmi nem kerül be.
- **Kísérőlevél:** ha legalább egy módosítás bekerült, „✉️ Kísérőlevél a partnernek” gomb. Csak a beírt módosításokról
  szól, a dokumentumba nem kerül, kimásolható. Maszkolva megy, mint minden kérés.
- **Kezelés:** „Playbookok kezelése”: új playbook, szerkesztés (téma, standard, Fallback 1–2, elfogadhatatlan,
  mintaszöveg), minta betöltése, importálás/exportálás (.json). A sajátok ezen a gépen tárolódnak.
- **Irodai playbookok:** az üzemeltető az exportált fájlt a szerverre teszi (`PLAYBOOKS_FILE`; felhőben a
  `playbooks` titok). Mindenkinél „Irodai” csoportban jelennek meg, nem szerkeszthetők, de lemásolhatók.
- **Minták** („Minta betöltése…”): Titoktartási megállapodás (NDA, átadó fél, 7 pont), Vállalkozási szerződés
  (megrendelői oldal, 8 pont), Üzlethelyiség-bérlet (bérlői oldal, 8 pont), Ingatlan-adásvétel (vevői oldal, 5 pont).
  Kiindulópontok: a pozíciókat és az összegeket az irodának kell a saját gyakorlatához igazítania. Csak biztos
  Ptk.-helyre hivatkoznak (6:152. § a felelősségkorlátozás határa, 6:186. § kötbér).

## `tobbagens` – így működik

- **Szakértők:** felelősség és kockázat; pénzügyi feltételek; hatály és megszűnés; jogok és adatok (szellemi tulajdon,
  titoktartás, adatvédelem); belső következetesség. Mind az egész dokumentumot kapja, de csak a saját területét nézi.
- **Összegzés:** egy összegző kérés egy listába rendezi az észrevételeket (legfeljebb 15), kiszűri az ismétléseket, és
  az ellentmondó javaslatok közül a képviselt félnek megfelelőbbet tartja meg. Új észrevételt nem talál ki.
- **A felületen** ugyanaz, mint egy átvizsgálás: egyenként Mutasd / Elfogadom / Elvetem, korrektúrával. A Részletekben
  látszik, melyik szakértő hány észrevételt adott.
- **Beállítás:** Beállítások → Többágensű átvizsgálás: Ki (alap) / Csak „Alapos” gondolkodásnál / Mindig. Az
  Átvizsgálás módban a „🧩 Többágensű” kapcsolóval egy-egy futtatásra át is állítható.
- **Mindig egy kéréssel megy:** a playbook-ellenőrzés és a finomítás.
- **Költség:** 6 kérés (5 szakértő + összegzés), mind a teljes dokumentummal. Az auditnapló jelzi, hány szakértő
  válaszolt; a tokenszám az összesített.

## `jogref` – így működik

- **Hol:** Szerkezet fül → „Jogszabályok” lista. Jogszabályonként (vagy döntésenként) csoportosítva, minden
  előforduláshoz Ugrás gombbal.
- **Mit ismer fel:** törvények („2013. évi V. törvény”, „tv.”), a gyakori rövidítések szakaszokkal (Ptk., Pp., Btk.,
  Mt., Ctv., Inytv., Ákr., Infotv., Ütv., Vht., Cstv., Tpvt., Áfa tv., Szja tv., Gt.), kormányrendeletek, AB-határozatok,
  jogegységi határozatok, BH/EBH/BDT/KGD, Kúria-ügyszámok, uniós rendeletek és irányelvek (GDPR is).
- **Megnyitás:** törvény és kormányrendelet közvetlenül a Nemzeti Jogszabálytárban (`njt.jog.gov.hu/jogszabaly/2013-5-00-00`,
  kormányrendeletnél `2008-176-20-22`), uniós jog az EUR-Lexen; miniszteri rendeletnél keresés a Jogszabálytár
  oldalán, bírósági döntésnél a weben. Csak a hivatkozás kerül a címbe, a szerződés szövege nem.
- **Ellenőrzés adatbázis nélkül** (a Problémák között): nem hatályos törvény (régi Ptk., Gt., Pp., Btk., Mt., Ket., Be.,
  adatvédelmi és ügyvédi törvény, a hatályvesztés dátumával és az utóddal), a régi Ptk.-számozás az új Ptk.-ra
  hivatkozva („Ptk. 318. §”), nem létező Ptk.-könyv („Ptk. 9:12. §”).
- **Amit nem tud:** hogy egy bekezdés létezik-e és hatályos-e a szerződés dátumán: ez az `apijog`.
- Valódi Wordben ellenőrizendő: a megnyitás az asztali Wordből (alapértelmezett böngészőben).

## `zaradektar` – így működik

- **Hol:** Asszisztens → Generálás mód → „📚 Záradéktár” → keresés (címben, kategóriában és szövegben is).
- **Beszúrás a kurzorhoz:** szó szerint, korrektúrával, AI nélkül.
- **Illesztés a szerződéshez:** az AI a szerződés definiált fogalmaihoz, feleihez és stílusához igazítja (a tartalmán
  nem változtat), előnézettel, mint minden generálás. Maszkolva megy.
- **Forrás 1 – mappa a gépen** (`CLAUSES_DIR`): pl. az iroda SharePoint-mappája OneDrive-val szinkronizálva. Nem kell
  hozzá Azure-beállítás. Percenként frissül.
- **Forrás 2 – SharePoint közvetlenül** (`CLAUSES_SHAREPOINT_URL`, felhős szerverhez): Microsoft-belépés kell, és
  mindenki csak azt látja, amihez a SharePointban joga van. Ehhez `MS_CLIENT_SECRET` és a `Files.Read.All` jogosultság
  kell (MICROSOFT-BELEPES.md).
- **Formátum:** minden .docx egy záradék; a fájlneve a címe, az almappa (egy szint) a kategóriája. Legfeljebb 300
  záradék, egyenként 20 000 karakter.
- **Ki gondozza:** a mappába az kerüljön, amit az iroda jóváhagyott és anonimizált (ügyfélnév, összeg nélkül).

## `apijog` – félretéve

**Mi lenne:** a dokumentum jogszabályhelyeit és bírósági határozatait egy élő adatbázis alapján ellenőrizné. Létezik-e
a hivatkozott bekezdés, hatályos-e a dokumentum dátumán, és ha nem, mi a hatályos szöveg. A hibásat piros jelzéssel
mutatná.

**Miért van félretéve:** hiteles gépi adatforrás kell hozzá. Az njt.hu-nak tudomásunk szerint nincs hivatalos nyilvános
API-ja; a lekaparás törékeny, és a felhasználási feltételekbe ütközhet. A kereskedelmi jogtárak (pl. Wolters Kluwer,
ORAC) API-ja licencdíjas és szerződéses (API-kulcs). Erről üzleti döntés kell.

**Mi kell az újrakezdéshez:**
1. Döntés a forrásról: melyik jogtár, milyen díjjal és milyen adatkezelési feltételekkel.
2. API-hozzáférés (kulcs) és a dokumentációja.

**Mire épülhet, ha újrakezdjük:** a `jogref` felismerője megtalálja a hivatkozásokat. Az `apijog` erre építve csak a
lekérdezést és a jelzést adja hozzá. A hivatkozások jogszabályhelyek, nem személyes adatok, ezért maszkolás nélkül
mehetnek a jogtárhoz, a dokumentum szövege nem.

## Visszajelzések a valódi Wordből (2026. október 3.)

| Mit | Állapot |
|---|---|
| Beállítások: „Mentés” gomb visszajelzéssel („✅ Elmentve ezen a gépen”) | **kész** |
| Munkajelző a fogaskerék mellett, amíg bármelyik fülön AI-kérés fut (később a mozgó logó) | **kész** |
| Jogszabály megnyitása közvetlenül a Nemzeti Jogszabálytárban (njt.jog.gov.hu), nem Google-keresésben | **kész** |
| 3 új minta-playbook (NDA, vállalkozási szerződés, üzlethelyiség-bérlet) | **kész** |
| Fordítás: csak a kijelölt bekezdés(ek); a kétnyelvű táblázatban a kijelölt sor jobb oldalába írja | **kész** |
| Fordítás: nincs „Magyar / English” fejléc és cím a kétnyelvű dokumentumban | **kész** (a korábbi, fejléces fájlok is beolvashatók) |
| Egész dokumentum szerkesztése: indoklás bekezdésenként (lenyitható „Miért?”), összegzés, „Mindet elfogadom” felül is, Mind / Egyik sem; a stílusutasítás nem nyúlhat jogszabályhelyhez, összeghez, dátumhoz, névhez | **kész** |
| Jogszabály-hivatkozások egységesítése: első helyen teljes cím „(a továbbiakban: Ptk.)”, utána rövidítés | tervezve |
| Súgó-asszisztens: kérdezni lehet, mit hol talál a bővítményben | tervezve |
