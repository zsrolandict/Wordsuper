# Word Writer – Formázás modul (leírás egyeztetéshez)

*Állapot: 2026. október 3., `phase-1` ág (a prémium átalakítással együtt). A leírás egy másik AI-val vagy fejlesztővel való egyeztetéshez készült: mit csinál a modul, hogyan működik, mire figyel, és mit nem tud még. A modul AI-t nem használ, minden szabályalapú és a gépen fut.*

## 1. Cél

Szerződések és hosszú dokumentumok formázása gyakran összevissza: több szerző szövege kerül egy fájlba, különböző betűtípusokkal és térközökkel, üres sorokkal tördelt bekezdésekkel, stílus nélkül „kézzel” félkövérre állított címekkel. A modul **egy kattintással egységesít**, de úgy, hogy a tartalomhoz nem nyúl: a szöveg, a számozás, a hivatkozások és a címsorszintek (navigáció, tartalomjegyzék) megmaradnak, csak a megjelenés változik.

Alapelvek:
- **Átlátható:** először átvilágít, megmondja, mi hol tér el; az egységesítés előtt látszik, hány bekezdést érint.
- **Az ember dönt:** kategóriánként kapcsolható, és a bizonytalan kérdésnél (tudatosan több címsorszint?) rákérdez.
- **Visszaállítható:** minden egységesítés előtt elmenti a teljes dokumentumot.
- **A szöveg érintetlen:** a szöveget módosító két lehetőség alapból ki van kapcsolva.

## 2. Hol van a kód

| Fájl | Szerep |
|---|---|
| `src/services/microtypography.ts` | Magyar jogi mikrotipográfia: nem törő szóközök, magyar idézőjelek (tiszta logika, tesztelve) |
| `src/services/formatting.ts` | Tiszta logika: átvilágítás, szerepek, összegzés, stílusprofil, kész stílusok, a változtatási terv (nincs benne Word-hívás, ezért tesztelhető) |
| `src/services/formatting.test.ts` | Egységtesztek a logikára |
| `src/components/FormatPanel.tsx` | A „Formázás” fül felülete |
| `src/services/wordDocument.ts` | Word-réteg: `readFormatAudit`, `readSelectionFormat`, `applyFormatPlan`, `readDocumentFile` (Office.js) |
| `src/services/download.ts` | Letöltés és dokumentumnév (közös a Kétnyelvű füllel) |

## 3. A felület

- **Állapot-kártya** felül, egy sorban: „Állapot: 2 féle betűtípus, 1 stílus nélküli cím, 6 egyenes idézőjel, 12 hiányzó nem törő szóköz…” (zöld pont, ha minden egységes). A részletes lista a „Részletek” alatt lenyitható.
- **Stíluskártyák**: kétoszlopos rács, mindegyik a saját betűképével és színével; az **ICT Europa Executive** felül, teljes szélességben, „★ Ajánlott” jelvénnyel. Mellette „Ebből a dokumentumból” és az öt további stílus.
- **Élő előnézet**: kicsinyített mintaoldal a kiválasztott stílussal (főcím kiskapitálissal és kék vonallal, második szintű cím a kék csíkkal, szövegbekezdés a valódi betűtípussal, mérettel, színnel, sorközzel, igazítással). Ha a betűtípus nincs telepítve, a minta hasonlóval mutatja.
- **Címsor-kérdés** és **ál-cím pipa** (ha van mire kérdezni).
- **Szövegfésülés** kártya (csak ha van mit fésülni): nem törő szóközök, magyar idézőjelek, többszörös üres sorok, dupla szóközök, darabszámmal; alapból mind kikapcsolva.
- **Egy nagy „Egységesítés” gomb** (ICT sötétkék), fölötte egy mondat arról, mi fog történni, alatta a biztonsági ígéret.
- **„Részletes beállítások és finomhangolás”** lenyitható rész (alapból zárva): betűk, címek (betűtípus, méret, szín, kiskapitális, vonal a főcím alatt, csík a 2. szint mellett, térközök), bekezdések (térközök, sorköz, behúzások, igazítás), oldalmargók, „mint a kijelölt” gombok, és a kategóriák pipái darabszámmal.
- **Előző állapot** kártya az egységesítés után.

## 3/B. A működés lépései

### 3.1 Átvilágítás
Beolvassa minden bekezdés formázását: stílus (beépített név), táblázatban van-e, betűtípus, méret, félkövér, igazítás, térköz előtte/utána, sorköz, első sor behúzása; valamint a lábjegyzetek betűtípusát és méretét (WordApi 1.5-től). Ha egy bekezdésen belül vegyes a betűtípus vagy méret, az érték „vegyes” (null).

Az összegzés megmutatja: betűtípusok és méretek (hány bekezdés), hányféle térköz-beállítás van, címsorok szintenként, stílus nélküli „ál-címek”, lábjegyzetméretek, többszörös üres sorok, dupla szóközök.

### 3.2 Szerepek
Minden bekezdés kap egy szerepet (`roleOf`):
- **üres** (csak szóköz),
- **Cím** (Title stílus),
- **címsor** (Heading 1–9, a szinttel),
- **táblázat** (cellában áll),
- **ál-cím:** nem címsorstílusú, de rövid (legfeljebb 100 karakter), nincs záró írásjele (`. , ; : ! ?`), és vagy félkövér, vagy csupa nagybetűs (legalább 3 betű),
- **szövegtörzs** (minden más).

### 3.3 A címsor-kérdés
Ha több címsorszint van (az ál-címek egy további szintnek számítanak), a modul rákérdez: *tudatosan van külön szint, vagy valójában mind ugyanolyan cím?*
- **Külön szintek:** a legnagyobb címsor a profil „címsor mérete”, az alacsonyabb szintek lépcsőzetesen kisebbek (szintenként 1 pt-tal, legfeljebb a szövegméret + 1 pt-ig, az ál-címek a legalacsonyabb címsorméretet kapják).
- **Mind egy szint:** minden cím egyforma méretű.

Fontos: **a stílus szintje (Címsor 1/2/3) mindkét esetben marad**, tehát a tartalomjegyzék és a navigációs ablak nem változik; csak a megjelenés. Amíg a kérdésre nincs válasz, az „Egységesítés” gomb tiltott.

### 3.4 Stílusprofil
A profil mezői: betűtípus, **szöveg színe** (pl. grafit), **kiskapitális címek**, **vonal a főcím alatt**, **csík a 2. szint mellett**, szöveg mérete, címsor mérete, lábjegyzet mérete, **címsorok betűtípusa** (üres: mint a szöveg), **címek színe** (nem változtat / fekete / sötétkék / sötétszürke / bordó / sötétzöld), bekezdés előtti és utáni térköz, címsor előtti és utáni térköz, sorköz (pont; 0 = nem változtat), első sor, bal és jobb behúzás (pont; 0 = nem változtat), **oldalmargók** (cm; 0 = nem változtat; csak ha a Word engedi), igazítás (sorkizárt / balra zárt).

Az alapérték a dokumentum leggyakoribb beállítása („Ebből a dokumentumból”). Egy jól formázott bekezdésre kattintva a „Szöveg: mint a kijelölt” és „Cím: mint a kijelölt” gombbal az onnan átvehető.

### 3.5 Kész stílusok

| Stílus | Betű | Igazítás | Jellemző |
|---|---|---|---|
| **ICT Europa Executive** (ajánlott) | Cambria 11 pt, grafit (#1A1A1A) szöveg; kiskapitális félkövér címek sötétkékben (#0B3B60) | sorkizárt | 1 pt-os kék (#2E75B6) vonal a főcím alatt, kék csík a második szint mellett; 18 pt a címek előtt, 6 pt után; címsor együtt marad a következővel |
| Klasszikus | Garamond 12 pt, cím 14 pt | sorkizárt | hagyományos szerződés |
| Modern | Calibri 11 pt, cím 14 pt | balra zárt | levegős térközök |
| Kompakt | Arial 10 pt, cím 11 pt | sorkizárt | szűk térközök, kevesebb oldal |
| Prémium | Cambria 11 pt, címek Calibri 14 pt | balra zárt | bőséges térközök (tanácsadói jelentés, ajánlat) |
| Jogi (angolszász) | Times New Roman 11 pt, cím 12 pt | sorkizárt | szűk, egyenletes (nemzetközi szerződés) |

A stílus kitölti a profilt; utána bármelyik érték átírható.

### 3.6 Kategóriák
Kategóriánként kapcsolható, a darabszámmal együtt („9 helyen”, „rendben”): betűtípus, betűméret, címsorok, lábjegyzetek, térközök, igazítás, színek, behúzások, „címsor együtt marad a következővel”, oldalmargók, **a Word saját stílusai is**. Külön csoport (Szövegfésülés), **alapból kikapcsolva**, mert a szöveget módosítják: nem törő szóközök, magyar idézőjelek, többszörös üres sorok törlése (egy marad; képet tartalmazó bekezdést nem töröl), dupla szóközök cseréje.

### 3.7 A terv (`planFormatting`)
A terv csak azt tartalmazza, ami **most eltér** a profiltól, így az újrafuttatás nem csinál semmit („rendben”). Szabályok szerepenként:
- **Címsor / ál-cím / Cím:** betűtípus (a címsorok betűtípusa vagy a szöveg betűtípusa), méret (szint szerint), félkövér, szín (ha választottál); előtte/utána térköz (a Cím kivételével). Az ál-cím félkövér lesz.
- **Szövegtörzs:** betűtípus, méret, térközök, sorköz, első sor / bal / jobb behúzás, igazítás. **Számozott vagy felsorolásos bekezdés behúzásához nem nyúl** (az a listához tartozik). A **középre vagy jobbra igazított** bekezdés (cím, keltezés, aláírás) igazítása marad.
- **Táblázat:** csak betűtípus és méret, hogy a táblázat elrendezése ne változzon.
- **Lábjegyzet:** betűtípus és méret.
- **„Címsor együtt marad a következő bekezdéssel”:** nem bekezdésenként, hanem a címsorstílusokon (Címsor 1, 2…, Cím) állítja be egyszer (`Style.paragraphFormat.keepWithNext`, WordApi 1.5), így a stílust használó összes cím ilyen lesz. Az ál-címekre (Normál stílus) nem hat, mert azok stílusa a szövegtörzsé is.
- **Oldalmargók:** minden szakaszra (`Section.pageSetup`, WordApiDesktop 1.3); csak azt az oldalt állítja, amelyiknek értéket adtál meg és eltér. Ha a Word ezt nem támogatja, a mezők el sem jelennek.
- **A Word saját stílusai** (alapból be): a Normál stílus (betűtípus, méret, szín, térközök, sorköz, igazítás), a dokumentumban használt címsorszintek stílusai (betűtípus, méret, félkövér, szín, kiskapitális, térközök) és a Cím stílus is megkapja az új formát (`Style.font`, `Style.paragraphFormat`, WordApi 1.5). Így az utána begépelt új bekezdések is egységesek. A legfelső címsorszint stílusa kapja az alsó díszvonalat, a második a bal oldali csíkot (`Style.borders.getByLocation`, WordApiDesktop 1.1; 1 pt, egyszerű vonal). A stílusokat a dokumentumban használt, a Word nyelvén ismert nevükön („Címsor 1”, „Normál”) keresi meg, ha nincs ilyen bekezdés, az angol névvel próbálja.
- **Táblázatcellák védelme a stílusfrissítésnél:** mivel a Normál stílus új térközt és igazítást kap, a táblázatcellák bekezdésein a mostani térköz, sorköz és igazítás közvetlenül rögzítésre kerül, így a táblázatok elrendezése nem változik.
- **Kiskapitális:** a címekre közvetlenül is (`font.smallCaps`, WordApiDesktop 1.3) és a stílusra is; az ál-címek (Normál stílusú címek) közvetlenül kapják, díszvonalat viszont nem (az a stíluson keresztül megy, és a Normál stílusra nem tehető).
- **Mikrotipográfia** (csak ha bekapcsolod, korrektúrával): nem törő szóköz a § után (`§ 5`), törvényhivatkozásban (`2013. évi V. törvény / tv.`), dátumban (`2026. október 3.`), pénzösszegben (`1 250 000 Ft`, `500 EUR`); egyenes idézőjelek helyett „…”. Csak a szóközök és az egyenes idézőjelek változnak, a szavak nem. Az idézőjelpár iránya: nyitó a bekezdés elején vagy szóköz, zárójel után, záró egyébként; ha a Word keresése egy bekezdésben más számú egyenes idézőjelet talál, mint amennyit a terv vár, azt a bekezdést kihagyja és jelzi.
- Minden más (félkövér, dőlt, aláhúzott kiemelések egy bekezdésen belül, számozás, hivatkozások, mezők) érintetlen.

### 3.8 Alkalmazás (`applyFormatPlan`)
1. Ellenőrzi, hogy a dokumentum bekezdései (száma és szövege) megegyeznek az átvilágításkor olvasottal; ha nem, **nem nyúl semmihez**, újra kell átvilágítani.
2. **Korrektúra nélkül** írja a formázást: kikapcsolja a Word „Változások követése” módját, beállítja a formátumokat, és `finally` ágban visszaállítja a felhasználó eredeti beállítását. (Indok: egy tárgyalt szövegben a formázási korrektúra csak zaj a másik félnek.)
3. A szöveget módosító lépések (üres sorok, dupla szóközök) a program általános korrektúraszabálya szerint mennek be: korrektúrával, vagy ha a felhasználó korrektúra nélküli beírást kért, akkor is korrektúrával, ha a dokumentumban el nem fogadott korrektúra van.
4. Hibánál újraolvas, és megmondja, hogy ha valami félig átállt, az előző állapot megnyitható.

### 3.9 Előző állapot (mentés a visszaúthoz)
Alkalmazás előtt `Office.context.document.getFileAsync(Compressed)` szeletekben kiolvassa a teljes .docx-et (korrektúrákkal, megjegyzésekkel együtt). A felületen megjelenik az **első** és a **legutóbbi** egységesítés előtti állapot: „Megnyitás új ablakban” (`Application.createDocument(base64).open()`, WordApi 1.3) vagy „Letöltés”. Ha a mentés nem sikerül, az egységesítés csak kifejezett „Mentés nélkül folytatom” után megy tovább.

## 4. Biztonsági háló – összefoglaló

- A szöveghez nem nyúl (kivéve a két, alapból kikapcsolt opciót).
- A számozás, a címsorszintek, a kiemelések megmaradnak.
- Változott dokumentumhoz nem nyúl.
- Egységesítés előtt teljes mentés, új ablakban megnyitható.
- A felhasználó korrektúra-beállítását mindig visszaállítja.
- A VISSZAALLITAS.bat a modul előtti, stabil változatra is visszaállítja az egész programot (`97690ef`).

## 5. Tesztelés

- Egységtesztek (`formatting.test.ts`): szerepek, összegzés, terv (címsorlépcső, táblázat, igazítás, lábjegyzet), kategóriák, kész stílusok, címsor-betűtípus, behúzás, szín, listák kihagyása, címsor együtt marad, margók.
- Böngészős teszt Word-szimulátorral (`ui-format.mjs`): átvilágítás, címsor-kérdés, alkalmazás korrektúra nélkül, a Word-beállítás visszaállítása, szöveg érintetlensége, előző állapot, szöveget módosító opciók, megváltozott dokumentum, mentés nélküli folytatás, profil a kijelölésből.
- **Valódi Wordben még nem lett kipróbálva.** A szimulátor az Office.js viselkedését modellezi, de nem azonos vele.

## 6. Ismert korlátok és nyitott kérdések

1. **Sorköz:** a Word `lineSpacing` értéke pont; a „többszörös” sorköz (pl. 1,15) átváltása szabálytalan lehet. Valódi Wordben ellenőrizendő.
2. **Lábjegyzetek:** WordApi 1.5 kell; régebbi Wordben kimaradnak (a felület ezt nem mutatja).
3. **Stílusok és közvetlen formázás együtt:** a modul a bekezdésekre közvetlenül is ír (így a meglévő, kézzel formázott szöveg biztosan egységes lesz), és a Word stílusait is frissíti (így az új szöveg is). A stílusfrissítés kikapcsolható. Kockázat: más stílusok, amelyek a Normálra épülnek (pl. listabekezdés), örökölhetik az új térközt; ezt valódi Wordben ellenőrizni kell.
4. **Számozott listák:** a lista bal behúzása és függő behúzása a Wordben a számozáshoz tartozik; az első sor behúzásának változtatása listaelemen kerülendő.
5. **Ál-cím felismerés:** heurisztika (rövid, félkövér vagy csupa nagybetű, nincs záró írásjel); téves találat lehetséges (pl. aláírásnál egy név), ezért ki lehet venni a pipát.
6. **Vegyes betűtípusú bekezdés:** az egész bekezdés egy betűtípust kap (a kiemelések megmaradnak).
7. **Nem kezeli:** élőfej/élőláb, táblázatstílusok, a szövegtörzs színe, felsorolásjelek, szövegdobozok, szakaszonként eltérő margók (mindegyik szakaszra ugyanazt állítja).
8. **A „címsor együtt marad” a stílust módosítja,** nem a bekezdéseket: ha a dokumentum a címsorstílusokat más célra is használja, mindenhol érvényes lesz. A mentett előző állapot ezt is visszaadja.
9. **Kiskapitális, díszvonal, margók:** asztali Word kell hozzájuk (WordApiDesktop); ahol nincs, a többi lefut, és a program megmondja, mi maradt ki.
10. **Mikrotipográfia:** szabályalapú; ritkább formákat (pl. „Ptk. 6:98. §”, „1.000.000,- Ft”) nem ismer fel.
11. **A margók és a stílus szabályai még ellenőrizendők valódi Wordben** (az API-k újabb Word-változatokat igényelnek, és a szimulátor nem azonos a Worddel).

## 7. Utólag bekerült bővítések
- Második kör: címek színe, bal és jobb behúzás, „címsor együtt marad a következő bekezdéssel”, oldalmargók.
- Prémium átalakítás: ICT Europa Executive stílus, kiskapitális címek, díszvonal és csík, grafit szövegszín, a Word saját stílusainak frissítése, magyar jogi mikrotipográfia, új felület (stíluskártyák, élő előnézet, tömör állapotsor, lenyitható finomhangolás).

Mind kategóriánként kapcsolható, és ugyanazt a védelmet kapja, mint a többi (átvilágítás, terv, mentés előtte, korrektúra nélküli írás, a Word-beállítás visszaállítása).

## 8. Kérdések, amiket érdemes megbeszélni

- Mi legyen az ál-cím felismerés szabálya, és kell-e a felhasználónak bekezdésenként jóváhagyni?
- A kész stílusokhoz tartozzanak-e margók, élőfej/élőláb, oldalszámozás?
- Kell-e a stílusok mentése és megosztása irodán belül (saját „arculat” mentése, importálása)?
- Hogyan lehetne a végeredményt biztonságosabban ellenőrizni (előnézet a dokumentumban az alkalmazás előtt)?
