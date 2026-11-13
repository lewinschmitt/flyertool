import { timingSafeEqual, createHash } from 'node:crypto';
import { q, query, INSERT_AREAS } from '../lib/db.js';
import { shortName } from '../lib/name.js';
import { withoutOverlap } from '../lib/flaechen.js';

const local = !process.env.VERCEL;
const TEAM_PW = process.env.TEAM_PASSWORD || (local ? 'gruen' : '');
const ADMIN_PW = process.env.ADMIN_PASSWORD || (local ? 'admin' : '');

const same = (a, b) => {
  if (!a || !b) return false;
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
};
function roleOf(req) {
  let pw = req.headers['x-password'] || '';
  try { pw = decodeURIComponent(pw); } catch { /* unverändert verwenden */ }
  if (same(pw, ADMIN_PW)) return 'admin';
  if (same(pw, TEAM_PW)) return 'team';
  return null;
}

// So steht es beim Gebiet, wenn jemand die Flyer schon hat.
const HAVE = 'bereits abgeholt';

class Fail extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- Schutz vor Passwort-Raten ---------------------------------------------
// Nach MAX_FAILURES falschen Passwörtern innert WINDOW_MIN Minuten wird der Absender gesperrt,
// bis die ältesten Fehlversuche aus dem Zeitfenster gefallen sind. Die Sperre gilt auch für das
// richtige Passwort – sonst liesse sich trotz Sperre weiterraten. Erfolgreiche Anmeldungen setzen
// den Zähler nicht zurück, damit niemand mit dem Team-Passwort das Admin-Passwort durchprobieren kann.
const MAX_FAILURES = 10;
const WINDOW_MIN = 15;
// Vercel setzt diese Kopfzeilen selbst; von aussen lassen sie sich dort nicht fälschen.
const clientIp = (req) => String(
  req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || req.socket?.remoteAddress || 'unbekannt',
).slice(0, 64);
async function checkLimit(ip, res) {
  const [row] = await q`
    SELECT count(*)::int AS n,
           CEIL(EXTRACT(EPOCH FROM (min(at) + make_interval(mins => ${WINDOW_MIN}) - now())))::int AS wait
    FROM login_failures WHERE ip = ${ip} AND at > now() - make_interval(mins => ${WINDOW_MIN})`;
  if (row.n < MAX_FAILURES) return;
  const minutes = Math.max(1, Math.ceil(row.wait / 60));
  res.setHeader('Retry-After', String(Math.max(1, row.wait)));
  throw new Fail(429, `Zu viele falsche Passwörter. Bitte in ${minutes === 1 ? 'einer Minute' : `${minutes} Minuten`} nochmals versuchen.`);
}
async function noteFailure(ip) {
  await q`INSERT INTO login_failures (ip) VALUES (${ip})`;
  await q`DELETE FROM login_failures WHERE at < now() - interval '1 day'`;
}

// ---- Eingaben prüfen ------------------------------------------------------
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const id = (v, what = 'Gebiet') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Fail(400, `${what} fehlt oder ist ungültig.`);
  return n;
};
const required = (v, max, message) => {
  const t = text(v, max);
  if (!t) throw new Fail(400, message);
  return t;
};
// Namen werden immer als «Vorname N.» gespeichert, egal was die Oberfläche schickt.
const person = (v) => required(shortName(text(v, 80)), 40, 'Bitte gib deinen Namen an.');
const count = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 1000000 ? n : null;
};
const mapUrl = (v) => {
  const t = text(v, 500);
  return /^(https:\/\/|\/)/.test(t) ? t : '';
};
// Koordinaten müssen echte Längen-/Breitengrade sein – sonst bleibt die Karte bei allen leer.
const position = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const polygon = (rings) => Array.isArray(rings) && rings.length > 0
  && rings.every((r) => Array.isArray(r) && r.length >= 4 && r.every(position));
function geometry(g) {
  const ok = g && (
    (g.type === 'Point' && position(g.coordinates))
    || (g.type === 'Polygon' && polygon(g.coordinates))
    || (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length > 0 && g.coordinates.every(polygon)));
  if (!ok) throw new Fail(400, 'Das Gebiet braucht eine Position oder Fläche.');
  const clean = { type: g.type, coordinates: g.coordinates };
  if (JSON.stringify(clean).length > 200000) throw new Fail(400, 'Die Fläche ist zu detailliert.');
  return clean;
}
// Gebiete dürfen sich nicht überlappen: die neue Fläche wird an allen anderen abgeschnitten.
const TRIMMED = 'Die Fläche wurde an den Nachbargebieten abgeschnitten – Gebiete überlappen sich nicht.';
function fitted(g, others) {
  let fit;
  try { fit = withoutOverlap(g, others); } catch { throw new Fail(400, 'Die Fläche ist ungültig – bitte neu zeichnen.'); }
  if (!fit) throw new Fail(400, 'Die Fläche liegt ganz in bestehenden Gebieten. Gebiete dürfen sich nicht überlappen.');
  return fit;
}
const otherShapes = async (exceptId = 0) => (await q`SELECT geometry FROM areas WHERE id <> ${exceptId}`).map((r) => r.geometry);

const areaFields = (b) => ({
  code: text(b.code, 12),
  name: required(b.name, 60, 'Bitte gib dem Gebiet einen Namen.'),
  flyers: text(b.flyers, 40),
  description: text(b.description, 1500),
  map_url: mapUrl(b.map_url),
});

async function openCampaign(v) {
  const cid = id(v, 'Kampagne');
  const rows = await q`SELECT archived FROM campaigns WHERE id = ${cid}`;
  if (!rows.length) throw new Fail(409, 'Diese Kampagne gibt es nicht mehr.');
  if (rows[0].archived) throw new Fail(409, 'Diese Kampagne ist abgeschlossen.');
  return cid;
}

// ---- Aktionen ---------------------------------------------------------------
const actions = {
  async claim(b) {
    const cid = await openCampaign(b.campaign);
    // Abholort als Text festhalten: er bleibt lesbar, auch wenn der Ort später geändert oder gelöscht wird.
    let pickup = null;
    if (b.pickup === 'have') pickup = HAVE;
    else if (b.pickup) pickup = (await q`SELECT label FROM pickups WHERE id = ${id(b.pickup, 'Abholort')}`)[0]?.label ?? null;
    const when = pickup && pickup !== HAVE ? text(b.day, 60) : '';
    const rows = await q`
      INSERT INTO assignments (campaign_id, area_id, status, person, ordered, pickup, pickup_day)
      VALUES (${cid}, ${id(b.id)}, 'claimed', ${person(b.name)}, ${count(b.ordered)}, ${pickup}, ${when || null})
      ON CONFLICT DO NOTHING RETURNING area_id`;
    if (!rows.length) throw new Fail(409, 'Dieses Gebiet wurde gerade von jemand anderem übernommen.');
  },
  async done(b) {
    const cid = await openCampaign(b.campaign);
    const rows = await q`
      INSERT INTO assignments (campaign_id, area_id, status, person, done_at, distributed, shortfall)
      VALUES (${cid}, ${id(b.id)}, 'done', ${person(b.name)}, now(), ${count(b.distributed)}, ${text(b.shortfall, 500) || null})
      ON CONFLICT (campaign_id, area_id) DO UPDATE
        SET status = 'done', done_at = now(), distributed = EXCLUDED.distributed, shortfall = EXCLUDED.shortfall
        WHERE assignments.status <> 'done'
      RETURNING area_id`;
    if (!rows.length) throw new Fail(409, 'Dieses Gebiet ist bereits als verteilt markiert.');
  },
  async reopen(b) {
    const cid = await openCampaign(b.campaign);
    await q`UPDATE assignments SET status = 'claimed', done_at = NULL, distributed = NULL, shortfall = NULL
            WHERE campaign_id = ${cid} AND area_id = ${id(b.id)}`;
  },
  async release(b) {
    const cid = await openCampaign(b.campaign);
    await q`DELETE FROM assignments WHERE campaign_id = ${cid} AND area_id = ${id(b.id)}`;
  },
  async comment(b) {
    const cid = b.campaign ? id(b.campaign, 'Kampagne') : null;
    const known = cid ? (await q`SELECT 1 FROM campaigns WHERE id = ${cid}`).length : 0;
    await q`INSERT INTO comments (area_id, campaign_id, author, body)
            VALUES (${id(b.id)}, ${known ? cid : null}, ${person(b.name)}, ${required(b.body, 500, 'Die Notiz ist leer.')})`;
  },

  // ---- nur Admin ----
  async pickup_save(b) {
    const label = required(b.label, 80, 'Bitte gib dem Abholort einen Namen.');
    const details = text(b.details, 600);
    if (b.id) await q`UPDATE pickups SET label = ${label}, details = ${details} WHERE id = ${id(b.id, 'Abholort')}`;
    else await q`INSERT INTO pickups (label, details) VALUES (${label}, ${details})`;
  },
  async pickup_remove(b) {
    await q`DELETE FROM pickups WHERE id = ${id(b.id, 'Abholort')}`;
  },
  async comment_remove(b) {
    await q`DELETE FROM comments WHERE id = ${id(b.id, 'Notiz')}`;
  },
  async campaign_create(b) {
    const rows = await q`INSERT INTO campaigns (name) VALUES (${required(b.name, 60, 'Bitte gib der Kampagne einen Namen.')}) RETURNING id`;
    return rows[0].id;
  },
  async campaign_update(b) {
    await q`UPDATE campaigns SET name = ${required(b.name, 60, 'Bitte gib der Kampagne einen Namen.')}, archived = ${!!b.archived}
            WHERE id = ${id(b.id, 'Kampagne')}`;
  },
  async campaign_remove(b) {
    await q`DELETE FROM campaigns WHERE id = ${id(b.id, 'Kampagne')}`;
  },
  async campaign_reset(b) {
    await q`DELETE FROM assignments WHERE campaign_id = ${id(b.id, 'Kampagne')}`;
  },
  async area_create(b) {
    const fields = areaFields(b);
    const fit = fitted(geometry(b.geometry), await otherShapes());
    await query(INSERT_AREAS, [JSON.stringify([{ ...fields, geometry: fit.geometry }])]);
    return fit.trimmed ? { notice: TRIMMED } : undefined;
  },
  async area_update(b) {
    const f = areaFields(b);
    await q`UPDATE areas SET code = ${f.code}, name = ${f.name}, flyers = ${f.flyers},
              description = ${f.description}, map_url = ${f.map_url}
            WHERE id = ${id(b.id)}`;
  },
  async area_reshape(b) {
    const fit = fitted(geometry(b.geometry), await otherShapes(id(b.id)));
    await q`UPDATE areas SET geometry = ${JSON.stringify(fit.geometry)}::jsonb WHERE id = ${id(b.id)}`;
    return fit.trimmed ? { notice: TRIMMED } : undefined;
  },
  async area_remove(b) {
    await q`DELETE FROM areas WHERE id = ${id(b.id)}`;
  },
  async area_import(b) {
    const raw = (Array.isArray(b.areas) ? b.areas : []).slice(0, 500)
      .map((a, i) => ({ ...areaFields({ ...a, name: text(a.name, 60) || `Gebiet ${i + 1}` }), geometry: geometry(a.geometry) }));
    if (!raw.length) throw new Fail(400, 'Keine Gebiete in der Datei gefunden.');
    // Jede Fläche weicht den bestehenden Gebieten und den zuvor importierten aus.
    const shapes = await otherShapes();
    const items = [];
    let trimmed = 0;
    for (const item of raw) {
      let fit;
      try { fit = withoutOverlap(item.geometry, shapes); } catch { fit = null; }
      if (!fit) continue;
      if (fit.trimmed) trimmed += 1;
      shapes.push(fit.geometry);
      items.push({ ...item, geometry: fit.geometry });
    }
    const skipped = raw.length - items.length;
    if (!items.length) throw new Fail(400, 'Alle Flächen der Datei liegen in bestehenden Gebieten. Gebiete dürfen sich nicht überlappen.');
    await query(INSERT_AREAS, [JSON.stringify(items)]);
    return trimmed || skipped
      ? { notice: `${items.length} Gebiete importiert${trimmed ? `, ${trimmed} an Nachbarn abgeschnitten` : ''}${skipped ? `, ${skipped} übersprungen (ganz überlappend oder ungültig)` : ''}.` }
      : undefined;
  },
};
const TEAM_ACTIONS = new Set(['claim', 'done', 'reopen', 'release', 'comment']);

// ---- Aktueller Stand ----------------------------------------------------------
async function snapshot(role, wanted) {
  const all = await q`SELECT id, name, archived FROM campaigns ORDER BY archived, created_at DESC, id DESC`;
  const campaigns = role === 'admin' ? all : all.filter((c) => !c.archived);
  const current = campaigns.find((c) => c.id === Number(wanted)) || campaigns.find((c) => !c.archived) || campaigns[0] || null;
  const cid = current ? current.id : 0;
  const [areas, comments, pickups] = await Promise.all([
    q`SELECT a.id, a.code, a.name, a.flyers, a.description, a.map_url, a.geometry,
             COALESCE(s.status, 'free') AS status, s.person, s.claimed_at, s.done_at, s.distributed,
             s.ordered, s.pickup, s.pickup_day, s.shortfall
      FROM areas a LEFT JOIN assignments s ON s.area_id = a.id AND s.campaign_id = ${cid}
      ORDER BY a.id`,
    q`SELECT c.id, c.area_id, c.author, c.body, c.created_at, k.name AS campaign
      FROM comments c LEFT JOIN campaigns k ON k.id = c.campaign_id
      ORDER BY c.created_at, c.id`,
    q`SELECT id, label, details FROM pickups ORDER BY id`,
  ]);
  const byArea = new Map(areas.map((a) => [a.id, Object.assign(a, { comments: [] })]));
  for (const { area_id, ...c } of comments) byArea.get(area_id)?.comments.push(c);
  return { role, campaigns, campaign: current ? current.id : null, areas, pickups };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!TEAM_PW || !ADMIN_PW) throw new Fail(500, 'TEAM_PASSWORD und ADMIN_PASSWORD müssen in Vercel gesetzt sein.');
    const ip = clientIp(req);
    await checkLimit(ip, res);
    const role = roleOf(req);
    if (!role) {
      // Ohne Passwort (erster Aufruf) zählt nicht als Fehlversuch.
      if (req.headers['x-password']) await noteFailure(ip);
      throw new Fail(401, 'Passwort stimmt nicht.');
    }

    let wanted = new URL(req.url, 'http://x').searchParams.get('c');
    let notice;
    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') {
        try { body = JSON.parse(body || '{}'); } catch { throw new Fail(400, 'Ungültige Anfrage.'); }
      }
      if (!Object.hasOwn(actions, body.action)) throw new Fail(400, 'Unbekannte Aktion.');
      if (!TEAM_ACTIONS.has(body.action) && role !== 'admin') throw new Fail(403, 'Dafür braucht es das Admin-Passwort.');
      wanted = body.campaign ?? wanted;
      try {
        const result = await actions[body.action](body);
        if (body.action === 'campaign_create') wanted = result;
        else notice = result?.notice;
      } catch (e) {
        // Das Gebiet oder die Kampagne wurde inzwischen gelöscht (Fremdschlüssel greift ins Leere).
        const gone = e?.code === '23503';
        // Bei Konflikten den aktuellen Stand mitschicken, damit die Karte sofort stimmt.
        if (gone || (e instanceof Fail && e.status === 409)) {
          const error = gone ? 'Dieses Gebiet gibt es nicht mehr.' : e.message;
          return res.status(409).json({ error, ...(await snapshot(role, wanted)) });
        }
        throw e;
      }
    } else if (req.method !== 'GET') {
      throw new Fail(405, 'Methode nicht erlaubt.');
    }
    return res.status(200).json({ ...(await snapshot(role, wanted)), ...(notice && { notice }) });
  } catch (e) {
    if (e instanceof Fail) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Serverfehler – bitte später nochmals versuchen.' });
  }
}
