// Datenbankzugriff: Neon (Postgres) auf Vercel, eingebettete PGlite-Datenbank lokal.
import { SEED_AREAS } from './seed.js';

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
