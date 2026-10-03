# Kipróbálás valódi Wordben – ellenőrzőlista

A mostani funkciók szimulált Worddel vannak tesztelve. Ez a lista azt nézi meg, hogy a valódi Word is ugyanígy
viselkedik-e. A tesztdokumentum `docs/teszt/WordWriter-teszt.docx`. Az INDITAS.bat letölti, a gépen a
`superword\docs\teszt\` mappában lesz. Minden új funkcióhoz van benne szándékos hiba. Újragenerálni a
`python scripts/teszt-docx.py` paranccsal lehet.

**Előkészület**

- [ ] INDITAS.bat → a Word megnyílik, a Word Writer betölt.
- [ ] Beállítások (fogaskerék) → alul a verziószám a legújabb (3aa8d0c vagy újabb).
- [ ] A tesztdokumentumról **készíts másolatot**, és azt nyisd meg. A teszt módosítja a fájlt.

Ha valami nem úgy működik, ahogy itt áll: Beállítások → **Hibajelentés** → írd le, mi történt → Letöltés, és küldd el.
Dokumentumszöveg nincs benne.

---

## 1. Kiküldés előtti ellenőrzés (Szerkezet fül, a gomb legfelül)

- [ ] Megnyitáskor magától **nem** jelez semmit. Csak a gomb megnyomására ellenőriz.
- [ ] **Korrektúra:** 2 el nem fogadott változás, mindkettő „Dr. Ellenfél Ügyvéd” nevével: a beszúrt „ és járulékait”
  (2.3) és a törölt „8” (2.4).
- [ ] **Megjegyzés:** 1 megoldatlan, „Dr. Belső Kolléga”: „Ellenőrizni a hrsz-t a tulajdoni lapon!”
- [ ] **Kitöltetlen helyek:** `[●]` (2.5), valamint `___________` és `___` (4.1).
  Nem jelzi a `[Ptk.]`-t (6.1) és az aláírási vonalat a végén.
- [ ] **Kiemelés:** sárga, „45.000.000,- Ft, azaz negyvenötmillió forint” (2.1).
- [ ] **Rejtett szöveg:** „BELSŐ MEGJEGYZÉS: az ügyfél max. 40 M Ft-ig menne el.” (5.2 végén).
  A Wordben csak a ¶ (Ctrl+Shift+8) bekapcsolásával látszik.
- [ ] **Tulajdonságok:** Szerző „Teszt Elek (belső)”, Utoljára mentette „Dr. Belső Kolléga”, Cím „Tervezet v3”,
  Tárgy, Kulcsszavak, Megjegyzés, Kategória.
- [ ] Az **Ugrás** linkek a dokumentum megfelelő helyére visznek, és kijelölik az adott részt.
- [ ] A szerzői adatok törlése után az „Újra ellenőrzöm” már üres Szerzőt, Kulcsszavakat, Megjegyzést, Kategóriát és
  Tárgyat mutat. Az „Utoljára mentette” mezőt a Word mentéskor maga írja.

## 2–4. Szerkezet fül: egyezések

- [ ] **Szám–betű:** 2.2 – „számmal 4 500 000, betűvel 4 600 000”. A 2.1 helyes, azt nem jelzi.
- [ ] **Tulajdoni hányadok:** 1.2 – „összege 5/6, nem 1 (1/2 + 1/3)”.
- [ ] **Felek elnevezése:** „Vevő” egyes számban definiált, az 1.3-ban mégis „Vevők” áll.
- [ ] **Számozás:** „Kimaradt a „3.” pont”. A melléklet „1.” és „2.” pontját nem jelzi, ott újraindul a számozás.
- [ ] Mindegyiknél működik az Ugrás. A felek elnevezésénél a javaslatkérés az AI-hoz megy (maszkolva).

## 5. Definiált fogalmak egységes kiemelése (Formázás → Kategóriák: „Definiált fogalmak egységesen”)

- [ ] Előnézetben: a definíció helyén félkövér és idézőjeles („Eladó”, „Vevő”, „Tulajdonostárs”, „Ingatlan”). A
  használatban sima: a 2.3 félkövér „Vevő” szava normál lesz.
- [ ] Alkalmazás után a Wordben is így néz ki. Ez formázás, korrektúra nélkül.

## Formázás fül (a korábbi funkciókkal együtt)

**Stílusok** → „ICT Europa Executive” → Egységesítés.

- [ ] Rákérdez a címsorszintre (álcímsorok: „1. A SZERZŐDÉS TÁRGYA”, „2. VÉTELÁR” …).
- [ ] Előtte elmenti az előző állapotot. Az „Előző állapot” rész lent megjelenik.
- [ ] Betűtípus egységes: az Arial cím, a Calibri fejezetcímek és a 6.2-es Arial bekezdés is átáll.
- [ ] A fejezetcímek „ICT Fejezetcím” stílust kapnak, kék vonallal (Word: Kezdőlap → Stílusok panel).
- [ ] Az „5. A Felek Szavatossági Kötelezettségei” (Címsor 1) a Word saját Címsor 1 stílusával frissül.
- [ ] **Üres sorok** kártya, „Minden üres sor (a térköz veszi át)”: a felsorolás utáni két üres sor és az aláírás
  előtti három üres sor eltűnik, a távolságot a térköz adja.
- [ ] Kiskapitális cím és vonal: régebbi Wordben ehelyett megjegyzést ír, hogy nem érhető el. Ez nem hiba.
- [ ] Az „Előző állapot” megnyitása új ablakban az egységesítés előtti dokumentumot hozza.

**Szöveg** fül, Szövegfésülés: ezek korrektúrával kerülnek be.

- [ ] Dupla szóközök (1.2).
- [ ] Szóköz az írásjel előtt: „mérték ,” → „mérték,” (2.4).
- [ ] Nem törő szóköz a dátumban: „Kelt: Budapest, 2026. október 3.” Ezt a ¶ nézetben a szóközök helyén megjelenő ° jel
  mutatja.
- [ ] Tartomány: „8-15” → „8–15”.
- [ ] Gondolatjel: „ - legkésőbb … - ” → „ – … – ”.
- [ ] Idézőjel: "Eladó" → „Eladó” (5.1).
- [ ] Markdown: a `**Ingatlan**` csillagai eltűnnek, a szó félkövér lesz (4.3).

AI-nyomok: ezeket csak jelöli, nem javítja.

- [ ] „Fontos megjegyezni”, „zökkenőmentes”, „kulcsfontosságú” és a ✅ (4.2).
- [ ] Az angolos nagybetűs cím (5.), a hosszú félkövér bekezdés (5.2) és a láthatatlan karakter (4.3).

## 6–8. Formázás → Elemek

- [ ] **Élőfej és élőláb:** a meglévő „TERVEZET – régi élőfej” miatt előbb rákérdez, hogy felülírja-e. Utána élőfej
  az iroda nevével, élőlábon „Oldal X / Y”, és ha bejelölöd, BIZALMAS, azonosító, verzió. Az oldalszám lapozva
  helyes.
- [ ] **Aláírási blokk:** a kurzor helyére kerül, két oszlop keret nélkül. A felek javaslata Eladó / Vevő. Dátum és
  hely beállítható.
- [ ] **Tartalomjegyzék:** a Címsor és az ICT Fejezetcím stílusú címekből készül. Ezért az Egységesítés után érdemes
  beszúrni, így a fejezetcímek is benne lesznek. A **Frissítés** gombbal a címek változása átvezetődik. Ha a Word
  nem engedi: jobb gomb → Mező frissítése.

## 9. Irodai stílusok megosztása

- [ ] Stílusok → **Új stílus** (vagy „Mentés saját stílusként”) → **Exportálás (.json)** → a fájl letöltődik.
- [ ] Egy másik gépen vagy böngészőben: **Importálás…** → a stílus megjelenik a „Saját” csoportban.
- [ ] Szerveren: `.env`: `OFFICE_STYLES_FILE=office-styles.json` (az exportált fájl), INDITAS.bat újra → a stílus az
  „Irodai” csoportban jelenik meg.
- [ ] `OFFICE_STYLES_LOCKED=true` esetén csak az irodai stílusok választhatók, és az értékük nem szerkeszthető.

## 10. Kétnyelvű: frissítés csak a változásokra

- [ ] Kétnyelvű fül → Kétnyelvű változat készítése (HU → EN) → új dokumentum nyílik. Mentsd el.
- [ ] Az eredeti dokumentumban írj át egy bekezdést (pl. 1.3), majd Újraolvasás.
- [ ] „Korábbi kétnyelvű változat”: válaszd ki a mentett fájlt. A „Szinkron frissítés” be van kapcsolva.
- [ ] Készítés: a többi sor a korábbi fordításból jön, csak az átírt bekezdés fordítódik újra. Ennek a sora sárga.
- [ ] Szinkron frissítés kikapcsolva: minden sor újra fordítódik.

## 13. Microsoft-fiókos belépés (csak az Azure-beállítás után, lásd MICROSOFT-BELEPES.md)

- [ ] `.env`: `AUTH_MODE=both`, `MS_CLIENT_ID`, `MS_TENANT_ID` → INDITAS.bat. A szerverablak ezt írja:
  „Microsoft sign-in: on, access keys still accepted”.
- [ ] Beállítások → „Bejelentkezés Microsoft-fiókkal” → „✅ Bejelentkezve: Név (email)”.
- [ ] Egy AI-kérés után az auditnaplóban (`AUDIT_LOG_FILE`) ez szerepel: `"auth":"microsoft"`, `"verified":true`, és
  a munkahelyi e-mail-cím.
- [ ] `AUTH_MODE=microsoft`: a hozzáférési kulcs kártyája eltűnik, kulcs nélkül is működik.

## 14. Hibajelentés

- [ ] Beállítások → Hibajelentés → leírás → „Mi lesz benne?”. Látszik a Word API-szint, a kapcsolók és az utolsó
  események. Nincs benne dokumentumszöveg, név vagy kulcs.
- [ ] Másolás és Letöltés működik.

---

### Amit csak valódi Word tud megmutatni (itt különösen figyelj)

- Térköz, sorköz és behúzás valódi bekezdéseken és táblázatcellákban.
- Stílusdefiníciók frissítése: a „Címsor 1” módosul, az „ICT Fejezetcím” létrejön.
- Szegély a stíluson (fejezetcím-vonal), kiskapitális, oldalmargó (újabb Word kell hozzá).
- Élőfej és élőláb OOXML-ből, oldalszám-mezők, tartalomjegyzék-mező és frissítése.
- A dokumentum mentése az „Előző állapot”-hoz (getFileAsync), és megnyitása új ablakban.
- Kiemelt és rejtett szöveg felismerése a dokumentum XML-jéből.
- A Microsoft-belépés teljes útja (Azure-regisztráció és Office SSO).
