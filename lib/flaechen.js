// Regel beim Bearbeiten: Gebiete überlappen sich nicht. Eine neu gezeichnete Fläche wird an den
// bestehenden Gebieten abgeschnitten – man darf also grosszügig über die Nachbarn hinaus zeichnen,
// die gemeinsame Grenze stimmt danach genau.
import { difference, union } from 'polyclip-ts';

const multi = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
// Fläche eines Rings in m² (für Zürich genau genug: Längengrade mit cos der Breite gestaucht).
function ringArea(ring) {
  const k = 111320 * 111320 * Math.cos((ring[0][1] * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(sum / 2) * k;
}
const polyArea = (poly) => poly.slice(1).reduce((a, hole) => a - ringArea(hole), ringArea(poly[0]));
const areaOf = (polys) => polys.reduce((a, p) => a + polyArea(p), 0);
function bbox(polys) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}
const apart = (a, b) => a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1];
const round = (polys) => polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [+x.toFixed(7), +y.toFixed(7)])));

/**
 * Schneidet `geometry` an den Flächen in `others` ab.
 * Ergebnis: { geometry, trimmed } – oder null, wenn nichts Brauchbares übrig bleibt.
 * Punkte bleiben unverändert. Wirft bei ungültigen Flächen.
 */
export function withoutOverlap(geometry, others) {
  if (geometry.type === 'Point') return { geometry, trimmed: false };
  // union() bereinigt auch Flächen, deren Rand sich selbst kreuzt.
  const subject = union(multi(geometry));
  if (!subject.length) return null;
  const before = areaOf(subject);
  const box = bbox(subject);
  const clips = others.filter((o) => o.type !== 'Point').map(multi).filter((o) => !apart(box, bbox(o)));
  let rest = clips.length ? difference(subject, ...clips) : subject;
  // Splitter jenseits eines Nachbarn fallen weg.
  const largest = Math.max(0, ...rest.map(polyArea));
  rest = rest.filter((p) => polyArea(p) >= Math.max(200, largest * 0.05));
  if (!rest.length) return null;
  rest = round(rest);
  return {
    geometry: rest.length === 1 ? { type: 'Polygon', coordinates: rest[0] } : { type: 'MultiPolygon', coordinates: rest },
    trimmed: before - areaOf(rest) > 20,
  };
}
