import { timingSafeEqual, createHash } from 'node:crypto';
import { q, query, INSERT_AREAS } from '../lib/db.js';

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

class Fail extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
const person = (v) => required(v, 40, 'Bitte gib deinen Namen an.');
const count = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 1000000 ? n : null;
};
const mapUrl = (v) => {
  const t = text(v, 500);
  return /^(https:\/\/|\/)/.test(t) ? t : '';
};
function geometry(g) {
  if (!g || !['Point', 'Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates)) {
    throw new Fail(400, 'Das Gebiet braucht eine Position oder Fläche.');
  }
  const clean = { type: g.type, coordinates: g.coordinates };
  if (JSON.stringify(clean).length > 200000) throw new Fail(400, 'Die Fläche ist zu detailliert.');
  return clean;
}
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
    const rows = await q`
      INSERT INTO assignments (campaign_id, area_id, status, person)
      VALUES (${cid}, ${id(b.id)}, 'claimed', ${person(b.name)})
      ON CONFLICT DO NOTHING RETURNING area_id`;
    if (!rows.length) throw new Fail(409, 'Dieses Gebiet wurde gerade von jemand anderem übernommen.');
  },
  async done(b) {
    const cid = await openCampaign(b.campaign);
    const rows = await q`
      INSERT INTO assignments (campaign_id, area_id, status, person, done_at, distributed)
      VALUES (${cid}, ${id(b.id)}, 'done', ${person(b.name)}, now(), ${count(b.distributed)})
      ON CONFLICT (campaign_id, area_id) DO UPDATE
        SET status = 'done', done_at = now(), distributed = EXCLUDED.distributed
        WHERE assignments.status <> 'done'
      RETURNING area_id`;
    if (!rows.length) throw new Fail(409, 'Dieses Gebiet ist bereits als verteilt markiert.');
  },
  async reopen(b) {
    const cid = await openCampaign(b.campaign);
    await q`UPDATE assignments SET status = 'claimed', done_at = NULL, distributed = NULL
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
    await query(INSERT_AREAS, [JSON.stringify([{ ...areaFields(b), geometry: geometry(b.geometry) }])]);
  },
  async area_update(b) {
    const f = areaFields(b);
    await q`UPDATE areas SET code = ${f.code}, name = ${f.name}, flyers = ${f.flyers},
              description = ${f.description}, map_url = ${f.map_url}
            WHERE id = ${id(b.id)}`;
  },
  async area_reshape(b) {
    await q`UPDATE areas SET geometry = ${JSON.stringify(geometry(b.geometry))}::jsonb WHERE id = ${id(b.id)}`;
  },
  async area_remove(b) {
    await q`DELETE FROM areas WHERE id = ${id(b.id)}`;
  },
  async area_import(b) {
    const items = (Array.isArray(b.areas) ? b.areas : []).slice(0, 500)
      .map((a, i) => ({ ...areaFields({ ...a, name: text(a.name, 60) || `Gebiet ${i + 1}` }), geometry: geometry(a.geometry) }));
    if (!items.length) throw new Fail(400, 'Keine Gebiete in der Datei gefunden.');
    await query(INSERT_AREAS, [JSON.stringify(items)]);
  },
};
const TEAM_ACTIONS = new Set(['claim', 'done', 'reopen', 'release', 'comment']);

// ---- Aktueller Stand ----------------------------------------------------------
async function snapshot(role, wanted) {
  const all = await q`SELECT id, name, archived FROM campaigns ORDER BY archived, created_at DESC, id DESC`;
  const campaigns = role === 'admin' ? all : all.filter((c) => !c.archived);
  const current = campaigns.find((c) => c.id === Number(wanted)) || campaigns.find((c) => !c.archived) || campaigns[0] || null;
  const cid = current ? current.id : 0;
  const [areas, comments] = await Promise.all([
    q`SELECT a.id, a.code, a.name, a.flyers, a.description, a.map_url, a.geometry,
             COALESCE(s.status, 'free') AS status, s.person, s.claimed_at, s.done_at, s.distributed
      FROM areas a LEFT JOIN assignments s ON s.area_id = a.id AND s.campaign_id = ${cid}
      ORDER BY a.id`,
    q`SELECT c.id, c.area_id, c.author, c.body, c.created_at, k.name AS campaign
      FROM comments c LEFT JOIN campaigns k ON k.id = c.campaign_id
      ORDER BY c.created_at, c.id`,
  ]);
  const byArea = new Map(areas.map((a) => [a.id, Object.assign(a, { comments: [] })]));
  for (const { area_id, ...c } of comments) byArea.get(area_id)?.comments.push(c);
  return { role, campaigns, campaign: current ? current.id : null, areas };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!TEAM_PW || !ADMIN_PW) throw new Fail(500, 'TEAM_PASSWORD und ADMIN_PASSWORD müssen in Vercel gesetzt sein.');
    const role = roleOf(req);
    if (!role) throw new Fail(401, 'Passwort stimmt nicht.');

    let wanted = new URL(req.url, 'http://x').searchParams.get('c');
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (!Object.hasOwn(actions, body.action)) throw new Fail(400, 'Unbekannte Aktion.');
      if (!TEAM_ACTIONS.has(body.action) && role !== 'admin') throw new Fail(403, 'Dafür braucht es das Admin-Passwort.');
      wanted = body.campaign ?? wanted;
      try {
        const created = await actions[body.action](body);
        if (body.action === 'campaign_create') wanted = created;
      } catch (e) {
        // Bei Konflikten den aktuellen Stand mitschicken, damit die Karte sofort stimmt.
        if (e instanceof Fail && e.status === 409) {
          return res.status(409).json({ error: e.message, ...(await snapshot(role, wanted)) });
        }
        throw e;
      }
    } else if (req.method !== 'GET') {
      throw new Fail(405, 'Methode nicht erlaubt.');
    }
    return res.status(200).json(await snapshot(role, wanted));
  } catch (e) {
    if (e instanceof Fail) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Serverfehler – bitte später nochmals versuchen.' });
  }
}
