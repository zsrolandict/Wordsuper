# Word Writer – rendszerleírás

*Állapot: 2026. szeptember, `phase-1` ág. A dokumentum egy másik AI-val (pl. Gemini) vagy fejlesztővel való egyeztetéshez készült: mit tud a rendszer, hogyan működik, hol vannak a korlátai, és mik a nyitott kérdések.*

## 1. Mi ez és kinek szól

A Word Writer egy **Microsoft Word bővítmény** (Office Add-in). Jogi és üzleti tanácsadóknak, ügyvédeknek készült, akik szerződéseken és hosszú dokumentumokon dolgoznak. A Word jobb oldalán egy munkaablakban fut. Minden változtatást **korrektúrával** (Track Changes) tesz a dokumentumba, a véleményét **Word-megjegyzésként**. Mielőtt bármi bekerül, a felhasználó látja a javaslatot, és ő dönt.

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
- **Felhős átírás:** csak a Beállításokban választható. A szerver csak akkor fogadja, ha Vertex AI-t használ EU-régióban (`europe-*` vagy `eu`); a Gemini API kulcsos módban elutasítja.
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

- A felhasználó feltölti a korábbi változatot (.docx). A rendszer bekezdés szinten összeveti a megnyitott dokumentummal, és jelöli, mi módosult, mi új és mi törölt.
- Az AI változásonként kockázati értékelést és javaslatot ad.
- Ezek megjegyzésként beszúrhatók a megváltozott bekezdésekhez.

### 3.4 Biztonsági háló: semmi nem vész el, minden látszik, minden visszavonható

- **Részleges elfogadás mindenhol:**
  - Szerkesztésnél a javaslat minden változása kattintható. A kihagyott változásnál az eredeti szöveg marad, és csak a kiválasztottak kerülnek be.
  - Egész dokumentumos szerkesztésnél bekezdésenként pipa van.
  - Átvizsgálásnál észrevételenként dönthetsz (Elfogadom / Elvetem / Visszaállítom).
  - Az Összevetésnél változásonként: „Beszúrom ezt”. Minden megjegyzés csak egyszer kerülhet be.
- **Nem vész el, amit eldöntöttél:**
  - Egy félig eldöntött átvizsgálás nem zárul le kérdés nélkül (módváltás, Szerkezet-javaslat, Főmenü).
  - Ha közben mást jelölsz ki, a program megkérdezi: új kérés legyen az új kijelölésre, vagy a javaslat finomítása?
  - A „Másik változat” és az „Ellenőrző átvizsgálás” megkapja, mit fogadtál el és mit vetettél el.
- **Minden látszik:**
  - „Mutasd” a javaslatokon (a kijelölés, a beszúrás helye, egész dokumentumnál bekezdésenként), és elfogadás után a Word odaugrik.
  - A „Mutasd” egy már beszúrt javításnál az új szöveget keresi.
  - A Szerkezet fül az asszisztens módosításai után magától frissül.
- **Minden korrektúrával kerül be**, a generált szöveg is.
- **Visszavonom:**
  - Elutasítja a javaslat korrektúráit, és törli a megjegyzéseit. Csak azokat, amelyeket ő szúrt be; a korábbi saját korrektúráidhoz nem nyúl.
  - Az utolsó 10 beszúrásnál érhető el, és WordApi 1.6 kell hozzá (Microsoft 365).
- **Kérdez, mielőtt nagyot lépne:**
  - Kijelölés nélkül egy hosszabb dokumentum teljes átírása előtt megerősítést kér, és a beszélgetésben „egész dokumentum” jelölés látszik.
  - A diktálás letöltés vagy átírás közben megszakítható.
- **Szerkezet:** ha a fogalommeghatározások között és a szövegben zárójelben is definiálva van egy fogalom, jelzi, és egy kattintással (egyenként vagy egyszerre) korrektúrával törölhető a felesleges zárójeles definíció.

## 4. Adatvédelem – maszkolás

- **Alapból bekapcsolva** (Beállítások → Adatvédelem).
- Minden kérés előtt, még a gépen, szabályalapú felismeréssel helyettesítőre cseréli ezeket:

  | Kategória | Helyettesítő |
  |---|---|
  | cégnevek (Kft., Zrt., Bt., GmbH…) | `[CÉG_n]` |
  | személynevek („képviseli:”, „ügyvezető”, „Eladó:” után) | `[SZEMÉLY_n]` |
  | e-mail-címek | `[EMAIL_n]` |
  | telefonszámok | `[TELEFON_n]` |
  | bankszámlaszámok (IBAN is) | `[SZÁMLA_n]` |
  | adószámok, adóazonosító jelek | `[ADÓSZÁM_n]` |
  | cégjegyzékszámok | `[CÉGJEGYZÉK_n]` |
  | címek | `[CÍM_n]` |
  | helyrajzi számok | `[HRSZ_n]` |
  | TAJ, személyi igazolvány | `[AZONOSÍTÓ_n]` |
  | születési adatok | `[SZÜLETÉS_n]` |
  | a felhasználó saját listája | `[EGYÉB_n]` |

- Amit tévesen rejtene el (pl. egy hatóság nevét), azt a Részletek panelen a „Ne rejtsd” gombbal vagy a Beállításokban a „Soha ne rejtsd el” listán lehet kivenni.
- Ugyanaz az érték mindenhol ugyanazt a helyettesítőt kapja: a kijelölésben, a háttérszövegben és a finomítás minden körében is.
- Az AI utasítást kap, hogy a helyettesítőket változatlanul hagyja. A választ a gépen cseréljük vissza, már menet közben is (a félig megérkezett helyettesítőt addig elrejtjük).
- A „Részletek” panel táblázatban mutatja, mit rejtett el. Ha valami kimaradt, a felhasználó felveheti a „mindig elrejtendő kifejezések” közé.
- **Korlátok:**
  - A felismerés szabályalapú, nem tökéletes (pl. kulcsszó nélküli személynév a szöveg közepén).
  - A kontextusból kikövetkeztethető információt (pl. egyedi ügyleti részletek) nem rejti el.

## 5. Korlátok (és miért)

| Mi | Érték | Megjegyzés |
|---|---|---|
| Szerkeszthető szöveg | 50 000 karakter | Az AI-nak a teljes szöveget vissza kell adnia; a hosszabbat nem írjuk át, hogy ne vesszen el semmi |
| Háttérszöveg (kontextus) | 200 000 karakter | Hosszabb dokumentumnál: eleje + címsorok + a kijelölés környéke |
| Átvizsgálás | 400 000 karakter | Ezen túl csak a dokumentum elejét nézi |
| Összevetés | 200 000 karakter | Változáslista |
| Észrevételek száma | 15 / átvizsgálás | |
| Kérések | 20 / perc | A szerver védelme |

Ezek a **saját** korlátaink, nem a modellé; szükség esetén emelhetők. A korlátjelző sáv élőben mutatja, mekkora a dokumentum és a kijelölés, és figyelmeztet, ha valami nem fér bele.

## 5/B. Auditnapló

- Minden AI-műveletről egy JSON-sor készül, **tartalom nélkül**:
  - időpont, felhasználói azonosító (Beállítások), IP;
  - művelet, méretek, maszkolás be/ki és a kitakart elemek száma;
  - modell, hely, státusz, időtartam, tokenszám.
- A napló a szerver naplójába (Cloud Logging) kerül, és ha be van állítva, fájlba is (`AUDIT_LOG_FILE`).
- Az adatvédelmi részletek külön dokumentumban vannak: [ADATVEDELMI-TAJEKOZTATO.md](ADATVEDELMI-TAJEKOZTATO.md).

## 6. Ismert korlátok, kockázatok

- **Jogszabály-ellenőrzés:** a modell tudása nem élő jogszabálytár. A hatályosságot és a friss módosításokat nem tudja biztosan. Ezért a prompt kifejezetten kéri, hogy a bizonytalant jelezze, és a njt.hu-t ajánlja.
  - *Nyitott kérdés:* bekössünk-e élő forrást (Nemzeti Jogszabálytár keresés, Gemini keresés-alapozás / grounding)?
- **Idézet-alapú elhelyezés:** az átvizsgálás megjegyzéseit a Word keresőjével helyezzük el. Ha a modell nem pontosan idéz, a megjegyzés nem kerül be (ezt jelöljük). A Word keresése legfeljebb 255 karakteres.
- **Táblázatok, élőfejek, lábjegyzetek:** a bekezdés-illesztés a törzsszöveg bekezdéseivel dolgozik. Táblázatcellán belüli új bekezdésnél a formázás eltérhet.
- **Asztali Word telepítése** (sideload) nehézkes volt. Word Online-ban a „Saját bővítmény feltöltése” működik. Egykattintásos helyi indító (HTTPS localhost) készül.

## 7. Kész az indításhoz

- **Egykattintásos helyi indító Windowsra:** `INDITAS.bat`. Első indításkor telepíti a függőségeket, létrehozza a `.env`-et, és telepíti a HTTPS-tanúsítványt. Minden indításkor elindítja a szervert a `https://localhost:3444` címen, és megnyitja a Wordöt a bővítménnyel.
- **Arculat:** ICT Europa Legal logó a fejlécben (a végleges logófájl még hiányzik).
- **Következő fázis (II.):** Microsoft-fiókos belépés (ellenőrzött felhasználó az auditnaplóban), költségkövetés ügyfélcímkénként.

## 8. Kérdések, amiket érdemes megbeszélni

1. Élő jogszabályi forrás: NJT-integráció vagy AI-keresés (grounding)? Adatvédelmi és költségvonzat?
2. Maszkolás: elég-e a szabályalapú felismerés, vagy kell helyi névfelismerő modell? Melyik adatkategóriák hiányoznak még (pl. rendszám, személyi igazolvány szám formátumai, cégek rövid nevei)?
3. Átvizsgálás: hány észrevétel a hasznos? Kell-e súlyosság szerinti szűrés, vagy kategóriák (jogi / pénzügyi / nyelvi)?
4. Ügyféltörténet, sablontár, saját záradékkönyvtár: melyik hozna a legtöbbet egy tanácsadónak?
5. Üzemeltetés: Vertex AI EU (adatrezidencia) vagy Gemini API (egyszerűbb)? Kell-e naplózás vagy auditnyom?
