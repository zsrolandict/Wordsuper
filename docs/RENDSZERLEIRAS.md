# Word Writer – rendszerleírás

*Állapot: 2026. október, `phase-1` ág. A dokumentum egy másik AI-val (pl. Gemini) vagy fejlesztővel való egyeztetéshez készült: mit tud a rendszer, hogyan működik, hol vannak a korlátai, és mik a nyitott kérdések.*

## 1. Mi ez és kinek szól

A Word Writer egy **Microsoft Word bővítmény** (Office Add-in). Jogi és üzleti tanácsadóknak, ügyvédeknek készült, akik szerződéseken és hosszú dokumentumokon dolgoznak. A Word jobb oldalán egy munkaablakban fut. Minden változtatást alapból **korrektúrával** (Track Changes) tesz a dokumentumba, a véleményét **Word-megjegyzésként**. Mielőtt bármi bekerül, a felhasználó látja a javaslatot, és ő dönt.

Alapelvek:
- **Az ember dönt.** Előnézet, szó szintű különbség, elfogadás, másik változat vagy elvetés, finomítás párbeszédben.
- **Átláthatóság.** Minden válasznál lenyitható a „Részletek”: mit kapott az AI, mit nem látott, mit rejtettünk el előle, és hogyan gondolkodott.
- **A formázás védelme.** Csak a ténylegesen megváltozott szavakhoz nyúl; a többi szöveg formázása érintetlen marad.
- **Adatvédelem.** A neveket és azonosítókat még a gépen helyettesítőkre cseréljük, mielőtt bármi az AI-hoz kerülne.

## 2. Felépítés

```
Word (asztali / Word Online)
 └─ Munkaablak (React + TypeScript, Office.js / WordApi 1.4)
      ├─ Word-réteg: olvasás, korrektúrás írás, megjegyzések, keresés
      ├─ Tiszta logika: szódiff, bekezdés-illesztés, szerkezeti elemző, maszkolás, összevetés
      └─ HTTPS → saját szerver
Szerver (Node.js + Express)
 ├─ Hozzáférési kulcs (X-Access-Key), percenkénti kéréskorlát (20/perc/IP)
 ├─ Prompt-építés módonként, JSON-séma a strukturált válaszokhoz
 ├─ Folyamatos válasz (SSE): szöveg, gondolkodás-összefoglaló, modell és feldolgozási hely
 └─ AI-szolgáltató réteg: Gemini API vagy Vertex AI (EU régió választható)
```

- **Modell:** alapértelmezés szerint `gemini-3.8-flash` (az `AI_MODEL` változóval állítható).
- **Szolgáltató:** `AI_PROVIDER=gemini` (API-kulccsal) vagy `vertex` (Google Cloud projekt, pl. `europe-west1`). Utóbbinál a dokumentum az EU-ban kerül feldolgozásra.
- **Hibakezelés:** a félbeszakadt vagy csonka válasz (a modell nem jelez rendes befejezést) hibának számít. Ilyenkor a dokumentumhoz nem nyúlunk.
- **Megszakítás:** a felhasználó bármikor leállíthatja a kérést; a szerver ekkor az AI-hívást is megszakítja.

## 3. Nézetek és módok

### 3.1 Asszisztens fül – négy mód

| Mód | Mit csinál | Kijelöléssel | Kijelölés nélkül |
|---|---|---|---|
| 📝 **Szerkesztés** | Átírja a szöveget az utasítás szerint | A kijelölt részt | Az **egész dokumentumot** (legfeljebb 50 000 karakter) |
| 💬 **Vélemény** | Rövid elemzés Word-megjegyzésként | A kijelölésről, oda | Az egész dokumentumról, a kurzor bekezdéséhez |
| ✨ **Generálás** | Új szöveg (záradék, aláírósor…) | A kijelölés helyére | A kurzor helyére |
| 🔍 **Átvizsgálás** | A teljes dokumentum átnézése, észrevétel-lista | – | Mindig a teljes dokumentum (400 000 karakterig) |

**Szerkesztés részletei:**
- Az AI a javított szöveg után röviden megindokolja a változtatást („Miért?”). Egy jelölőnégyzettel ez **magyarázó megjegyzésként** a módosítás mellé tehető. Alapból ki van kapcsolva; ha az utasításban szerepel pl. „megjegyzés” vagy „indokold”, magától bejelölődik.
- Az előnézet szó szintű különbséget mutat (piros áthúzás / zöld beszúrás).
- Beíráskor csak a megváltozott szavak cserélődnek, korrektúrával.
- Egész dokumentumnál bekezdés-illesztés fut. A változatlan bekezdésekhez nem nyúl; az újakat (pl. aláírósor a végén) beszúrja, az elhagyottakat törli, a módosultakban csak a szavakat cseréli.
- Mielőtt beírja, ellenőrzi, hogy a dokumentum nem változott-e a kérés óta.
- Ha a kijelölésben még el nem fogadott korábbi korrektúra van, az AI a korrektúrák elfogadása utáni tiszta szöveget kapja. Ilyenkor beíráskor az egész kijelölés cserélődik (korrektúrával).

**Átvizsgálás részletei:**
- Az AI JSON-listát ad vissza, legfeljebb 15 észrevétellel. Mindegyikben van szó szerinti idézet, megjegyzés, súlyosság (magas / közepes / alacsony), és ha szövegcserével javítható, **javasolt szöveg** is.
- A felhasználó észrevételenként dönt: **Megjegyzés**, **Javítás korrektúrával**, vagy mindkettő.
- **Egyenkénti döntés:** minden észrevételnél van **Mutasd** (kijelöli az idézett részt a dokumentumban), **Elfogadom** (csak azt szúrja be, és odaugrik) és **Elvetem** gomb. A tömeges gomb csak a még el nem döntötteket kezeli.
- **Következetesség:**
  - Minden beírás után AI nélkül lefut a szerkezeti ellenőrzés. Ha a javítás új problémát okozott (pl. megszűnt egy hivatkozott pont), azonnal jelzi.
  - Ha a felhasználó csak részben fogad el, **„Ellenőrző átvizsgálás”** indítható. Ez közli az AI-val, mit fogadott el és mit vetett el, és a számozás, a hivatkozások, a fogalmak és a logika következetességét nézeti át.
- A javítás csak akkor kerül a szövegbe, ha az idézet szó szerint megtalálható. Ha nem, a javasolt szöveg a megjegyzésbe kerül, hogy ne vesszen el.
- Az átvizsgálás a Word **automatikus számozását** is látja, szögletes zárójelben (`[5.2.] …`), így a pontszámozást és a kereszthivatkozásokat is ellenőrizni tudja.

**Gyorsgombok:**
- Beépített gyorsgombok minden módhoz. Átvizsgálásnál például: Kockázatok és hiányosságok, Ellentmondások keresése, **Jogszabályi hivatkozások**, **Kereszthivatkozások és számozás**, Helyesírás és stílus.
- A két új gomb egy-egy részletes utasítást küld. A jogszabályinál: létezik-e a hely, jó helyre mutat-e, oda illik-e, hatályos-e; bizonytalanság esetén jelezze, hogy a njt.hu-n ellenőrizni kell.
- Saját gyorsgombok módhoz rendelve.
- Ha a felhasználó begépeli egy gyorsgomb szövegét, a rendszer felismeri, és a beszélgetésben „⚡ Saját gyorsgomb” címke jelzi. A más módhoz mentett saját gyorsgomb a saját módjában fut.

**Diktálás (mikrofon):**
- Az utasítás mező mellett mikrofon gomb van: a felhasználó elmondja, mit szeretne, a felvétel szöveggé alakul, és az utasítás mezőbe kerül.
- **Alapértelmezés: helyi felismerés.** Whisper modell fut a munkaablak háttérszálán (Transformers.js, WebGPU vagy WebAssembly); a hangfelvétel nem hagyja el a gépet.
  - Első használatkor egyszer letölti a modellt (base kb. 80 MB, small kb. 250 MB).
  - Az ONNX-futtatót a saját szerverünk adja, nem CDN.
- **Felhős átírás:** csak a Beállításokban választható.
  - Vertex AI EU-régióban (`europe-*` vagy `eu`) szabadon megy.
  - Máshol (Gemini API) a felhasználónak ki kell jelölnie az „Elfogadom, saját felelősségemre” négyzetet; az auditnapló külön jelöli. Az üzemeltető letilthatja (`DICTATION_POLICY=eu-only`).
- Döntés: felvétel utáni (kötegelt) átírás, élő felirat nincs. Hangos módváltás sincs.
- A szöveget elküldés előtt még át lehet javítani.
- Egy felvétel legfeljebb kb. 2 perc. Felvétel közben futó óra és leállítás gomb látszik.
- Word Online-ban az első használatkor az Office engedélyt kér a mikrofonhoz, utána a bővítmény egyszer újratöltődik.
- A diktált szöveg a küldéskor ugyanúgy maszkolódik, mint a begépelt.

**Szándékfelismerés:** ha Szerkesztés vagy Vélemény módban az egész dokumentum átnézését kérik (pl. „nézd át, van-e benne ellentmondás”), egy kis gomb felajánlja az Átvizsgálást. Magától sosem vált módot.

**Hangjelzés:** halk, kéthangú csengés, ha elkészült a válasz, és egy mélyebb hang hiba esetén, így közben nyugodtan lehet a dokumentumban dolgozni. A Beállításokban ki- és bekapcsolható, és ki is próbálható.

**Visszakérdezés:** ha az utasítás nem egyértelmű (elgépelt vagy félrediktált, vagy több ésszerű olvasata van), az AI nem találgat. Megkérdezi, mire gondolt a felhasználó, és 2–3 kész utasítást ajánl egy kattintással; más választ alul lehet beírni. Ez a Szerkesztés, a Vélemény és a Generálás módban működik.

**Gondolkodás:** a küldés fölött lehet választani.
- **Automatikus** (alapértelmezés): a modell maga dönti el, mennyit gondolkodjon.
- **Gyors:** alacsony gondolkodási szint.
- **Alapos:** magas gondolkodási szint, és ha be van állítva, erősebb modell (`AI_MODEL_DEEP`).
- Mély kutatás (Deep Research) szándékosan nincs: az a nyílt weben keres, és a Google 30 napig tárolja hozzá az adatokat.

**Képviselt fél:** a munkaablak tetején („Képviselt fél: Vevő”) megadható, kit képviselünk a dokumentumban.
- A program a dokumentum feleit felajánlja (pl. „(székhely: …; a továbbiakban: Eladó)” alapján), de bármi beírható.
- Az AI ennek a félnek a szemszögéből vizsgál, szerkeszt és értékel (Asszisztens és Összevetés), de nem tesz egyoldalúbbá vagy agresszívabbá semmit, mint amit az utasítás kér.
- Dokumentumonként, ezen a gépen jegyezzük meg; a fájlba nem írjuk bele, így a másik félhez sem jut el. Név (pl. cégnév) esetén a maszkolás erre is vonatkozik.
- A Részletek panelen látszik, kinek a szemszögéből dolgozott az AI.

**Finomítás:** amíg egy javaslat döntésre vár, az új utasítás azt módosítja („legyen rövidebb”). Az AI az első és a legutóbbi köröket látja, legfeljebb 5-öt.

### 3.2 Szerkezet fül (AI nélkül, azonnal)

- **Definíciók felismerése:** „(a továbbiakban: Megbízó)” és „„Szerződés”: jelenti…” formában.
- **Kereszthivatkozások:** például „5.2. pont”, „3. számú melléklet”. A pontcímkéket a Word automatikus számozásából építi fel, szintenként.
- **Kurzor alatti súgó:** egy fogalomra vagy hivatkozásra kattintva megjelenik a definíció, illetve a hivatkozott pont szövege, görgetés nélkül. Van „Ugrás” és „Vissza oda, ahol voltál” gomb.
- **Javaslat gomb** minden javítható problémánál: a rendszer kijelöli a bekezdést, és a Szerkesztés módtól korrektúrás javítást kér.
  - Hibás hivatkozásnál a dokumentum létező pontjainak listájával.
  - Nem használt vagy kétszer definiált fogalomnál a definíció rendezésével.
  - Idézőjeles, de nem definiált kifejezésnél **Definiálás** gomb.
- **Fogalommeghatározások fejezet készítése:** a meglévő definíciókból betűrendes fejezetet generál, és beszúrja a bevezető végére, az első számozott pont elé.
- **Problémalista:**
  - hibás hivatkozás (nem létező pont);
  - duplikált definíció;
  - definiált, de nem használt fogalom;
  - idézőjeles, de nem definiált kifejezés (csak ha többször is előfordul);
  - hiányzó melléklet (csak jelzés, mert lehet külön fájl).

### 3.3 Összevetés fül

Két forrásból dolgozik:
- **A dokumentum korrektúrái:** ha a másik fél korrektúrával küldte vissza a szerződést, a rendszer bekezdésenként összeveti a korrektúrák előtti és utáni szöveget.
  - Változásonként látszik a szerző; szerzőnként ki lehet hagyni (pl. a saját kollégánk korábbi módosításait), és ezek az AI-hoz sem kerülnek.
  - Változásonként **Elfogadom a korrektúrát / Elutasítom** gomb, ami a Wordben dönt. Csak a látható szerzők szövegkorrektúráira hat: az elrejtett szerzőkéhez és a formázási korrektúrákhoz nem nyúl, és ezt meg is mondja. Utána a lista újraolvasódik, a többi változás AI-értékelése megmarad. (Szerző és elfogadás: WordApi 1.6, Microsoft 365; régebbi Wordben az elemzés és a megjegyzések működnek.)
- **Korábbi változat (.docx):** ha korrektúra nélkül módosítottak, a felhasználó feltölti azt, amit ő küldött ki, és a rendszer ahhoz veti össze a megnyitott dokumentumot.

Mindkét esetben:
- jelöli, mi módosult, mi új és mi törölt;
- az AI változásonként kockázati értékelést és javaslatot ad, a képviselt fél szemszögéből;
- ezek megjegyzésként beszúrhatók a megváltozott bekezdésekhez.

### 3.4 Kétnyelvű fül (fordítás két oszlopban)

- A megnyitott dokumentumot bekezdésenként lefordítja (most: magyar ↔ angol), és **új dokumentumba** teszi: fekvő A4, kétoszlopos táblázat, balra az eredeti, jobbra a fordítás. A megnyitott dokumentumhoz nem nyúl.
- **A két oldal nem csúszhat el:** minden bekezdés egy sor. Az AI bekezdésenként, azonosítóval kapja a szöveget, és minden azonosítóra pontosan egy fordítást kell adnia. Amit kihagy, azt a program egyszer külön újra kéri; ami ezután is hiányzik, ott a jobb oldalon piros „Nem sikerült lefordítani – fordítsd kézzel” áll, a sor sosem üres.
- Word automatikus számozása („5.2.”) mindkét oldalon megjelenik, a címsorok félkövérek, a fejléc minden oldalon ismétlődik, egy sor nem törik két oldalra.
- **Egységes szakszavak:** a definiált fogalmakat (a Szerkezet fül elemzőjével) előbb külön lefordítja, és ezt a fogalomtárat a teljes szövegben kötelezően használja (Vevő → Buyer).
- **Hosszú dokumentum:** kb. 12 000 karakteres részekben fordít, folyamatjelzővel („3/12 rész”) és Leállítás gombbal. Ha egy válasz túl hosszúra nyúlna, a részt kettéosztja; percenkénti kéréskorlátnál fél percet vár. Legfeljebb 400 000 karakter.
- **Adatvédelem:** ugyanaz a maszkolás, mint máshol; egy futáson belül minden részben ugyanaz az érték ugyanazt a helyettesítőt kapja. A küldés előtti ellenőrzés az első kérésnél jelenik meg. A fordításba a valódi adat kerül vissza; fel nem oldott helyettesítő nem kerülhet a kész dokumentumba (az a sor figyelmeztetést kap).
- Az el nem fogadott korrektúrákat elfogadott állapotukban fordítja.
- A kész dokumentum új, mentetlen Word-ablakban nyílik meg (WordApi 1.3); ha ez nem megy, letölthető .docx-ként.
- Az irányt a program a szöveg alapján kitalálja, egy gombbal megfordítható.

### 3.5 Formázás fül (AI nélkül)

- **Átvilágítás:** betűtípusok és -méretek (hány bekezdésben melyik), térközök, címsorok szintenként, stílus nélküli „ál-címek” (rövid, félkövér vagy csupa nagybetűs sor záró írásjel nélkül), lábjegyzetek mérete, többszörös üres sorok, dupla szóközök.
- **Címsor-kérdés:** ha több címsorszint van (az ál-címek egy további szintnek számítanak), megkérdezi: tudatosan külön szintek-e (a magasabb szint nagyobb), vagy valójában mind egy szint (mind egyforma). Válasz nélkül nem lehet egységesíteni. A számozás és a tartalomjegyzék szintjei mindkét esetben maradnak: csak a megjelenés változik, a stílus nem.
- **Kész stílusok:** Klasszikus (Garamond), Modern, Kompakt, Prémium (Cambria), Jogi (angolszász, Times New Roman), plusz „Ebből a dokumentumból”.
- **Egységes stílus:** betűtípus, szövegméret, címsorméret, lábjegyzetméret, bekezdés utáni és címsor előtti térköz, igazítás (sorkizárt / balra zárt). Alapérték a dokumentum leggyakoribb beállítása; a „mint a kijelölt” gombbal egy jól formázott bekezdésről vagy címről is átvehető.
- **Felület:** tömör állapotsor, stíluskártyák (kiemelve az **ICT Europa Executive**: Cambria, grafit szöveg, kiskapitális sötétkék címek, kék vonal a főcím alatt, kék csík a második szint mellett), élő előnézet, egy nagy „Egységesítés” gomb; a pontos értékek a lenyitható „Részletes beállítások és finomhangolás” alatt.
- **A Word saját stílusai is** frissülnek (Normál, Címsor 1…, Cím), így az utána begépelt szöveg is egységes; a táblázatcellák térköze és igazítása ilyenkor rögzítésre kerül.
- **Belső fülek:** Stílusok (kártyák, saját stílusok, előnézet) | Kézi (minden érték, saját stílus mentése/frissítése/törlése) | Szöveg (szövegtisztítás, üres sorok, AI-nyomok) | Kategóriák.
- **Üres sorok:** „Minden üres sor (a térköz veszi át)” – a térközként használt üres bekezdések törlődnek; a táblázat melletti, az aláírásvonal fölötti, a törést vagy képet tartalmazó sor marad.
- **Szövegtisztítás** (alapból ki, korrektúrával): gondolatjelek (— és - helyett –), Markdown-maradványok (**félkövér** → valódi félkövér), magyar idézőjelek, nem törő szóközök, tartományok (2020–2025), szóközök az írásjeleknél, dupla szóközök.
- **AI-nyomok** (csak jelzés, ugrással): tipikus AI-fordulatok, angolos nagybetűs címek, hosszú félkövér bekezdések, láthatatlan karakterek, emojik.
- **Egységes stílus mezői:** betűtípus, címsorok betűtípusa, méretek, bekezdés előtti/utáni és címsor előtti/utáni térköz, sorköz, első sor/bal/jobb behúzás, címek színe, oldalmargók (asztali Word), igazítás. Részletek: [FORMAZAS-MODUL.md](FORMAZAS-MODUL.md).
- **Kategóriánként kapcsolható**, darabszámmal: betűtípus, betűméret, címsorok, lábjegyzetek, térközök, igazítás, címek színe, behúzások, „címsor együtt marad a következővel”, oldalmargók. A középre és jobbra igazított bekezdéshez (cím, keltezés, aláírás) nem nyúl; táblázatban csak a betűtípust és a méretet állítja. A félkövér, dőlt és aláhúzott kiemelések megmaradnak.
- **Szöveget módosító lehetőségek** (alapból kikapcsolva): többszörös üres sorok törlése (egy marad; képet tartalmazó bekezdés nem), dupla szóközök cseréje. Ezek a szokásos korrektúraszabály szerint kerülnek be.
- **A formázás korrektúra nélkül kerül be** (a formázási korrektúra a másik félnek csak zaj); a Word saját „Változások követése” beállítása utána visszaáll.
- **Visszaút:** egységesítés előtt a program elmenti a teljes dokumentumot (korrektúrákkal, megjegyzésekkel). Az első és a legutóbbi egységesítés előtti állapot egy kattintással új ablakban megnyitható vagy letölthető. Ha a mentés nem sikerül, csak kifejezett „Mentés nélkül folytatom” után megy tovább.
- Ha a dokumentum az átvilágítás óta változott, nem nyúl hozzá, hanem újra kell átvilágítani.
- Valódi Wordben még ellenőrizendő: a sorköz beállítása (a Word pontban adja meg), és a lábjegyzetek kezelése (WordApi 1.5 kell hozzá; régebbi Wordben a lábjegyzetek kimaradnak).

### 3.6 Biztonsági háló: semmi nem vész el, minden látszik, minden visszavonható

- **Részleges elfogadás mindenhol:**
  - Szerkesztésnél a javaslat minden változása kattintható. A kihagyott változásnál az eredeti szöveg marad, és csak a kiválasztottak kerülnek be.
  - Egész dokumentumos szerkesztésnél bekezdésenként pipa van.
  - Átvizsgálásnál észrevételenként dönthetsz (Elfogadom / Elvetem / Visszaállítom).
  - Az Összevetésnél változásonként: „Beszúrom ezt”. Minden megjegyzés csak egyszer kerülhet be.
- **Nem vész el a lábjegyzet, a mező, a kép:** ha egy javaslat beírása lábjegyzetet, végjegyzetet, mezőt (kereszthivatkozás, oldalszám), tartalomvezérlőt vagy képet törölne (mert az a megváltozó szóhoz tapad, vagy a bekezdés egészében cserélődne), a program nem írja be. Megmondja, melyik rész és melyik elem miatt; a változás a javaslatban egy kattintással kihagyható. Átvizsgálásnál ilyenkor csak a javítás marad ki, a megjegyzés bekerül.
- **Nem vész el, amit közben írtál:** ha a válaszra várva a kijelölt részbe gépelsz, a program beírás előtt észreveszi, és nem írja felül (Szerkesztés és Generálás). Az egész dokumentumos szerkesztés ugyanígy ellenőrzi a teljes dokumentumot.
- **Nem vész el, amit eldöntöttél:**
  - Egy félig eldöntött átvizsgálás nem zárul le kérdés nélkül (módváltás, Szerkezet-javaslat, Főmenü).
  - Ha közben mást jelölsz ki, a program megkérdezi: új kérés legyen az új kijelölésre, vagy a javaslat finomítása?
  - A „Másik változat” és az „Ellenőrző átvizsgálás” megkapja, mit fogadtál el és mit vetettél el.
- **Minden látszik:**
  - „Mutasd” a javaslatokon (a kijelölés, a beszúrás helye, egész dokumentumnál bekezdésenként), és elfogadás után a Word odaugrik.
  - A „Mutasd” egy már beszúrt javításnál az új szöveget keresi.
  - A Szerkezet fül az asszisztens módosításai után magától frissül.
- **Alapból minden korrektúrával kerül be**, a generált szöveg is.
  - A Beállításokban bekapcsolható a **korrektúra nélküli beírás** (saját első tervezethez). Ekkor a Word saját „Változások követése” beállítása dönt, és a munkaablakban végig látszik egy figyelmeztető sáv „Kikapcsolom” gombbal.
  - Biztonsági szabály: ha a dokumentumban el nem fogadott korrektúra van (tárgyalt szöveg), a program a beállítás ellenére korrektúrával ír, és ezt meg is mondja. Így semmi nem kerülhet be észrevétlenül egy a másik félnek szánt szövegbe.
  - Korrektúra nélküli beírásnál nincs „Visszavonom” gomb (nincs mit elutasítani); a Word Ctrl+Z-je működik.
- **Visszavonom:**
  - Elutasítja a javaslat korrektúráit, és törli a megjegyzéseit. Csak azokat, amelyeket ő szúrt be; a korábbi saját korrektúráidhoz és megjegyzéseidhez nem nyúl, akkor sem, ha ugyanabban a percben készültek (beírás előtt feljegyzi, mi volt már ott).
  - Az utolsó 10 beszúrásnál érhető el, és WordApi 1.6 kell hozzá (Microsoft 365).
- **Újratöltés:** a Beállítások alján „Bővítmény újratöltése” gomb (ha a bővítmény nem válaszol). Ha a szerveren újabb verzió fut, mint amivel a munkaablak betöltődött, egy sáv felajánlja az újratöltést. Ha van folyamatban lévő beszélgetés, előtte rákérdez.
- **Nem pörög a végtelenségig:** a szerver gondolkodás közben 20 másodpercenként életjelet küld; ha 90 másodpercig semmi nem jön, a munkaablak leállítja a várakozást és megmondja, hogy a dokumentumhoz nem nyúlt. A szerver egy válaszra legfeljebb 8 percet vár.
- **Félbeszakadt beírás:** ha egy egész dokumentumos beírás a Wordben menet közben hibára fut, a program megmondja, hogy egy része bekerült, és nem ajánlja fel újra (duplán kerülne be). A Word „Változások követése” beállítása hiba esetén is visszaáll.
- **Kérdez, mielőtt nagyot lépne:**
  - Kijelölés nélkül egy hosszabb dokumentum teljes átírása előtt megerősítést kér, és a beszélgetésben „egész dokumentum” jelölés látszik.
  - A diktálás letöltés vagy átírás közben megszakítható.
- **Szerkezet:** ha a fogalommeghatározások között és a szövegben zárójelben is definiálva van egy fogalom, jelzi, és egy kattintással (egyenként vagy egyszerre) korrektúrával törölhető a felesleges zárójeles definíció.

## 4. Adatvédelem – maszkolás

- **Alapból bekapcsolva** (Beállítások → Adatvédelem).
- **Az üzemeltető kötelezővé teheti** (`MASKING_POLICY=required`, ez az alapértelmezés): a szerver visszautasítja a maszkolatlan kérést, a Beállításokban a kapcsoló zárolva van, és a hibaüzenet megmondja, hol kell visszakapcsolni. `MASKING_POLICY=optional` esetén a felhasználó kikapcsolhatja. (Ez a véletlen ellen véd, nem egy szándékosan átírt kliens ellen.)
- **Küldés előtti ellenőrzés** (bekapcsolható): minden kérés előtt megjelenik, pontosan mit kap az AI, a helyettesítők kiemelve. Ha valami kimaradt, ott helyben elrejthető (a „Mindig elrejtendő kifejezések” közé is bekerül, és a kérés újra maszkolódik); csak a „Küldés” után megy ki bármi, a „Mégse” után semmi.
- Minden kérés előtt, még a gépen, szabályalapú felismeréssel helyettesítőre cseréli ezeket:

  | Kategória | Helyettesítő |
  |---|---|
  | cégnevek: rövid forma bármilyen írásmóddal (Kft., KFT., kft., GmbH…), kiírt forma (Korlátolt Felelősségű Társaság, Zártkörűen Működő Részvénytársaság, szövetkezet, alapítvány, e.v.), idézőjeles név, „ABCKft.” elírás; később a forma nélküli többszavas név is („a Napfény Invest”) | `[CÉG_n]` |
  | személynevek: kulcsszó után („képviseli:”, „Eladó:”), a felek blokkjában (név + születési adat, lakcím…), aláírósorban (név + szerepkör), ismert utónévvel magyar és nyugati sorrendben, „-né” alakban, titulussal (dr., ifj., özv.), toldalékkal („Kovács Annának”), csupa nagybetűvel; egy felismert név vezetékneve megszólítással vagy „-né” alakban („Kovács úr”, „Kovácsné”) | `[SZEMÉLY_n]` |
  | e-mail-címek | `[EMAIL_n]` |
  | telefonszámok | `[TELEFON_n]` |
  | bankszámlaszámok: bármely ország IBAN-ja, 2×8 / 3×8 számjegy kötőjellel vagy szóközzel | `[SZÁMLA_n]` |
  | adószámok (szóközzel is), közösségi adószám, adóazonosító jel | `[ADÓSZÁM_n]` |
  | cégjegyzékszámok | `[CÉGJEGYZÉK_n]` |
  | címek: irányítószámmal, vagy anélkül a nevük után (lakcím:, székhely:…) | `[CÍM_n]` |
  | helyrajzi számok, a „hrsz.” előtt és után | `[HRSZ_n]` |
  | TAJ, személyi igazolvány, személyi azonosító, útlevélszám | `[AZONOSÍTÓ_n]` |
  | születési dátum („szül.:”, „születési hely, idő:”, angolul is) | `[SZÜLETÉS_n]` |
  | a felhasználó saját listája | `[EGYÉB_n]` |

- **Szándékosan nem rejtjük el** az összegeket (vételár, kamat), a dátumokat és a jogszabályhelyeket: ezek nélkül az AI nem tudna számolni, határidőt és hivatkozást ellenőrizni.
- A szövegből előbb kiszűrjük a láthatatlan karaktereket (nulla szélességű szóköz, feltételes elválasztó), hogy ne takarhassanak el egy nevet vagy számot.

- Amit tévesen rejtene el (pl. egy hatóság nevét), azt a Részletek panelen a „Ne rejtsd” gombbal vagy a Beállításokban a „Soha ne rejtsd el” listán lehet kivenni.
- Ugyanaz az érték mindenhol ugyanazt a helyettesítőt kapja: a kijelölésben, a háttérszövegben és a finomítás minden körében is.
- Az AI utasítást kap, hogy a helyettesítőket változatlanul hagyja. A választ a gépen cseréljük vissza, már menet közben is (a félig megérkezett helyettesítőt addig elrejtjük).
- **Ha az AI eltorzítja a helyettesítőt**, azt is felismerjük és visszacseréljük: kisbetűvel, ékezet nélkül, szóközzel, kapcsos vagy zárójel nélkül, angolra fordítva (`[személy_1]`, `[SZEMELY_1]`, `[CÉG 1]`, `SZEMÉLY_1`, `[PERSON_1]`, `[COMPANY_1]`).
- **Kemény tiltás:** ha a visszacserélés után bármilyen írásmódú helyettesítő marad a válaszban (az AI kitalálta, vagy felismerhetetlenre torzította), az **nem kerülhet a dokumentumba**.
  - A „Beszúrás/Elfogadom” gomb ilyenkor nem működik, egyértelmű figyelmeztetéssel; az automatikus beszúrás kimarad.
  - Átvizsgálásnál és az Összevetés fülön csak az érintett észrevétel vagy megjegyzés áll meg, a többi beszúrható.
  - A beírás előtti utolsó lépésben a program újra ellenőrzi, akkor is, ha a gomb valahogy elérhető volt.
- Ha maga a dokumentum tartalmaz helyettesítőnek látszó szöveget (pl. egy sablonban `[CÉG_1]`), a saját helyettesítőink ezt a sorszámot átugorják, és a tiltás sem jelez rá.
- A „Részletek” panel táblázatban mutatja, mit rejtett el. Ha valami kimaradt, a felhasználó felveheti a „mindig elrejtendő kifejezések” közé.
- **Korlátok:**
  - A felismerés szabályalapú, nem tökéletes: egy ritka utónevű név kulcsszó, személyes adat vagy szerepkör nélkül a szöveg közepén átjuthat; ilyenkor a „mindig elrejtendő kifejezések” listája segít.
  - A kontextusból kikövetkeztethető információt (pl. egyedi ügyleti részletek) nem rejti el.

### 4.1 Hová küldhet adatot a munkaablak (Content Security Policy)

- A szerver minden oldalhoz tartalombiztonsági szabályt küld: a munkaablak csak a saját szerverünkhöz, a Microsoft Office.js kiszolgálójához és (a helyi diktáló modell egyszeri letöltéséhez) a Hugging Face-hez kapcsolódhat. Így egy esetleg kompromittált programcsomag sem tudná máshová küldeni a dokumentum szövegét: a böngésző blokkolja (kipróbálva: más címre küldés, rejtett kép).
- Képet, betűtípust is csak a saját szerverről tölthet; beágyazott objektum nem futhat.
- Vészkapcsoló: ha egy Word-változatban emiatt üres vagy hibás lenne a munkaablak, a `.env`-ben `CSP="off"` kikapcsolja (a szerver indításkor figyelmeztet).
- Nem véd az ellen, ha valaki a böngészőablakot egy másik oldalra navigálná; ilyen kód nincs a programban.

## 5. Korlátok (és miért)

| Mi | Érték | Megjegyzés |
|---|---|---|
| Szerkeszthető szöveg | 50 000 karakter | Az AI-nak a teljes szöveget vissza kell adnia; a hosszabbat nem írjuk át, hogy ne vesszen el semmi |
| Háttérszöveg (kontextus) | 200 000 karakter | Hosszabb dokumentumnál: eleje + címsorok + a kijelölés környéke |
| Átvizsgálás | 400 000 karakter | Ezen túl csak a dokumentum elejét nézi |
| Összevetés | 200 000 karakter | Változáslista |
| Kétnyelvű fordítás | 400 000 karakter | Kb. 12 000 karakteres részekben |
| Észrevételek száma | 15 / átvizsgálás | |
| Kérések | 20 / perc | A szerver védelme |

Ezek a **saját** korlátaink, nem a modellé; szükség esetén emelhetők. A korlátjelző sáv élőben mutatja, mekkora a dokumentum és a kijelölés, és figyelmeztet, ha valami nem fér bele.

## 5/B. Auditnapló

- Minden AI-műveletről egy JSON-sor készül, **tartalom nélkül**:
  - időpont, felhasználó, IP. Személyes hozzáférési kulccsal (`APP_ACCESS_KEYS`, kollégánként külön, egyenként visszavonható) a kulcs gazdája, ellenőrzötten (`verified: true`); közös kulccsal a Beállításokban beírt név, ellenőrizetlenül (`verified: false`);
  - művelet, méretek, maszkolás be/ki és a kitakart elemek száma;
  - modell, hely, státusz, időtartam, tokenszám.
- A napló a szerver naplójába (Cloud Logging) kerül, és ha be van állítva, fájlba is (`AUDIT_LOG_FILE`).
- Az INDITAS.bat figyelmeztet, ha a program mappája a OneDrive-on van: ilyenkor a `.env` (a kulcsokkal) és a naplófájl a felhőbe is szinkronizálódik, és a mappa megosztásával a kulcsok is továbbadódnak.
- Az adatvédelmi részletek külön dokumentumban vannak: [ADATVEDELMI-TAJEKOZTATO.md](ADATVEDELMI-TAJEKOZTATO.md).

## 6. Ismert korlátok, kockázatok

- **Jogszabály-ellenőrzés:** a modell tudása nem élő jogszabálytár. A hatályosságot és a friss módosításokat nem tudja biztosan. Ezért a prompt kifejezetten kéri, hogy a bizonytalant jelezze, és a njt.hu-t ajánlja.
  - *Nyitott kérdés:* bekössünk-e élő forrást (Nemzeti Jogszabálytár keresés, Gemini keresés-alapozás / grounding)?
- **Idézet-alapú elhelyezés:** az átvizsgálás megjegyzéseit a Word keresőjével helyezzük el. Ha a modell nem pontosan idéz, a megjegyzés nem kerül be (ezt jelöljük). A Word keresése legfeljebb 255 karakteres.
- **Táblázatok, élőfejek, lábjegyzetek:** a bekezdés-illesztés a törzsszöveg bekezdéseivel dolgozik. Táblázatcellán belüli új bekezdésnél a formázás eltérhet.
- **Asztali Word telepítése** (sideload) nehézkes volt. Word Online-ban a „Saját bővítmény feltöltése” működik. Egykattintásos helyi indító (HTTPS localhost) készül.

## 7. Kész az indításhoz

- **Egykattintásos helyi indító Windowsra:** `INDITAS.bat`.
  - Első indításkor telepíti a függőségeket, létrehozza a `.env`-et, és telepíti a HTTPS-tanúsítványt.
  - Minden indításkor lehúzza a legfrissebb változatot (ha van git), leállítja a régi szervert, törli a Word gyorsítótárát, újat indít a `https://localhost:3444` címen, és megnyitja a Wordöt a bővítménnyel.
  - A Beállítások alján látszik a felület és a szerver verziója (git commit); eltérésnél figyelmeztet.
- **Arculat:** ICT Europa Legal logó a fejlécben (a végleges logófájl még hiányzik).
- **Következő fázis (II.):** Microsoft-fiókos belépés (ellenőrzött felhasználó az auditnaplóban), költségkövetés ügyfélcímkénként.

## 8. Kérdések, amiket érdemes megbeszélni

1. Élő jogszabályi forrás: NJT-integráció vagy AI-keresés (grounding)? Adatvédelmi és költségvonzat?
2. Maszkolás: elég-e a szabályalapú felismerés, vagy kell helyi névfelismerő modell? Melyik adatkategóriák hiányoznak még (pl. rendszám, személyi igazolvány szám formátumai, cégek rövid nevei)?
3. Átvizsgálás: hány észrevétel a hasznos? Kell-e súlyosság szerinti szűrés, vagy kategóriák (jogi / pénzügyi / nyelvi)?
4. Ügyféltörténet, sablontár, saját záradékkönyvtár: melyik hozna a legtöbbet egy tanácsadónak?
5. Üzemeltetés: Vertex AI EU (adatrezidencia) vagy Gemini API (egyszerűbb)? Kell-e naplózás vagy auditnyom?
