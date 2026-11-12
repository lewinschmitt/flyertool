// Einheitliche Schreibweise von Namen: Vorname und erster Buchstabe des Nachnamens («Anna Muster» → «Anna M.»).
// Ein einzelner Name bleibt, wie er ist; ebenso Einträge für mehrere Personen («Kathy und Jüx»).
// Dieselbe Funktion steht in public/app.js (die Oberfläche hat keinen Build-Schritt).
export function shortName(value) {
  const t = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (/[,&+/]| und /i.test(t)) return t;
  const parts = t.split(' ');
  const initial = parts.length > 1 ? [...parts.at(-1)][0] : '';
  return /\p{L}/u.test(initial) ? `${parts[0]} ${initial.toUpperCase()}.` : t;
}
