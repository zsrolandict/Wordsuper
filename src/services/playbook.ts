import type { ReviewFinding, Severity } from '../shared/aiConfig';
import { PLAYBOOK_POSITIONS, POSITION_LABELS, sanitizePlaybook, type Playbook, type PlaybookPosition, type PlaybookRule } from '../shared/playbook';

/**
 * The playbook check in the task pane: the own playbooks kept on this machine, the answer read back as one check per
 * rule, and the checks that need action turned into review findings, so they go through the same one-by-one
 * decision (Mutasd / Elfogadom / Elvetem) and tracked changes as any review.
 */

const STORAGE_KEY = 'word-writer-playbooks-v1';

export function loadOwnPlaybooks(): Playbook[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.flatMap((item, i) => {
      const playbook = sanitizePlaybook(item, `own-${i}`);
      return playbook ? [playbook] : [];
    }) : [];
  } catch {
    return [];
  }
}

export function saveOwnPlaybooks(playbooks: Playbook[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playbooks));
  } catch {
    // Private mode or full storage: kept for this session only
  }
}

export const newPlaybookId = () => `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const emptyRule = (rules: PlaybookRule[]): PlaybookRule => {
  let n = rules.length + 1;
  while (rules.some(r => r.id === `r${n}`)) n++;
  return { id: `r${n}`, topic: '', standard: '', fallback1: '', fallback2: '', walkAway: '', clause: '' };
};

/** What the check found for one rule; "unchecked": the answer left the rule out */
export interface PlaybookCheck {
  rule: string;
  topic: string;
  position: PlaybookPosition | 'unchecked';
  quote: string;
  comment: string;
  suggestion: string;
}

export const CHECK_LABELS: Record<PlaybookCheck['position'], string> = { ...POSITION_LABELS, unchecked: 'Nem vizsgálta' };

/** How serious a level is: the further from the standard, the higher */
export const POSITION_SEVERITY: Record<Exclude<PlaybookPosition, 'standard'>, Severity> = {
  fallback1: 'low',
  fallback2: 'medium',
  walkaway: 'high',
  missing: 'high',
};

/** One check per rule of the playbook, in its order; null when the answer is not the expected JSON */
export function parsePlaybookChecks(text: string, playbook: Playbook): PlaybookCheck[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : (data as { checks?: unknown })?.checks;
  if (!Array.isArray(list)) return null;
  const byRule = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rule = String((item as Record<string, unknown>).rule ?? '').replace(/[[\]\s]/g, '');
    if (rule && !byRule.has(rule)) byRule.set(rule, item as Record<string, unknown>);
  }
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return playbook.rules.map(rule => {
    const found = byRule.get(rule.id);
    if (!found) return { rule: rule.id, topic: rule.topic, position: 'unchecked', quote: '', comment: '', suggestion: '' };
    const position = (PLAYBOOK_POSITIONS as readonly unknown[]).includes(found.position) ? found.position as PlaybookPosition : 'unchecked';
    return { rule: rule.id, topic: rule.topic, position, quote: str(found.quote), comment: str(found.comment), suggestion: str(found.suggestion) };
  });
}

/** A finding the pane can decide on, with the rule it came from */
export type PlaybookFinding = ReviewFinding & { topic: string; position: PlaybookPosition };

/** The checks that need action, worst first; a standard clause or an unchecked rule makes no finding */
export function playbookFindings(checks: PlaybookCheck[]): PlaybookFinding[] {
  const order: Record<PlaybookPosition, number> = { walkaway: 0, missing: 1, fallback2: 2, fallback1: 3, standard: 4 };
  return checks
    .filter((c): c is PlaybookCheck & { position: Exclude<PlaybookPosition, 'standard'> } => c.position !== 'standard' && c.position !== 'unchecked' && !!c.quote && !!c.comment)
    .sort((a, b) => order[a.position] - order[b.position])
    .map(c => ({
      quote: c.quote,
      comment: `${c.topic} (${POSITION_LABELS[c.position]}): ${c.comment}`,
      severity: POSITION_SEVERITY[c.position],
      suggestion: c.suggestion,
      topic: c.topic,
      position: c.position,
    }));
}

/** The changes written into the contract, for the cover letter: one line each, with its topic and reason */
export function coverLetterChanges(findings: { comment: string; suggestion: string; topic?: string; fixApplied: boolean }[]): string {
  return findings
    .map((f, i) => `${i + 1}. ${f.topic ? `${f.topic}: ` : ''}${f.comment.replace(/^[^:]*\([^)]*\):\s*/, '')}${f.fixApplied && f.suggestion ? `\n   Új szöveg: „${f.suggestion}”` : ''}`)
    .join('\n');
}

/**
 * A starting point, to be rewritten by the firm's lawyers: the format and the level of detail, not legal advice.
 * Offered once with "Minta betöltése" in the playbook editor.
 */
export const SAMPLE_PLAYBOOK: Playbook = {
  id: 'sample',
  name: 'MINTA – Ingatlan-adásvétel, vevői oldal',
  contractType: 'Ingatlan-adásvételi szerződés',
  side: 'Vevő',
  rules: [
    {
      id: 'r1', topic: 'Vételár megfizetése',
      standard: 'A vételár ügyvédi letétbe kerül, és csak a tulajdonjog bejegyzésére alkalmas okiratok átadása után fizethető ki az Eladónak.',
      fallback1: 'Részletfizetés, de az utolsó részlet (legalább 30%) csak a birtokbaadás után.',
      fallback2: 'Közvetlen fizetés az Eladónak, ha a tulajdonjog-fenntartás és a bejegyzési engedély letétbe kerül.',
      walkAway: 'A teljes vételár megfizetése a tulajdonjog bejegyzéséhez szükséges okiratok átadása előtt, biztosíték nélkül.',
      clause: 'A Vevő a vételárat a szerződés aláírásától számított 8 napon belül az ügyvédi letéti számlára fizeti meg. A letétkezelő a vételárat a tulajdonjog bejegyzésére alkalmas okiratok átadását követően utalja át az Eladónak.',
    },
    {
      id: 'r2', topic: 'Szavatosság, tehermentesség',
      standard: 'Az Eladó szavatol azért, hogy az Ingatlan per-, teher- és igénymentes, és ezt a tulajdoni lap az aláírás napján igazolja.',
      fallback1: 'A meglévő jelzálogjog a vételárból kerül kiváltásra, a bank törlési nyilatkozatával.',
      fallback2: '',
      walkAway: 'A Vevő tehermentesség nélkül, a terhek átvállalásával szerez tulajdont.',
      clause: 'Az Eladó szavatol azért, hogy az Ingatlan per-, teher- és igénymentes, és harmadik személynek nincs rajta olyan joga, amely a Vevő tulajdonszerzését vagy birtoklását akadályozza.',
    },
    {
      id: 'r3', topic: 'Foglaló',
      standard: 'Foglaló legfeljebb a vételár 10%-a, és az Eladónak felróható meghiúsulásnál kétszeresen jár vissza.',
      fallback1: 'Foglaló legfeljebb a vételár 20%-a.',
      fallback2: '',
      walkAway: 'A foglaló a vételár 20%-ánál több, vagy bármely meghiúsulás esetén elvész.',
      clause: '',
    },
    {
      id: 'r4', topic: 'Birtokbaadás',
      standard: 'Birtokbaadás a vételár teljes megfizetésekor, jegyzőkönyvvel, a közüzemi mérőállások rögzítésével.',
      fallback1: 'Birtokbaadás legfeljebb 30 nappal a teljes vételár megfizetése után.',
      fallback2: '',
      walkAway: 'A birtokbaadás időpontja nincs meghatározva.',
      clause: 'Az Eladó az Ingatlant a vételár teljes megfizetésének napján adja a Vevő birtokába. A birtokbaadásról a felek jegyzőkönyvet vesznek fel, amelyben rögzítik a közüzemi mérőórák állását.',
    },
    {
      id: 'r5', topic: 'Elállás, késedelem',
      standard: 'Az Eladó késedelme esetén a Vevő 15 napos póthatáridő után elállhat, és a megfizetett összeg 8 napon belül visszajár.',
      fallback1: '30 napos póthatáridő.',
      fallback2: '',
      walkAway: 'A Vevőnek nincs elállási joga az Eladó késedelme esetén.',
      clause: '',
    },
  ],
};

/**
 * Three fuller samples for everyday contracts, from the side a firm usually acts for. The positions are a starting
 * point a lawyer reviews; only Ptk. sections that are sure are cited (6:152 limits of exclusion, 6:186 kötbér).
 */
export const NDA_PLAYBOOK: Playbook = {
  id: 'sample-nda',
  name: 'MINTA – Titoktartási megállapodás (NDA), átadó fél',
  contractType: 'Titoktartási megállapodás',
  side: 'Átadó fél (aki a bizalmas információt átadja)',
  rules: [
    {
      id: 'r1', topic: 'A bizalmas információ fogalma',
      standard: 'Bizalmas minden információ, amelyet az Átadó a megállapodással összefüggésben bármilyen formában (írásban, szóban, elektronikusan, bemutatással) közöl, jelöléstől függetlenül.',
      fallback1: 'Bizalmas az írásban „bizalmas” jelöléssel átadott információ, továbbá a szóban közölt információ, ha az Átadó 10 napon belül írásban megerősíti.',
      fallback2: 'Bizalmas a megjelölt információ, és az is, amelyről a körülmények alapján a Fogadó félnek tudnia kellett, hogy bizalmas.',
      walkAway: 'Csak az írásban és kifejezetten „bizalmas” jelöléssel átadott információ bizalmas; a szóbeli közlés semmilyen esetben sem.',
      clause: 'Bizalmas információ minden olyan üzleti, műszaki, pénzügyi, jogi vagy egyéb adat, tény és ismeret, amelyet az Átadó fél a jelen megállapodással összefüggésben bármilyen formában a Fogadó fél tudomására hoz, függetlenül attól, hogy azt bizalmasként megjelölte-e.',
    },
    {
      id: 'r2', topic: 'A titoktartás időtartama',
      standard: 'A titoktartási kötelezettség a megállapodás megszűnése után 5 évig fennáll; az üzleti titoknak minősülő információra határozatlan ideig, amíg az üzleti titok.',
      fallback1: 'A megszűnés után 3 évig, az üzleti titokra határozatlan ideig.',
      fallback2: 'A megszűnés után 2 évig, az üzleti titokra határozatlan ideig.',
      walkAway: 'A kötelezettség csak a megállapodás hatálya alatt áll fenn, vagy a megszűnés után 1 évnél rövidebb ideig.',
      clause: 'A Fogadó fél titoktartási kötelezettsége a jelen megállapodás bármely okból történő megszűnését követő 5 (öt) évig fennmarad. Az üzleti titoknak minősülő Bizalmas információ tekintetében a kötelezettség mindaddig fennáll, amíg az információ üzleti titoknak minősül.',
    },
    {
      id: 'r3', topic: 'Kivételek a titoktartás alól',
      standard: 'Zárt lista: köztudomású (nem a Fogadó fél jogsértése folytán); igazoltan korábban jogszerűen ismert; a Fogadó fél önállóan, írásban igazolhatóan fejlesztette ki; jogszabály vagy hatóság kötelezővé teszi. A kivételre hivatkozó felet terheli a bizonyítás.',
      fallback1: 'Hatósági megkeresésnél előzetes értesítés csak akkor, ha jogszabály nem tiltja.',
      fallback2: '',
      walkAway: 'Nyitott vagy általános kivétel („egyéb indokolt esetben”), vagy a bizonyítási teher az Átadóra kerül.',
      clause: 'Nem sérti a titoktartási kötelezettséget az információ közlése, ha azt jogszabály vagy hatósági határozat kötelezővé teszi; ilyenkor a Fogadó fél – ha jogszabály nem tiltja – haladéktalanul, a közlés előtt értesíti az Átadó felet, és csak a feltétlenül szükséges mértékben közli az információt.',
    },
    {
      id: 'r4', topic: 'Felhasználási cél, továbbadás',
      standard: 'Az információ kizárólag a megállapodásban meghatározott célra használható. Továbbadás csak azoknak a munkavállalóknak és kötelező titoktartás alatt álló tanácsadóknak, akiknek a célhoz szükséges; értük a Fogadó fél úgy felel, mintha maga járt volna el.',
      fallback1: 'A Fogadó fél kapcsolt vállalkozásai is megkaphatják, azonos feltételekkel és a Fogadó fél felelőssége mellett.',
      fallback2: '',
      walkAway: 'Harmadik személynek előzetes írásbeli hozzájárulás nélkül is továbbadható, vagy a Fogadó fél nem felel a címzettek magatartásáért; visszafejtés (reverse engineering) megengedett.',
      clause: 'A Fogadó fél a Bizalmas információt kizárólag a [cél] érdekében használhatja fel. Azt csak azon munkavállalóival és jogszabály alapján titoktartásra kötelezett tanácsadóival közölheti, akiknek erre e cél érdekében szükségük van; ezen személyek magatartásáért a Fogadó fél úgy felel, mintha maga járt volna el.',
    },
    {
      id: 'r5', topic: 'Kötbér és kártérítés',
      standard: 'Jogsértésenként fix összegű kötbér (Ptk. 6:186. §); a kötbért meghaladó kár is érvényesíthető. A Fogadó fél felelőssége nem korlátozott.',
      fallback1: 'Alacsonyabb kötbér, de a kötbért meghaladó kár érvényesíthető marad.',
      fallback2: 'Kötbér nincs, de a teljes kár megtérítése korlátozás nélkül.',
      walkAway: 'A Fogadó fél felelősségének összegszerű korlátozása vagy kizárása, vagy olyan kötbér, amely kizárja a további kártérítést.',
      clause: 'A Fogadó fél a titoktartási kötelezettség minden egyes megszegése esetén [összeg] Ft kötbért fizet az Átadó félnek. A kötbér megfizetése nem érinti az Átadó fél jogát a kötbért meghaladó kárának érvényesítésére.',
    },
    {
      id: 'r6', topic: 'Visszaadás, megsemmisítés',
      standard: 'Az Átadó felhívására vagy a megszűnéskor a Fogadó fél 10 napon belül visszaadja vagy megsemmisíti az információt és minden másolatát, és ezt írásban igazolja.',
      fallback1: 'A jogszabály alapján kötelezően megőrzendő és a biztonsági mentésben automatikusan tárolt másolat megtartható, de arra a titoktartás továbbra is kiterjed.',
      fallback2: '',
      walkAway: 'Nincs visszaadási vagy megsemmisítési kötelezettség.',
      clause: 'A Fogadó fél az Átadó fél írásbeli felhívására, illetve a megállapodás megszűnésekor 10 (tíz) napon belül a Bizalmas információt és annak minden másolatát visszaadja vagy megsemmisíti, és ezt írásban igazolja.',
    },
    {
      id: 'r7', topic: 'Irányadó jog, jogvita',
      standard: 'Magyar jog, és az Átadó fél székhelye szerint illetékes magyar bíróság.',
      fallback1: 'Választottbíróság Magyarországon (Kereskedelmi Választottbíróság, Budapest), magyar nyelven.',
      fallback2: '',
      walkAway: 'Külföldi jog vagy külföldi fórum kikötése.',
      clause: '',
    },
  ],
};

export const SERVICE_PLAYBOOK: Playbook = {
  id: 'sample-service',
  name: 'MINTA – Vállalkozási szerződés, megrendelői oldal',
  contractType: 'Vállalkozási szerződés',
  side: 'Megrendelő',
  rules: [
    {
      id: 'r1', topic: 'Határidő, késedelmi kötbér',
      standard: 'Késedelem esetén a késedelem minden napjára a nettó vállalkozói díj 0,5%-a kötbér (Ptk. 6:186. §), legfeljebb a díj 20%-a; a felső határ elérése után a Megrendelő elállhat vagy felmondhat. A kötbért meghaladó kár is érvényesíthető.',
      fallback1: 'Napi 0,3%, legfeljebb 15%.',
      fallback2: 'Napi 0,2%, legfeljebb 10%.',
      walkAway: 'Nincs kötbér, és a késedelemnek nincs jogkövetkezménye; vagy a kötbér kizárja a további kártérítést.',
      clause: 'Ha a Vállalkozó a teljesítési határidőt neki felróható okból elmulasztja, a késedelem minden naptári napjára a nettó vállalkozói díj 0,5%-ának megfelelő késedelmi kötbért fizet, legfeljebb a nettó vállalkozói díj 20%-áig. A kötbér maximumának elérése esetén a Megrendelő jogosult a szerződéstől elállni, illetve azt azonnali hatállyal felmondani. A kötbér megfizetése nem érinti a Megrendelő jogát a kötbért meghaladó kárának érvényesítésére.',
    },
    {
      id: 'r2', topic: 'Felelősségkorlátozás',
      standard: 'A Vállalkozó felelőssége nem korlátozott.',
      fallback1: 'Korlátozás a nettó vállalkozói díj 200%-áig.',
      fallback2: 'Korlátozás a nettó vállalkozói díj 100%-áig. Ptk. 6:152. §: a szándékosan, súlyosan gondatlanul vagy bűncselekménnyel okozott, valamint az életet, testi épséget, egészséget megkárosító szerződésszegésért való felelősség nem korlátozható; ezt a kivételt a szövegnek tartalmaznia kell.',
      walkAway: 'A felelősség kizárása, vagy a díjnál alacsonyabb felső határ, vagy olyan korlátozás, amely a Ptk. 6:152. § szerinti esetekre is kiterjed.',
      clause: 'A Vállalkozó szerződésszegéssel okozott kárért való felelőssége – a Ptk. 6:152. §-ában meghatározott esetek kivételével – a nettó vállalkozói díj 200%-ában korlátozott.',
    },
    {
      id: 'r3', topic: 'Átadás-átvétel',
      standard: 'A Megrendelő a készre jelentéstől számított 10 munkanapon belül megvizsgálja a munkát; hiba esetén hibalistát ad. Az átvétel csak a Megrendelő által aláírt átadás-átvételi jegyzőkönyvvel történik meg, hallgatólagos átvétel nincs.',
      fallback1: 'Hallgatólagos átvétel, ha a Megrendelő 15 munkanapon belül, a Vállalkozó írásbeli figyelmeztetése után sem nyilatkozik.',
      fallback2: '',
      walkAway: 'A munka a készre jelentéssel vagy a használatba vétellel automatikusan átvettnek minősül.',
      clause: 'A Megrendelő a teljesítést a Vállalkozó írásbeli készre jelentésétől számított 10 (tíz) munkanapon belül megvizsgálja. A teljesítés az átadás-átvételi jegyzőkönyv Megrendelő általi aláírásával minősül elfogadottnak; a jegyzőkönyvben rögzített hibák kijavításáig a Megrendelő a díj [ ]%-át visszatarthatja.',
    },
    {
      id: 'r4', topic: 'Díj, többletmunka, fizetés',
      standard: 'Átalánydíj, amely minden költséget tartalmaz. Többletmunka csak a Megrendelő előzetes írásbeli megrendelése alapján számolható el. Fizetés a teljesítésigazolás után kiállított számla alapján, 30 napon belül.',
      fallback1: 'Legfeljebb 20% előleg, előlegvisszafizetési bankgarancia ellenében.',
      fallback2: 'Részszámlázás mérföldkövekhez kötve, mindegyik teljesítésigazolás után.',
      walkAway: 'A Vállalkozó egyoldalúan emelheti a díjat, vagy a díj jelentős része biztosíték nélkül előre fizetendő.',
      clause: 'A vállalkozói díj átalánydíj, amely a Vállalkozó valamennyi költségét tartalmazza. Pótmunka és többletmunka kizárólag a Megrendelő előzetes, írásbeli megrendelése alapján számolható el.',
    },
    {
      id: 'r5', topic: 'Jótállás, hibás teljesítés',
      standard: '24 hónap jótállás az átvételtől; a Vállalkozó a hibát 15 napon belül saját költségén kijavítja, ennek elmulasztásakor a Megrendelő a Vállalkozó költségére mással is kijavíttathatja.',
      fallback1: '12 hónap jótállás.',
      fallback2: '',
      walkAway: 'A jótállás és a hibás teljesítésért való felelősség kizárása.',
      clause: 'A Vállalkozó az átvételtől számított 24 (huszonnégy) hónapig jótállást vállal. A bejelentett hibát 15 (tizenöt) napon belül saját költségén kijavítja; ha ezt elmulasztja, a Megrendelő a hibát a Vállalkozó költségére mással is kijavíttathatja.',
    },
    {
      id: 'r6', topic: 'Szellemi tulajdon',
      standard: 'A létrejött műre a Megrendelő kizárólagos, területi és időbeli korlátozás nélküli, harmadik személynek átengedhető felhasználási jogot szerez, beleértve az átdolgozás jogát; ennek ellenértékét a vállalkozói díj tartalmazza.',
      fallback1: 'Nem kizárólagos, de korlátlan és átengedhető felhasználási jog.',
      fallback2: '',
      walkAway: 'A Megrendelő nem kap felhasználási jogot, vagy a jogot a Vállalkozó egyoldalúan visszavonhatja, vagy külön díjhoz köti.',
      clause: 'A Megrendelő a szerződés teljesítése során létrejött, szerzői jogi védelem alatt álló alkotásokra kizárólagos, területi és időbeli korlátozás nélküli, harmadik személynek átengedhető felhasználási jogot szerez, amely kiterjed az átdolgozás jogára is. A felhasználási jog ellenértékét a vállalkozói díj tartalmazza.',
    },
    {
      id: 'r7', topic: 'Alvállalkozó',
      standard: 'Alvállalkozó csak a Megrendelő előzetes írásbeli hozzájárulásával vehető igénybe; az alvállalkozóért a Vállalkozó úgy felel, mintha maga járt volna el.',
      fallback1: 'Előzetes írásbeli bejelentés elég, ha a Megrendelő 5 munkanapon belül nem tiltakozik.',
      fallback2: '',
      walkAway: 'Korlátlan alvállalkozói bevonás, a Vállalkozó felelőssége nélkül.',
      clause: '',
    },
    {
      id: 'r8', topic: 'Megszüntetés',
      standard: 'A Megrendelő súlyos szerződésszegés esetén azonnali hatállyal felmondhat; egyébként 30 napos határidővel indokolás nélkül is, ilyenkor csak a már elvégzett munka díja jár.',
      fallback1: '60 napos rendes felmondási idő.',
      fallback2: '',
      walkAway: 'A Megrendelő nem szüntetheti meg a szerződést, vagy a megszüntetés a teljes díj megfizetésével jár.',
      clause: '',
    },
  ],
};

export const LEASE_PLAYBOOK: Playbook = {
  id: 'sample-lease',
  name: 'MINTA – Üzlethelyiség-bérlet, bérlői oldal',
  contractType: 'Bérleti szerződés (nem lakás céljára szolgáló helyiség)',
  side: 'Bérlő',
  rules: [
    {
      id: 'r1', topic: 'Bérleti díj, értékkövetés',
      standard: 'Fix bérleti díj; évente egyszer, a KSH által közzétett éves fogyasztói árindex mértékével emelhető, legfeljebb évi 3%-kal.',
      fallback1: 'Éves emelés a fogyasztói árindex szerint, felső határ nélkül.',
      fallback2: 'Fogyasztói árindex + legfeljebb 1 százalékpont.',
      walkAway: 'A Bérbeadó egyoldalúan, mérték vagy képlet nélkül emelheti a díjat.',
      clause: 'A bérleti díj minden év január 1-jétől a KSH által az előző évre közzétett éves fogyasztói árindex mértékével, de legfeljebb 3%-kal emelkedik.',
    },
    {
      id: 'r2', topic: 'Óvadék',
      standard: 'Legfeljebb 2 havi bruttó bérleti díj és üzemeltetési díj; bankgaranciával is teljesíthető; a kiürítés és birtokba adás után 30 napon belül visszajár, a Bérbeadó csak lejárt, igazolt követelésre használhatja.',
      fallback1: 'Legfeljebb 3 havi összeg.',
      fallback2: '',
      walkAway: '6 havinál nagyobb óvadék, vagy a visszafizetés feltételei és határideje nincsenek meghatározva.',
      clause: 'A Bérlő óvadékként 2 (két) havi bruttó bérleti és üzemeltetési díjnak megfelelő összeget fizet, vagy azonos összegű bankgaranciát ad. A Bérbeadó az óvadékból csak a Bérlő lejárt és igazolt tartozását egyenlítheti ki; a fennmaradó összeget a helyiség visszaadását követő 30 (harminc) napon belül visszafizeti.',
    },
    {
      id: 'r3', topic: 'Üzemeltetési díj, mellékköltségek',
      standard: 'Tételesen meghatározott költségek, évente egyszer tételes elszámolás; a Bérlő betekinthet a számlákba. A Bérbeadó felújítási, beruházási és saját működési költségei nem háríthatók át.',
      fallback1: 'Átalány üzemeltetési díj, évi legfeljebb az árindex mértékével emelve.',
      fallback2: '',
      walkAway: 'Korlátlan, elszámolás nélküli költségáthárítás, ideértve a felújítást és a beruházást.',
      clause: '',
    },
    {
      id: 'r4', topic: 'Karbantartás, javítás',
      standard: 'A Bérbeadó felel az épület szerkezeti elemeiért, a tetőért, a homlokzatért és a központi gépészetért; a Bérlő csak a helyiségen belüli kisjavításokért.',
      fallback1: 'A Bérlő végzi a helyiség gépészetének rendszeres karbantartását, de a cserét és a nagyjavítást a Bérbeadó viseli.',
      fallback2: '',
      walkAway: 'A szerkezeti elemek, a tető vagy a központi gépészet javítása a Bérlőre hárul.',
      clause: '',
    },
    {
      id: 'r5', topic: 'Bérleti idő, hosszabbítás, felmondás',
      standard: 'Határozott idő (pl. 5 év), a Bérlőnek egyoldalú hosszabbítási joga van azonos feltételekkel; a Bérbeadó határozott időre nem mondhat fel rendes felmondással. A Bérlő súlyos szerződésszegés esetén azonnali hatállyal felmondhat.',
      fallback1: 'Hosszabbítási jog piaci díjon, a díjról szóló vita esetére független szakértő döntésével.',
      fallback2: 'Hosszabbítási jog nélkül, de legalább 6 hónappal a lejárat előtti tárgyalási kötelezettséggel.',
      walkAway: 'A Bérbeadó határozott idő alatt is indokolás nélkül felmondhat.',
      clause: '',
    },
    {
      id: 'r6', topic: 'Átalakítás, beruházás megtérítése',
      standard: 'A Bérlő a Bérbeadó hozzájárulásával alakíthat át (a hozzájárulás indokolatlanul nem tagadható meg); a hozzájárulással végzett átalakításnál megszűnéskor nem kell visszaállítani az eredeti állapotot, és a meg nem térült értéknövekedést a Bérbeadó megtéríti.',
      fallback1: 'Nincs megtérítés, de az eredeti állapot visszaállítása sem kötelező.',
      fallback2: '',
      walkAway: 'Minden beruházás ellenérték nélkül a Bérbeadóé, és a Bérlőnek ezen felül az eredeti állapotot is vissza kell állítania.',
      clause: '',
    },
    {
      id: 'r7', topic: 'Albérlet, a szerződés átruházása',
      standard: 'A Bérlő kapcsolt vállalkozásának hozzájárulás nélkül, másnak a Bérbeadó hozzájárulásával adhatja albérletbe a helyiséget, illetve ruházhatja át a szerződést; a hozzájárulás indokolatlanul nem tagadható meg.',
      fallback1: 'Minden esetben hozzájárulás kell, de az indokolatlanul nem tagadható meg.',
      fallback2: '',
      walkAway: 'Az albérlet és az átruházás teljes tilalma.',
      clause: '',
    },
    {
      id: 'r8', topic: 'Biztosítás',
      standard: 'Az épületre a Bérbeadó köt vagyonbiztosítást; a Bérlő a saját vagyontárgyaira és felelősségbiztosításra köt biztosítást; a felek a biztosítás által fedezett károkra kölcsönösen lemondanak a megtérítési igényről.',
      fallback1: 'Kölcsönös lemondás nélkül, de a Bérlőnek nem kell az épületet biztosítania.',
      fallback2: '',
      walkAway: 'Az épület biztosítása a Bérlőt terheli, vagy a Bérlő felel minden, az épületben keletkezett kárért.',
      clause: '',
    },
  ],
};

/** What „Minta betöltése” offers */
export const SAMPLE_PLAYBOOKS: Playbook[] = [NDA_PLAYBOOK, SERVICE_PLAYBOOK, LEASE_PLAYBOOK, SAMPLE_PLAYBOOK];
