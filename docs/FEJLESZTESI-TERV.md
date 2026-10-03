# Fejlesztési terv (II. fázis)

*Frissítve: 2026. október 3. Ez a fájl az állapotjelző: minden lépés után frissül.*

**Az I. fázis és a 14 pontos fejlesztési lista** (kiküldés előtti ellenőrzés, szám–betű egyezés, hányadok, felek
elnevezése, számozás, definiált fogalmak, élőfej/élőláb, aláírási blokk, tartalomjegyzék, irodai stílusok, kétnyelvű
szinkron frissítés, Microsoft-belépés, hibajelentés): **kész**. A kód tesztelve van, de valódi Wordben még nem
próbáltuk ki; ehhez: [TESZT-WORDBEN.md](TESZT-WORDBEN.md).

A piacvezetőkkel való összevetés után (2026. október) ezek a tételek maradtak. Mindegyiknek rövid kódneve van, így
lehet rájuk hivatkozni.

| Kód | Mit | Állapot | Megjegyzés |
|---|---|---|---|
| `felho` | Felhős szerver (Cloud Run, EU) és központi kiadás a Microsoft 365-ben | kód kész, élesben nem kipróbálva | [FELHO-TELEPITES.md](FELHO-TELEPITES.md) |
| `playbook` | Iroda szabálykönyve záradéktípusonként (standard, Fallback 1, Fallback 2, walk-away), egy gombnyomásos ellenőrzés emberi jóváhagyással, kísérőlevél | **folyamatban** | a tartalmát jogász írja; Autopilot (beavatkozás nélküli beírás) nem lesz |
| `jogref` | Jogszabály- és határozat-hivatkozások felismerése a Szerkezet fülön, megnyitás az njt.hu-n vagy a bírósági határozatok oldalán | tervezett | kulcs és licenc nélkül |
| `tobbagens` | Többágensű „Alapos” átvizsgálás: szakterületi kérések párhuzamosan, majd összegzés | tervezett | használatkor kb. 5–7-szeres tokenköltség |
| `zaradektar` | Mintazáradék-tár egy SharePoint-mappából, a Microsoft-belépésre építve | tervezett | előbb: ki gondozza, mi kerülhet bele |
| `apijog` | Automatikus „létezik-e, hatályos-e” ellenőrzés kereskedelmi jogtár API-jával | **félretéve** | lásd lent |
| `benchmark` | Piaci statisztikai összevetés | **elvetve** | magyar piacra nincs adat |

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
