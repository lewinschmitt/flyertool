'use strict';

/* ---------- Hilfen ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('flyer.' + k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem('flyer.' + k, v); } catch { /* privater Modus */ } },
};
// «12. Nov.» – bei älteren Einträgen mit Jahr, damit übernommene Notizen einzuordnen sind.
const day = (d) => {
  const t = new Date(d);
  return t.toLocaleDateString('de-CH', { day: 'numeric', month: 'short', ...(t.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
};
// Namen erscheinen überall als «Vorname N.» (gleiche Regel wie in lib/name.js).
function shortName(value) {
  const t = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (/[,&+/]| und /i.test(t)) return t;
  const parts = t.split(' ');
  const initial = parts.length > 1 ? [...parts.at(-1)][0] : '';
  return /\p{L}/u.test(initial) ? `${parts[0]} ${initial.toUpperCase()}.` : t;
}
const sameName = (a, b) => !!a && !!b && shortName(a).toLowerCase() === shortName(b).toLowerCase();
// «1000-1200» → 1200, «ca. 250» → 250, «» → 0
const flyerNum = (t) => { const m = /(\d+)(?:\s*[-–]\s*(\d+))?/.exec(t || ''); return m ? Number(m[2] || m[1]) : 0; };
const STATUS = { free: 'frei', claimed: 'vergeben', done: 'verteilt' };
const LEGACY_PLANS = 'https://www.ps-ps.ch/gruene-6-10/karten/';
const MARK = { free: '', claimed: ' …', done: ' ✓' };

/* ---------- Zustand ---------- */
const params = new URLSearchParams(location.search);
const hashPw = new URLSearchParams(location.hash.slice(1)).get('pw');
if (hashPw) { store.set('pw', hashPw); history.replaceState(null, '', location.pathname + location.search); }

const S = {
  pw: store.get('pw'),
  name: shortName(store.get('name')),
  role: null,
  campaigns: [],
  campaign: Number(params.get('k') || store.get('campaign')) || null,
  areas: [],
  selected: null,
  view: 'map',
  drawing: null,
  fitted: false,
  onlyFree: store.get('onlyFree') === '1',
};
const area = (id) => S.areas.find((a) => a.id === id);
const isMine = (a) => a.status !== 'free' && sameName(a.person, S.name);
const currentCampaign = () => S.campaigns.find((c) => c.id === S.campaign);

/* ---------- Server ---------- */
async function api(body) {
  const res = await fetch('/api/data' + (S.campaign ? '?c=' + S.campaign : ''), {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-password': encodeURIComponent(S.pw) },
    body: body ? JSON.stringify({ campaign: S.campaign, ...body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    S.pw = ''; store.set('pw', '');
    login(S.role || hashPw || data.error ? 'Das Passwort stimmt nicht.' : '');
    throw new Error('auth');
  }
  // Gesperrt nach zu vielen falschen Passwörtern: wer noch nicht angemeldet war, tippt neu.
  if (res.status === 429 && !S.role) {
    S.pw = ''; store.set('pw', '');
    login(data.error || 'Zu viele Versuche – bitte später nochmals probieren.');
    throw new Error('auth');
  }
  if (data.areas) apply(data);
  if (!res.ok) { toast(data.error || 'Das hat leider nicht geklappt.'); throw new Error(data.error || 'error'); }
  return data;
}
const act = (body, okMessage) => api(body).then(() => { if (okMessage) toast(okMessage); }).catch(() => {});

function apply(data) {
  S.role = data.role;
  S.campaigns = data.campaigns;
  S.campaign = data.campaign;
  S.areas = data.areas.sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name, 'de', { numeric: true }));
  if (S.campaign) {
    store.set('campaign', String(S.campaign));
    history.replaceState(null, '', location.pathname + '?k=' + S.campaign);
  }
  render();
}

async function load(silent) {
  try { await api(); } catch (e) { if (!silent && e.message !== 'auth') console.warn(e); }
}

/* ---------- Karte ---------- */
const map = L.map('map', { zoomControl: false, zoomSnap: 0.25 }).setView([47.3975, 8.523], 13);
map.attributionControl.setPrefix(false);
// In der Übersicht sind die Marken klein und ein Antippen zoomt zuerst hinein.
const FAR = 13.5;
const markFar = () => map.getContainer().classList.toggle('far', map.getZoom() < FAR);
map.on('zoomend', markFar);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);
map.pm.setLang('de');
const shapes = L.layerGroup().addTo(map);
const COLORS = { free: '#c4006a', claimed: '#f2b705', done: '#3f8f1f' };

// Äussere Ringe einer Fläche als Listen von [lng, lat].
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [])
  .filter((r) => Array.isArray(r) && r.length > 2);
const ringArea = (r) => r.reduce((sum, p, i) => { const q = r[(i + 1) % r.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// Punkt für die Marke: Schwerpunkt der grössten Teilfläche. Liegt er ausserhalb (verwinkelte Gebiete),
// wird er auf gleicher Höhe in die Mitte des breitesten Stücks der Fläche geschoben.
function centerOf(a) {
  const g = a.geometry;
  if (g.type === 'Point') return L.latLng(g.coordinates[1], g.coordinates[0]);
  const ring = ringsOf(g).sort((p, q) => Math.abs(ringArea(q)) - Math.abs(ringArea(p)))[0];
  const area = ring ? ringArea(ring) : 0;
  if (!area) return L.geoJSON(g).getBounds().getCenter();
  let x = 0, y = 0;
  const cuts = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const f = p[0] * q[1] - q[0] * p[1];
    x += (p[0] + q[0]) * f; y += (p[1] + q[1]) * f;
  });
  x /= 6 * area; y /= 6 * area;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if ((p[1] > y) !== (q[1] > y)) cuts.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
  });
  cuts.sort((m, n) => m - n);
  let best = null;
  for (let i = 0; i + 1 < cuts.length; i += 2) {
    if (cuts[i] <= x && x <= cuts[i + 1]) return L.latLng(y, x);
    if (!best || cuts[i + 1] - cuts[i] > best[1] - best[0]) best = [cuts[i], cuts[i + 1]];
  }
  return L.latLng(y, best ? (best[0] + best[1]) / 2 : x);
}
const boundsOf = (a) => (a.geometry.type === 'Point' ? L.latLngBounds([centerOf(a)]) : L.geoJSON(a.geometry).getBounds());
// Gebiet ins Bild holen: Flächen ganz zeigen, Punkte in der Nähe.
function focus(a, minZoom) {
  if (a.geometry.type === 'Point') map.setView(centerOf(a), Math.max(map.getZoom(), minZoom));
  else map.fitBounds(boundsOf(a), { maxZoom: 16, paddingTopLeft: [24, 24], paddingBottomRight: [24, Math.round(map.getSize().y * 0.45)] });
}

function tap(a) {
  if (map.getZoom() < FAR) focus(a, 14.5);
  else select(a.id);
}

function renderMap() {
  shapes.clearLayers();
  const interactive = !S.drawing;
  // Filter «Nur freie»: vergebene und verteilte Gebiete treten in den Hintergrund (bleiben aber antippbar).
  const dimmed = (a) => S.onlyFree && a.status !== 'free' && a.id !== S.selected;
  const bounds = L.latLngBounds([]);
  for (const a of S.areas) {
    const selected = a.id === S.selected;
    if (a.geometry.type !== 'Point') {
      const poly = L.geoJSON(a.geometry, {
        interactive,
        // Ohne dies würde der Klick zur Karte weiterwandern und das eben geöffnete Gebiet gleich wieder schliessen.
        bubblingMouseEvents: false,
        style: dimmed(a)
          ? { color: '#8a9285', weight: 1, fillColor: '#8a9285', fillOpacity: 0.08 }
          : { color: selected ? '#1c2416' : COLORS[a.status], weight: selected ? 4 : S.onlyFree ? 3.5 : 2.5, fillColor: COLORS[a.status], fillOpacity: a.status === 'done' || S.onlyFree ? 0.45 : 0.3 },
      });
      if (interactive) poly.on('click', () => tap(a));
      shapes.addLayer(poly);
    }
    const c = centerOf(a);
    bounds.extend(boundsOf(a));
    const pin = L.marker(c, {
      interactive,
      keyboard: false,
      zIndexOffset: selected ? 1000 : dimmed(a) ? -500 : 0,
      icon: L.divIcon({
        className: '',
        iconSize: [0, 0],
        html: `<div class="pin${selected ? ' sel' : ''}${dimmed(a) ? ' dim' : ''}"><span class="badge ${a.status}${isMine(a) ? ' mine' : ''}">${esc(a.code || a.name)}${MARK[a.status]}</span></div>`,
      }),
    });
    if (interactive) pin.on('click', () => tap(a));
    shapes.addLayer(pin);
  }
  if (!S.fitted && bounds.isValid()) {
    S.fitted = true;
    map.fitBounds(bounds, { padding: [24, 24] });
    markFar();
  }
}

let me;
map.on('locationfound', (e) => {
  me?.remove();
  me = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(map);
});
map.on('locationerror', () => toast('Standort nicht verfügbar – bitte im Browser erlauben.'));
$('#locate').onclick = () => map.locate({ setView: true, maxZoom: 16 });

/* ---------- Flächen zeichnen (Admin) ---------- */
function startDraw(onDone) {
  closeSheet();
  setView('map');
  S.drawing = { onDone };
  $('#drawbar').hidden = false;
  renderMap();
  map.pm.enableDraw('Polygon', { snappable: false, continueDrawing: false });
}
function stopDraw() {
  S.drawing = null;
  $('#drawbar').hidden = true;
  map.pm.disableDraw();
  renderMap();
}
map.on('pm:create', (e) => {
  const geometry = e.layer.toGeoJSON().geometry;
  e.layer.remove();
  const onDone = S.drawing?.onDone;
  stopDraw();
  onDone?.(geometry);
});
$('#drawCancel').onclick = stopDraw;
$('#drawDone').onclick = () => {
  try { map.pm.Draw.Polygon._finishShape(); } catch { /* zu wenige Punkte */ }
  if (S.drawing) toast('Bitte mindestens drei Eckpunkte setzen.');
};

/* ---------- Kopfzeile ---------- */
function renderHeader() {
  $('#who').textContent = S.name || 'Name';
  $('#adminBtn').hidden = S.role !== 'admin';
  $('#onlyFree').textContent = filterLabel();
  $('#onlyFree').setAttribute('aria-pressed', S.onlyFree);
  const sel = $('#campaign');
  sel.innerHTML = S.campaigns.length
    ? S.campaigns.map((c) => `<option value="${c.id}"${c.id === S.campaign ? ' selected' : ''}>${esc(c.name)}${c.archived ? ' (abgeschlossen)' : ''}</option>`).join('')
    : '<option>Noch keine Kampagne</option>';
  sel.disabled = S.campaigns.length < 2;

  const total = S.areas.length;
  const done = S.areas.filter((a) => a.status === 'done').length;
  const claimed = S.areas.filter((a) => a.status === 'claimed').length;
  $('#progress').innerHTML = total
    ? `<b>${done} von ${total}</b> verteilt${claimed ? ` · ${claimed} vergeben` : ''}
       <div class="bar"><i class="d" style="width:${(done / total) * 100}%"></i><i class="c" style="width:${(claimed / total) * 100}%"></i></div>`
    : '';
}
$('#campaign').onchange = (e) => { S.campaign = Number(e.target.value); load(); };
$('#who').onclick = () => login();
$('#adminBtn').onclick = () => { S.selected = null; openAdmin(); renderMap(); };

/* ---------- Filter «Nur freie Gebiete» ---------- */
const freeCount = () => S.areas.filter((a) => a.status === 'free').length;
const filterLabel = () => `${S.onlyFree ? '✓ ' : ''}Nur freie Gebiete (${freeCount()})`;
function toggleOnlyFree() {
  S.onlyFree = !S.onlyFree;
  store.set('onlyFree', S.onlyFree ? '1' : '');
  if (S.onlyFree && !freeCount()) toast('In dieser Kampagne ist kein Gebiet mehr frei.');
  render();
}
$('#onlyFree').onclick = toggleOnlyFree;

/* ---------- Liste ---------- */
function renderList() {
  const box = $('#list');
  if (S.view === 'map') { box.hidden = true; return; }
  box.hidden = false;
  const mineOnly = S.view === 'mine';
  const pool = mineOnly ? S.areas.filter(isMine) : S.areas;
  const filter = mineOnly || !S.areas.length ? '' : `<button type="button" class="filter" data-filter aria-pressed="${S.onlyFree}">${filterLabel()}</button>`;
  if (!currentCampaign()) { box.innerHTML = '<p class="empty">Es läuft gerade keine Kampagne.</p>'; return; }
  if (!pool.length) {
    box.innerHTML = `<p class="empty">${mineOnly
      ? 'Du hast in dieser Kampagne noch kein Gebiet übernommen.<br>Tippe auf der Karte auf ein pinkes Gebiet.'
      : 'Noch keine Gebiete erfasst.'}</p>`;
    return;
  }
  const groups = mineOnly
    ? [['claimed', 'Noch zu verteilen'], ['done', 'Erledigt – danke!']]
    : S.onlyFree ? [['free', 'Noch frei']]
      : [['free', 'Noch frei'], ['claimed', 'Vergeben'], ['done', 'Verteilt']];
  box.innerHTML = filter + (groups.map(([status, title]) => {
    const rows = pool.filter((a) => a.status === status);
    if (!rows.length) return '';
    return `<h2>${title} (${rows.length})</h2>` + rows.map((a) => {
      const detail = a.status === 'free'
        ? (a.flyers ? `${esc(a.flyers)} Flyer` : 'Flyerzahl offen')
        : `${esc(a.person)}${a.status === 'done' ? ' · ' + day(a.done_at) : ''}`;
      return `<button type="button" class="row" data-id="${a.id}">
        <span class="badge static ${a.status}${isMine(a) ? ' mine' : ''}">${esc(a.code || '•')}${MARK[a.status]}</span>
        <span class="txt"><b>${esc(a.name)}</b><small>${detail}</small></span>
      </button>`;
    }).join('');
  }).join('') || '<p class="empty">In dieser Kampagne ist kein Gebiet mehr frei.</p>');
}
$('#list').onclick = (e) => {
  if (e.target.closest('[data-filter]')) return toggleOnlyFree();
  const row = e.target.closest('.row');
  if (row) select(Number(row.dataset.id), true);
};

function setView(view) {
  S.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('#legend').hidden = $('#locate').hidden = $('#onlyFree').hidden = view !== 'map';
  renderList();
  if (view === 'map') map.invalidateSize();
}
document.querySelector('.tabs').onclick = (e) => {
  const b = e.target.closest('button');
  if (b) { closeSheet(); setView(b.dataset.view); }
};

/* ---------- Gebiets-Detail (Bottom Sheet) ---------- */
function select(id, fromList) {
  S.selected = id;
  const a = area(id);
  if (a && (fromList || S.view !== 'map')) {
    setView('map');
    focus(a, 15);
  }
  renderMap();
  renderSheet(true);
}
function closeSheet() {
  S.selected = null;
  $('#sheet').hidden = true;
  $('#sheet').dataset.kind = '';
  renderMap();
}

function renderSheet(force) {
  const sheet = $('#sheet');
  if (sheet.dataset.kind === 'admin' && !force) { openAdmin(); return; }
  const a = area(S.selected);
  if (!a) { if (sheet.dataset.kind === 'area') { sheet.hidden = true; sheet.dataset.kind = ''; } return; }
  // Beim automatischen Aktualisieren keine halb getippte Notiz überschreiben.
  if (!force && sheet.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;

  const open = currentCampaign() && !currentCampaign().archived;
  const mine = isMine(a);
  let state, buttons = '';
  if (a.status === 'free') {
    state = 'Dieses Gebiet ist <b>noch frei</b>.';
    buttons = `<div class="actions"><button class="btn go" data-act="claim">Ich übernehme dieses Gebiet</button>
      <button class="btn" data-act="done">Ist schon verteilt</button></div>`;
  } else if (a.status === 'claimed') {
    state = mine ? `<b>Du</b> hast dieses Gebiet übernommen (${day(a.claimed_at)}).` : `Übernommen von <b>${esc(a.person)}</b> (${day(a.claimed_at)}).`;
    buttons = mine
      ? `<div class="actions"><button class="btn primary" data-act="done">Fertig verteilt ✓</button>
         <button class="btn" data-act="release">Doch wieder freigeben</button></div>`
      : `<div class="actions two"><button class="btn" data-act="done">Als verteilt markieren</button>
         <button class="btn" data-act="release">Freigeben</button></div>`;
  } else {
    state = `<b>Verteilt</b> von ${mine ? 'dir' : esc(a.person)} am ${day(a.done_at)}${a.distributed != null ? ` · ${a.distributed} Flyer` : ''}.`;
    buttons = `<div class="actions"><button class="btn" data-act="reopen">Rückgängig: doch noch nicht fertig</button></div>`;
  }
  if (!currentCampaign()) { state = 'Es läuft gerade keine Kampagne.'; buttons = ''; }
  else if (!open) buttons = '<p class="hint">Diese Kampagne ist abgeschlossen.</p>';

  const c = centerOf(a);
  const approx = a.geometry.type === 'Point';
  sheet.dataset.kind = 'area';
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>${a.code ? `<span class="badge static ${a.status}">${esc(a.code)}${MARK[a.status]}</span> ` : ''}${esc(a.name)}</h2>
      <button class="close" data-act="close" aria-label="Schliessen">×</button>
    </div>
    <p class="state">${state}</p>
    <p class="meta">${a.flyers ? `Benötigt: ${esc(a.flyers)} Flyer` : 'Flyerzahl noch unbekannt'}</p>
    ${buttons}
    ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
    ${a.map_url ? `<a class="plan" href="${esc(a.map_url)}" target="_blank" rel="noopener">
        <img src="${esc(a.map_url)}" alt="Detailplan ${esc(a.name)}" loading="lazy" data-plan>
        <span>Detailplan gross öffnen ↗</span></a>` : ''}
    <a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(5)},${c.lng.toFixed(5)}">In Google Maps öffnen${approx ? ' (ungefähre Lage)' : ''}</a>
    <h3 class="sub">Notizen zum Gebiet</h3>
    ${a.comments.map((n) => `<div class="note">
        ${S.role === 'admin' ? `<button data-act="note-remove" data-note="${n.id}" aria-label="Notiz löschen">×</button>` : ''}
        ${esc(n.body)}<small>${esc(n.author)} · ${day(n.created_at)}${n.campaign ? ' · ' + esc(n.campaign) : ''}</small></div>`).join('')
      || '<p class="hint">Noch keine Notizen. Tipps wie «Briefkästen im Innenhof» oder die tatsächliche Flyerzahl helfen den Nächsten.</p>'}
    <form class="noteform" data-form="note">
      <input type="text" name="body" maxlength="500" placeholder="Notiz hinzufügen …" aria-label="Notiz">
      <button class="btn small primary">Senden</button>
    </form>
    ${S.role === 'admin' ? `<div class="adminrow">
      <button class="btn small" data-act="edit">Bearbeiten</button>
      <button class="btn small" data-act="reshape">${approx ? 'Fläche einzeichnen' : 'Fläche neu zeichnen'}</button>
      <button class="btn small danger" data-act="remove">Löschen</button></div>` : ''}`;
  // Fehlt ein Detailplan lokal, wird er von der alten Seite geladen; gibt es ihn auch dort nicht, verschwindet das Bild.
  const img = sheet.querySelector('img[data-plan]');
  if (img) img.onerror = () => {
    const file = /^\/karten\/([^/]+)$/.exec(a.map_url)?.[1];
    if (file && !img.dataset.retry) { img.dataset.retry = '1'; img.src = img.parentElement.href = LEGACY_PLANS + file; }
    else img.remove();
  };
  if (force) sheet.scrollTop = 0;
}

$('#sheet').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.dataset.form !== 'note') return;
  const body = e.target.body.value.trim();
  if (!body || !(await needName())) return;
  e.target.body.value = '';
  e.target.body.blur();
  act({ action: 'comment', id: S.selected, name: S.name, body });
});

$('#sheet').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const kind = btn.dataset.act;
  if (kind === 'close') return closeSheet();
  if (ADMIN[kind]) return ADMIN[kind](btn);
  const a = area(S.selected);
  if (!a) return;
  const id = a.id;

  if (kind === 'claim') {
    if (!(await needName())) return;
    act({ action: 'claim', id, name: S.name }, `${a.code || a.name} gehört dir – danke!`);
  } else if (kind === 'done') {
    if (!(await needName())) return;
    const v = await ask({
      title: `${a.code || a.name} verteilt?`,
      text: 'Wenn du magst: Wie viele Flyer hast du ungefähr gebraucht? Das hilft bei der nächsten Planung.',
      fields: [{ name: 'distributed', label: 'Anzahl Flyer (freiwillig)', type: 'number', placeholder: a.flyers ? `geschätzt: ${a.flyers}` : '' }],
      ok: 'Als verteilt markieren',
    });
    if (v) act({ action: 'done', id, name: S.name, distributed: v.distributed }, 'Super, vielen Dank!');
  } else if (kind === 'release') {
    if (!isMine(a) && !(await ask({ title: 'Gebiet freigeben?', text: `${a.person} hat dieses Gebiet übernommen. Bitte nur freigeben, wenn das abgesprochen ist.`, ok: 'Freigeben' }))) return;
    act({ action: 'release', id }, 'Gebiet ist wieder frei.');
  } else if (kind === 'reopen') {
    act({ action: 'reopen', id });
  } else if (kind === 'note-remove') {
    act({ action: 'comment_remove', id: Number(btn.dataset.note) });
  } else if (kind === 'edit') {
    areaForm(a);
  } else if (kind === 'reshape') {
    startDraw((geometry) => act({ action: 'area_reshape', id, geometry }, 'Fläche gespeichert.'));
  } else if (kind === 'remove') {
    if (await ask({ title: `${a.code || a.name} löschen?`, text: 'Das Gebiet verschwindet aus allen Kampagnen, samt Notizen. Das lässt sich nicht rückgängig machen.', ok: 'Endgültig löschen' })) {
      S.selected = null;
      act({ action: 'area_remove', id });
    }
  }
});

/* ---------- Verwaltung (Admin) ---------- */
async function areaForm(a, geometry) {
  const v = await ask({
    title: a ? 'Gebiet bearbeiten' : 'Neues Gebiet',
    fields: [
      { name: 'code', label: 'Kürzel (z. B. W3)', value: a?.code, maxlength: 12 },
      { name: 'name', label: 'Name', value: a?.name, required: true, maxlength: 60 },
      { name: 'flyers', label: 'Anzahl Flyer (z. B. 1000 oder 900-1000)', value: a?.flyers, maxlength: 40 },
      { name: 'description', label: 'Abgrenzung / Beschreibung', type: 'textarea', value: a?.description },
      { name: 'map_url', label: 'Link zum Detailplan (Bild, optional)', value: a?.map_url },
    ],
    ok: 'Speichern',
  });
  if (!v) return;
  act(a ? { action: 'area_update', id: a.id, ...v } : { action: 'area_create', geometry, ...v }, 'Gespeichert.');
}

function openAdmin() {
  const sheet = $('#sheet');
  sheet.dataset.kind = 'admin';
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet-head"><h2>Verwalten</h2><button class="close" data-act="close" aria-label="Schliessen">×</button></div>
    <h3 class="sub">Kampagnen</h3>
    ${S.campaigns.map((c) => `<div class="camp" data-id="${c.id}">
        <b>${esc(c.name)}${c.archived ? ' <span class="hint">(abgeschlossen)</span>' : ''}</b>
        <button class="btn small" data-act="c-rename">Umbenennen</button>
        <button class="btn small" data-act="c-archive">${c.archived ? 'Wieder öffnen' : 'Abschliessen'}</button>
        <button class="btn small" data-act="c-reset">Leeren</button>
        <button class="btn small danger" data-act="c-remove">Löschen</button>
      </div>`).join('') || '<p class="hint">Noch keine Kampagne – lege die erste an.</p>'}
    <div class="actions"><button class="btn primary" data-act="c-new">Neue Kampagne starten</button></div>
    <h3 class="sub">Gebiete</h3>
    <p class="hint">Gebiete gelten für alle Kampagnen. Einzelne Gebiete bearbeitest du, indem du sie auf der Karte antippst.</p>
    <div class="actions two">
      <button class="btn" data-act="a-new">Gebiet einzeichnen</button>
      <button class="btn" data-act="a-import">GeoJSON importieren</button>
    </div>
    <h3 class="sub">Teilen &amp; Auswerten</h3>
    <div class="actions two">
      <button class="btn" data-act="invite">Einladungslink</button>
      <button class="btn" data-act="csv">Export (CSV)</button>
    </div>`;
}

const campOf = (btn) => S.campaigns.find((c) => c.id === Number(btn.closest('.camp').dataset.id));
const ADMIN = {
  async 'c-new'() {
    const v = await ask({ title: 'Neue Kampagne', text: 'Alle Gebiete starten als «frei». Laufende Kampagnen bleiben unverändert.', fields: [{ name: 'name', label: 'Name (z. B. «Abstimmung 9. Februar»)', required: true, maxlength: 60 }], ok: 'Starten' });
    if (v) act({ action: 'campaign_create', name: v.name }, 'Kampagne gestartet.');
  },
  async 'c-rename'(btn) {
    const c = campOf(btn);
    const v = await ask({ title: 'Kampagne umbenennen', fields: [{ name: 'name', label: 'Name', value: c.name, required: true, maxlength: 60 }], ok: 'Speichern' });
    if (v) act({ action: 'campaign_update', id: c.id, name: v.name, archived: c.archived });
  },
  'c-archive'(btn) {
    const c = campOf(btn);
    act({ action: 'campaign_update', id: c.id, name: c.name, archived: !c.archived }, c.archived ? 'Kampagne wieder geöffnet.' : 'Kampagne abgeschlossen – für Freiwillige ausgeblendet.');
  },
  async 'c-reset'(btn) {
    const c = campOf(btn);
    if (await ask({ title: `«${c.name}» leeren?`, text: 'Alle Gebiete dieser Kampagne werden wieder frei. Notizen bleiben erhalten.', ok: 'Alles freigeben' })) act({ action: 'campaign_reset', id: c.id }, 'Alle Gebiete sind wieder frei.');
  },
  async 'c-remove'(btn) {
    const c = campOf(btn);
    if (await ask({ title: `«${c.name}» löschen?`, text: 'Die Kampagne und ihr Verteilstand werden endgültig gelöscht. Gebiete und Notizen bleiben.', ok: 'Endgültig löschen' })) act({ action: 'campaign_remove', id: c.id });
  },
  'a-new'() { startDraw((geometry) => areaForm(null, geometry)); },
  'a-import'() {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.geojson,.json,application/geo+json,application/json' });
    input.onchange = async () => {
      try {
        const json = JSON.parse(await input.files[0].text());
        const feats = json.type === 'FeatureCollection' ? json.features : [json];
        const areas = feats.filter((f) => f?.geometry && ['Point', 'Polygon', 'MultiPolygon'].includes(f.geometry.type)).map((f) => {
          const p = f.properties || {};
          return { geometry: f.geometry, code: p.code || p.Code || p.kuerzel || '', name: p.name || p.Name || p.title || '', flyers: String(p.flyers ?? p.Flyer ?? ''), description: p.description || p.beschreibung || '', map_url: p.map_url || '' };
        });
        if (!areas.length) return toast('Keine Flächen oder Punkte in der Datei gefunden.');
        act({ action: 'area_import', areas }, `${areas.length} Gebiete importiert.`);
      } catch { toast('Die Datei ist kein gültiges GeoJSON.'); }
    };
    input.click();
  },
  async invite() {
    const v = await ask({
      title: 'Einladungslink',
      text: 'Mit dem Team-Passwort im Link müssen Freiwillige nur noch ihren Namen eingeben. Leer lassen für einen Link ohne Passwort.',
      fields: [{ name: 'pw', label: 'Team-Passwort (nicht das Admin-Passwort)' }], ok: 'Link kopieren',
    });
    if (!v) return;
    const link = `${location.origin}${location.pathname}${S.campaign ? '?k=' + S.campaign : ''}${v.pw ? '#pw=' + encodeURIComponent(v.pw) : ''}`;
    try { await navigator.clipboard.writeText(link); toast('Link kopiert.'); }
    catch { ask({ title: 'Link zum Kopieren', fields: [{ name: 'l', label: 'Link', value: link }], ok: 'Schliessen', cancel: '' }); }
  },
  csv() {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Kürzel', 'Gebiet', 'Flyer (Plan)', 'Status', 'Person', 'Übernommen', 'Verteilt', 'Flyer (verteilt)', 'Notizen']]
      .concat(S.areas.map((a) => [a.code, a.name, a.flyers, STATUS[a.status], a.person, a.claimed_at ? day(a.claimed_at) : '', a.done_at ? day(a.done_at) : '', a.distributed, a.comments.map((n) => `${n.author}: ${n.body}`).join(' | ')]));
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `flyer-${(currentCampaign()?.name || 'export').replace(/[^\wäöüÄÖÜ-]+/g, '_')}.csv` });
    link.click();
    URL.revokeObjectURL(link.href);
  },
};

/* ---------- Dialoge ---------- */
function ask({ title, text, fields = [], ok = 'OK', cancel = 'Abbrechen', error }) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    const attrs = (f) => `name="${f.name}" ${f.required ? 'required' : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} placeholder="${esc(f.placeholder || '')}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}`;
    modal.innerHTML = `<form class="dialog">
      <h2>${esc(title)}</h2>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${fields.map((f) => `<label class="field">${esc(f.label)}${f.type === 'textarea'
        ? `<textarea ${attrs(f)}>${esc(f.value || '')}</textarea>`
        : `<input type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="numeric" min="0"' : ''} ${attrs(f)} value="${esc(f.value || '')}">`}</label>`).join('')}
      <div class="actions${cancel ? ' two' : ''}">
        ${cancel ? `<button type="button" class="btn" data-cancel>${esc(cancel)}</button>` : ''}
        <button class="btn primary">${esc(ok)}</button>
      </div></form>`;
    modal.hidden = false;
    const form = modal.firstElementChild;
    (form.querySelector('input, textarea') || form.querySelector('.primary')).focus();
    const close = (value) => { modal.hidden = true; modal.innerHTML = ''; resolve(value); };
    form.onsubmit = (e) => { e.preventDefault(); close(Object.fromEntries(new FormData(form))); };
    if (cancel) form.querySelector('[data-cancel]').onclick = () => close(null);
  });
}

let loggingIn = false;
async function login(error) {
  if (loggingIn) return;
  loggingIn = true;
  const needPw = !S.pw;
  const v = await ask({
    title: needPw ? 'Willkommen!' : 'Dein Name',
    text: needPw
      ? 'Hier koordinieren wir, wer wo Flyer verteilt. Gib deinen Namen und das Team-Passwort ein – das brauchst du nur einmal.'
      : 'Unter diesem Namen sehen die anderen, welche Gebiete du übernommen hast. Vom Nachnamen bleibt nur der erste Buchstabe.',
    error,
    fields: [
      { name: 'name', label: 'Vorname und erster Buchstabe des Nachnamens', placeholder: 'z. B. Anna M.', value: S.name, required: true, maxlength: 40, autocomplete: 'name' },
      ...(needPw ? [{ name: 'pw', label: 'Team-Passwort', type: 'password', required: true, autocomplete: 'current-password' }] : []),
    ],
    ok: needPw ? 'Los geht’s' : 'Speichern',
    cancel: needPw || !S.name ? '' : 'Abbrechen',
  });
  loggingIn = false;
  if (!v) return;
  S.name = shortName(v.name); store.set('name', S.name);
  if (needPw) { S.pw = v.pw; store.set('pw', S.pw); load(); } else render();
}
async function needName() {
  if (!S.name) await login();
  return !!S.name;
}

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- Start ---------- */
function render() {
  renderHeader();
  renderMap();
  renderList();
  renderSheet();
}
map.on('click', () => { if (!S.drawing && $('#sheet').dataset.kind === 'area') closeSheet(); });

if (!S.pw || !S.name) login(); else load();
// Stand regelmässig nachladen, damit alle dieselbe Karte sehen.
setInterval(() => {
  if (!document.hidden && S.pw && !S.drawing && $('#modal').hidden) load(true);
}, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pw && !S.drawing && $('#modal').hidden) load(true); });
