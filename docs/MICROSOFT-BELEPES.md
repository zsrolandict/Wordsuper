# Microsoft-fiókos belépés (Office SSO) – beállítási útmutató

A Word Writer eddig hozzáférési kulccsal azonosított: közös kulccsal (`APP_ACCESS_KEY`) vagy kollégánként személyes
kulccsal (`APP_ACCESS_KEYS`). A Microsoft-fiókos belépésnél nincs kulcs. A bővítmény azt a munkahelyi fiókot használja,
amellyel a kolléga a Wordbe be van jelentkezve. Az auditnapló ellenőrzötten, névre szólóan rögzíti, ki mit futtatott,
például `"user": "kovacs.anna@iroda.hu", "verified": true, "auth": "microsoft"`.

## Hogyan működik

1. A munkaablak elkéri a Wordtől a belépési tokent (`Office.auth.getAccessToken`). Ha a Word már be van jelentkezve,
   ez ablak nélkül történik.
2. A token minden kéréssel a szerverhez megy (`Authorization: Bearer …`). Jelszó soha nem jut el a szerverhez.
3. A szerver a Microsoft nyilvános kulcsaival ellenőrzi a tokent. Csak akkor fogadja el, ha:
   - a Microsoft aláírása érvényes,
   - nem járt le (kb. 1 óráig érvényes),
   - az iroda könyvtára állította ki (`MS_TENANT_ID`),
   - ehhez a bővítményhez szól (`MS_CLIENT_ID`),
   - van benne `access_as_user` jogosultság.

   Ha `MS_ALLOWED_DOMAINS` be van állítva, a domainnek is egyeznie kell.

A szervernek el kell érnie a `login.microsoftonline.com` címet, mert innen tölti le a kulcsokat. A letöltött kulcsokat
gyorsítótárban tartja.

## Üzemmódok (`AUTH_MODE`)

| Érték | Mit fogad el a szerver | Mikor |
|---|---|---|
| `key` (alapértelmezett) | csak hozzáférési kulcsot, mint eddig | amíg nincs Azure-regisztráció |
| `both` | Microsoft-belépést, és ha az nem megy, a kulcsot | átállás közben |
| `microsoft` | csak Microsoft-belépést, kulcsot nem | ha már mindenkinél működik |

`both` módban a munkaablak először a Microsoft-belépést próbálja. Ha az nem sikerül, a beállított kulccsal dolgozik
tovább, és nem kérdez újra minden kérésnél. Újra a Beállítások → „Bejelentkezés” gombbal lehet próbálkozni.

## Beállítás az Azure-ban (Microsoft Entra ID) – egyszer, rendszergazda végzi

1. **Alkalmazás regisztrálása.** Nyisd meg az entra.microsoft.com oldalt, majd: Applications → App registrations →
   New registration.
   - Name: `Word Writer`
   - Supported account types: *Accounts in this organizational directory only (Single tenant)*
   - Redirect URI: üresen hagyható.
   - Register után jegyezd fel az **Application (client) ID** és a **Directory (tenant) ID** értékét.
2. **Expose an API.**
   - **Application ID URI:** `api://localhost:3444/<client ID>`. Ez a helyi, INDITAS.bat-os futtatás címe. Szerveres
     telepítésnél `api://<a szerver domainje>/<client ID>`. A hostnak pontosan egyeznie kell azzal a címmel, ahonnan a
     Word a bővítményt betölti.
   - **Add a scope:** a neve `access_as_user`. Who can consent: *Admins and users*. A megjelenő szövegek tetszőlegesek,
     például „Word Writer használata”.
   - **Authorized client applications → Add a client application:** `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e` (ez az
     összes Office-alkalmazás közös azonosítója). Pipáld be mellette az `access_as_user` jogosultságot.
3. **Token verzió (ajánlott).** Az alkalmazás Manifest lapján a `requestedAccessTokenVersion` (régi nézetben:
   `accessTokenAcceptedVersion`) értéke legyen `2`. A szerver az 1-es verziót is elfogadja, de a 2-es a javasolt.
4. **API permissions.** A Microsoft Graph alatt legyen meg az `openid` és a `profile` (delegated) jogosultság. Utána
   nyomd meg a **Grant admin consent for …** gombot, így a kollégáknak nem kell egyenként hozzájárulniuk.

Ha a helyi és a szerveres változat is kell: a második címet a Manifest `identifierUris` listájába vedd fel, vagy
készíts két regisztrációt.

## Beállítás a szerveren (.env)

```
AUTH_MODE=both
MS_CLIENT_ID=<Application (client) ID>
MS_TENANT_ID=<Directory (tenant) ID>
# Nem kötelező: csak ezekről a domainekről lehet belépni
# MS_ALLOWED_DOMAINS=ictlegal.eu
```

Ezután indítsd újra az INDITAS.bat-ot. Az újra elkészíti a `manifest.local.xml`-t, ebbe bekerül a `WebApplicationInfo`
rész a client ID-val, és újra telepíti a bővítményt a Wordbe. Szerveres telepítésnél a manifestet a
`generateManifest(<cím>, <client ID>)` függvénnyel kell előállítani (src/manifest.ts).

**Ellenőrzés:** a Wordben nyisd meg a Beállításokat (fogaskerék). A „Bejelentkezés Microsoft-fiókkal” kártyán ennek
kell megjelennie: „✅ Bejelentkezve: Név (email)”. Ha nem jelenik meg, nyomd meg a „Bejelentkezés” gombot.

Ha mindenkinél működik, állítsd át: `AUTH_MODE=microsoft`. Ettől kezdve a szerver nem fogad el kulcsot, az
`APP_ACCESS_KEY` törölhető.

## Záradéktár a SharePointból (nem kötelező)

A Generálás mód záradéktára közvetlenül egy SharePoint-mappából is olvashat. Ilyenkor mindenki a saját jogaival olvas:
csak azt a záradékot látja, amit a SharePointban is megnyithat. Ehhez a fenti regisztrációban még:

1. **Certificates & secrets → New client secret.** Az értékét tedd a szerverre `MS_CLIENT_SECRET` néven (felhőben
   titokként). Lejáratkor újat kell készíteni.
2. **API permissions → Microsoft Graph → Delegated → `Files.Read.All`**, majd újra **Grant admin consent**.
3. `.env`: `CLAUSES_SHAREPOINT_URL` = a mappa címe a böngészőből (pl.
   `https://iroda.sharepoint.com/sites/Jog/Shared Documents/Zaradektar`).

A mappában minden .docx egy záradék: a fájlneve a címe, az almappa a kategóriája. Helyi futtatásnál ennél egyszerűbb a
OneDrive-val szinkronizált mappa (`CLAUSES_DIR`), ehhez nem kell Azure-beállítás.

## Hibakeresés

| Amit a munkaablak ír | Ok | Teendő |
|---|---|---|
| „Nem vagy bejelentkezve a Wordbe…” (13001) | a Word nincs bejelentkezve | Word jobb felső sarka → Bejelentkezés |
| „Ezzel a fióktípussal nem lehet belépni” (13003) | személyes Microsoft-fiók | munkahelyi fiókkal kell belépni |
| „A Word nem kapott belépési tokent…” (13004/13005/13007) | hiányos regisztráció | Application ID URI hostja ≠ a bővítmény címe; nincs felvéve az Office kliens (`ea5a67f6-…`); nincs admin consent |
| „Ez a Word-verzió nem támogatja…” (13000) | régi Office | Microsoft 365 frissítés (IdentityAPI 1.3) |
| „A szerver nem fogadta el a Microsoft-belépést” + `another application` | a `MS_CLIENT_ID` nem a regisztrációé | client ID javítása |
| … + `another directory` | más szervezet fiókja, vagy hibás `MS_TENANT_ID` | tenant ID javítása |
| … + `no access_as_user scope` | más a scope neve | a scope neve pontosan `access_as_user` legyen |
| … + `MS_ALLOWED_DOMAINS` | a fiók domainje nincs a listán | a lista bővítése |
| „hibásan van beállítva a Microsoft-fiókos belépés” | `AUTH_MODE` mellett hiányzik vagy hibás az `MS_CLIENT_ID` vagy az `MS_TENANT_ID` | a szerver naplója pontosan megírja, melyik |

A Beállítások → Hibajelentés tartalmazza, ha a belépés sikertelen volt (hibakóddal, név és token nélkül).

## Amit még nem próbáltunk ki

A teljes folyamatot valódi Azure-regisztrációval és valódi Worddel még nem teszteltük. A szerveroldali ellenőrzés
saját kulccsal aláírt tesztokenekkel van kipróbálva: v1 és v2 token, rossz aláírás, lejárt token, másik alkalmazás,
másik könyvtár, hiányzó jogosultság, nem engedélyezett domain. A munkaablak viselkedése szimulált Worddel van
kipróbálva. Az első éles beállításnál érdemes `AUTH_MODE=both` móddal kezdeni, így a kulcs tartalékként megmarad.
