/**
 * Given names that mark a person's name in a contract ("Kovács János", "Péter Kiss", "Kovács Jánosné"). The most
 * common Hungarian names, then common international ones for English or German contracts. Names that are also
 * ordinary capitalized words (Virág, Hajnal, Remény…) are left out on purpose.
 */
export const GIVEN_NAMES = [
  // Hungarian, male
  'Ádám', 'Ákos', 'Albert', 'Alex', 'Alexander', 'Alfréd', 'András', 'Antal', 'Árpád', 'Áron', 'Attila', 'Balázs', 'Bálint',
  'Barnabás', 'Béla', 'Bence', 'Benedek', 'Benjámin', 'Bertalan', 'Botond', 'Csaba', 'Csongor', 'Dániel', 'Dávid', 'Dénes',
  'Dezső', 'Domonkos', 'Dominik', 'Elemér', 'Endre', 'Erik', 'Ernő', 'Ervin', 'Ferenc', 'Gábor', 'Gellért', 'Gergely', 'Gergő',
  'Géza', 'Győző', 'György', 'Gyula', 'Henrik', 'Hunor', 'Imre', 'István', 'Iván', 'Jakab', 'Jenő', 'József', 'János',
  'Kálmán', 'Károly', 'Kristóf', 'Krisztián', 'Kornél', 'Lajos', 'László', 'Levente', 'Lóránt', 'Loránd', 'Lőrinc', 'Marcell',
  'Márk', 'Márton', 'Máté', 'Mátyás', 'Miklós', 'Mihály', 'Milán', 'Nándor', 'Norbert', 'Olivér', 'Oszkár', 'Ottó', 'Pál',
  'Patrik', 'Péter', 'Rezső', 'Richárd', 'Róbert', 'Roland', 'Rudolf', 'Sándor', 'Sebestyén', 'Szabolcs', 'Szilárd', 'Tamás',
  'Tibor', 'Tivadar', 'Tódor', 'Vilmos', 'Viktor', 'Vince', 'Zalán', 'Zoltán', 'Zsigmond', 'Zsolt', 'Zsombor',
  // Hungarian, female
  'Adrienn', 'Ágnes', 'Ágota', 'Alexandra', 'Alíz', 'Andrea', 'Anett', 'Anikó', 'Anita', 'Anna', 'Annamária', 'Bea', 'Beáta',
  'Bernadett', 'Bianka', 'Boglárka', 'Borbála', 'Brigitta', 'Csilla', 'Diána', 'Dóra', 'Dorina', 'Dorottya', 'Edit',
  'Emese', 'Emma', 'Enikő', 'Erika', 'Erzsébet', 'Eszter', 'Etelka', 'Éva', 'Fanni', 'Flóra', 'Gabriella', 'Gizella',
  'Gréta', 'Hajnalka', 'Hanna', 'Henrietta', 'Ibolya', 'Ildikó', 'Ilona', 'Irén', 'Írisz', 'Ivett', 'Jázmin', 'Judit',
  'Julianna', 'Júlia', 'Katalin', 'Kinga', 'Kitti', 'Klára', 'Krisztina', 'Laura', 'Lili', 'Lilla', 'Linda', 'Luca',
  'Magdolna', 'Margit', 'Mária', 'Marianna', 'Marietta', 'Márta', 'Melinda', 'Mónika', 'Nikolett', 'Nikoletta', 'Noémi',
  'Nóra', 'Orsolya', 'Petra', 'Piroska', 'Rebeka', 'Réka', 'Renáta', 'Rita', 'Rozália', 'Sára', 'Szabina', 'Szilvia',
  'Teréz', 'Tímea', 'Tünde', 'Valéria', 'Vanda', 'Veronika', 'Viktória', 'Vivien', 'Zita', 'Zsanett', 'Zsófia', 'Zsuzsa',
  'Zsuzsanna',
  // International
  'Andreas', 'Anne', 'Christian', 'Christine', 'Daniel', 'David', 'Elizabeth', 'Emily', 'Frank', 'George', 'Hans', 'Helen',
  'James', 'Jane', 'Jennifer', 'John', 'Jonathan', 'Joseph', 'Klaus', 'Laura', 'Mark', 'Martin', 'Mary', 'Matthew',
  'Michael', 'Monika', 'Paul', 'Peter', 'Richard', 'Robert', 'Sarah', 'Stefan', 'Stephen', 'Susan', 'Thomas', 'William',
  'Wolfgang',
] as const;
