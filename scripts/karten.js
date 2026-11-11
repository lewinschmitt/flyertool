// Lädt die Detailpläne der Gebiete von der alten Seite nach public/karten/.
// Vorhandene Dateien werden übersprungen; Fehler brechen den Build nicht ab.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { KARTEN, KARTEN_QUELLE } from '../lib/seed.js';

const DIR = new URL('../public/karten/', import.meta.url);
await mkdir(DIR, { recursive: true });

let neu = 0, da = 0, fehler = 0;
for (const file of KARTEN) {
  const target = new URL(file, DIR);
  try { await access(target); da += 1; continue; } catch { /* fehlt noch */ }
  try {
    const res = await fetch(KARTEN_QUELLE + file, { signal: AbortSignal.timeout(20000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    neu += 1;
  } catch (e) {
    fehler += 1;
    console.warn(`Detailplan ${file} nicht geladen: ${e.message}`);
  }
}
console.log(`Detailpläne: ${neu} neu geladen, ${da} bereits vorhanden, ${fehler} fehlgeschlagen.`);
