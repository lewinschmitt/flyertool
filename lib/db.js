// Datenbankzugriff: Neon (Postgres) auf Vercel, eingebettete PGlite-Datenbank lokal.
import { SEED_AREAS } from './seed.js';
import { ALTE_NOTIZEN } from './altnotizen.js';
import { createHash } from 'node:crypto';
import { shortName } from './name.js';

// Fingerabdrücke der ersten, aus den Plänen abgezeichneten Grenzen. Gebiete, die noch genau diese Fläche
// haben, wurden nie von Hand geändert und dürfen durch die neuen, strassengenauen Grenzen ersetzt werden.
const GRENZEN_V1 = {"H1":"37c75e9ee6b8","H2":"07222dc1bca0","H3":"ea284da1f0d2","H4":"14b4ef6973dd","H6":"390f14aba4bb","H7":"13f6b7f87a1f","H8":"104ded70e198","H9":"56878f348563","H10":"f3fc8bbde5c1","W1":"a4f92f4848d3","W2":"d2f83d5c5348","W3":"cd4c537dd0f4","W4":"59693c7cf077","W5":"d40c19d6cbb7","W6":"facd6940ff8c","W7":"f5b10fa61c6a","W8":"2b38b1ee3fd3","U1":"30742774eaba","U2":"7b69ea15bdc3","U3":"167928a42ad6","U4":"ef36f8050fb0","U5":"25809e1d6d26","U6":"e79a9fd07e3a","U7":"9a6d04aa8f68","O1":"fbdc3619a20e","O2":"6bb6c229b8d7","O3":"d0c65253771f","O4":"7063a0a8b6cc","O5":"3229efb8a33c","S1":"3c984bbad00b","S2":"934a8b44a683","S3":"7abaa6a208e3","S4":"bff9d4c5b7ca"};
const fingerprint = (geometry) => createHash('sha1').update(JSON.stringify(geometry.coordinates)).digest('hex').slice(0, 12);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS campaigns (
     id         SERIAL PRIMARY KEY,
     name       TEXT NOT NULL,
     archived   BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Gebiete gelten für alle Kampagnen. geometry: GeoJSON Point (ungefähre Lage) oder Polygon.
  `CREATE TABLE IF NOT EXISTS areas (
     id          SERIAL PRIMARY KEY,
     code        TEXT NOT NULL DEFAULT '',
     name        TEXT NOT NULL,
     flyers      TEXT NOT NULL DEFAULT '',
     description TEXT NOT NULL DEFAULT '',
     map_url     TEXT NOT NULL DEFAULT '',
     geometry    JSONB NOT NULL
   )`,
  // Eine Zeile = Gebiet ist in dieser Kampagne vergeben oder verteilt. Keine Zeile = frei.
  `CREATE TABLE IF NOT EXISTS assignments (
     campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
     area_id     INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
     status      TEXT NOT NULL CHECK (status IN ('claimed','done')),
     person      TEXT NOT NULL,
     claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     done_at     TIMESTAMPTZ,
     distributed INTEGER,
     PRIMARY KEY (campaign_id, area_id)
   )`,
  // Notizen gehören zum Gebiet und bleiben über Kampagnen hinweg erhalten.
  `CREATE TABLE IF NOT EXISTS comments (
     id          SERIAL PRIMARY KEY,
     area_id     INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
     campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
     author      TEXT NOT NULL,
     body        TEXT NOT NULL,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Fehlgeschlagene Passwort-Eingaben pro Absender – Grundlage für die Sperre nach zu vielen Versuchen.
  `CREATE TABLE IF NOT EXISTS login_failures (
     ip TEXT NOT NULL,
     at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS login_failures_ip_at ON login_failures (ip, at)`,
];

export const INSERT_AREAS = `
  INSERT INTO areas (code, name, flyers, description, map_url, geometry)
  SELECT COALESCE(code,''), name, COALESCE(flyers,''), COALESCE(description,''), COALESCE(map_url,''), geometry
  FROM jsonb_to_recordset($1::jsonb)
    AS x(code TEXT, name TEXT, flyers TEXT, description TEXT, map_url TEXT, geometry JSONB)`;

let ready;
async function init() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let run;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    run = (text, params) => sql.query(text, params);
  } else if (process.env.VERCEL) {
    throw new Error('DATABASE_URL fehlt – bitte in Vercel eine Neon-Datenbank verbinden.');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(process.env.LOCAL_DB_DIR || './.localdb');
    run = async (text, params) => (await db.query(text, params)).rows;
  }
  for (const stmt of SCHEMA) await run(stmt, []);
  // Startdaten genau einmal einspielen (auch wenn später alle Gebiete gelöscht werden).
  const first = await run(`INSERT INTO meta (key) VALUES ('seeded') ON CONFLICT DO NOTHING RETURNING key`, []);
  if (first.length) {
    await run(INSERT_AREAS, [JSON.stringify(SEED_AREAS)]);
    await run(`INSERT INTO campaigns (name) VALUES ('Erste Kampagne')`, []);
  }
  // Datenbanken aus der Zeit vor den eingezeichneten Grenzen: Gebiete, die noch ein blosser Punkt sind,
  // erhalten einmalig die Fläche aus den Startdaten. Selbst gezeichnete Flächen bleiben unberührt.
  const borders = await run(`INSERT INTO meta (key) VALUES ('grenzen-1') ON CONFLICT DO NOTHING RETURNING key`, []);
  if (borders.length) {
    await run(
      `UPDATE areas a SET geometry = x.geometry
       FROM jsonb_to_recordset($1::jsonb) AS x(code TEXT, geometry JSONB)
       WHERE a.code = x.code AND a.geometry->>'type' = 'Point' AND x.geometry->>'type' <> 'Point'`,
      [JSON.stringify(SEED_AREAS.map(({ code, geometry }) => ({ code, geometry })))],
    );
  }
  // Strassengenaue, überlappungsfreie Grenzen: ersetzt unveränderte alte Flächen und verbliebene Punkte.
  const streets = await run(`INSERT INTO meta (key) VALUES ('grenzen-2') ON CONFLICT DO NOTHING RETURNING key`, []);
  if (streets.length) {
    const byCode = new Map(SEED_AREAS.map((a) => [a.code, a.geometry]));
    for (const row of await run(`SELECT id, code, geometry FROM areas`, [])) {
      const next = byCode.get(row.code);
      const untouched = row.geometry.type === 'Point' || GRENZEN_V1[row.code] === fingerprint(row.geometry);
      if (next && next.type !== 'Point' && untouched && fingerprint(next) !== fingerprint(row.geometry)) {
        await run(`UPDATE areas SET geometry = $1::jsonb WHERE id = $2`, [JSON.stringify(next), row.id]);
      }
    }
  }
  // Kommentare aus dem bisherigen Tool einmalig als Notizen übernehmen (Zuordnung über das Kürzel).
  const notes = await run(`INSERT INTO meta (key) VALUES ('altnotizen-1') ON CONFLICT DO NOTHING RETURNING key`, []);
  if (notes.length) {
    await run(
      `INSERT INTO comments (area_id, author, body, created_at)
       SELECT a.id, x.author, x.body, COALESCE(x.date::timestamptz + interval '12 hours', now())
       FROM jsonb_to_recordset($1::jsonb) AS x(code TEXT, author TEXT, body TEXT, date TEXT)
       JOIN areas a ON a.code = x.code`,
      [JSON.stringify(ALTE_NOTIZEN)],
    );
  }
  // Namen einmalig auf «Vorname N.» vereinheitlichen – auch bei schon übernommenen alten Notizen.
  const names = await run(`INSERT INTO meta (key) VALUES ('namen-1') ON CONFLICT DO NOTHING RETURNING key`, []);
  if (names.length) {
    await run(
      `UPDATE comments c SET author = x.author
       FROM jsonb_to_recordset($1::jsonb) AS x(author TEXT, body TEXT)
       WHERE c.body = x.body AND c.author <> x.author AND c.campaign_id IS NULL`,
      [JSON.stringify(ALTE_NOTIZEN)],
    );
    for (const [table, column] of [['assignments', 'person'], ['comments', 'author']]) {
      const rows = await run(`SELECT DISTINCT ${column} AS name FROM ${table}`, []);
      for (const { name } of rows) {
        const short = shortName(name).slice(0, 40);
        if (short && short !== name) await run(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [short, name]);
      }
    }
  }
  return run;
}

export async function query(text, params = []) {
  ready ??= init().catch((e) => { ready = undefined; throw e; });
  return (await ready)(text, params);
}

// Tagged Template: q`SELECT * FROM areas WHERE id = ${id}` – Werte gehen immer als Parameter mit.
export function q(strings, ...values) {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return query(text, values);
}
