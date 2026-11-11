# Flyer-Tool Kreise 6 und 10

Koordiniert, wer in welchem Gebiet Flyer verteilt – mit Karte, mehreren parallelen Kampagnen und ohne Login-Hürde.

## Was es kann

- **Karte und Liste** aller Gebiete: pink = frei, gelb = vergeben, grün = verteilt
- **Kampagnen-Umschalter** oben: jede Kampagne hat ihren eigenen Verteilstand, die Gebiete bleiben dieselben
- **Für Freiwillige**: Link öffnen, Vorname + Team-Passwort (einmalig), Gebiet antippen, «Ich übernehme dieses Gebiet», später «Fertig verteilt»
- **Notizen pro Gebiet** bleiben über Kampagnen hinweg erhalten (z. B. «Briefkästen im Innenhof»)
- **Verwalten** (mit Admin-Passwort): Kampagnen anlegen/abschliessen/leeren, Gebiete bearbeiten, Flächen einzeichnen, GeoJSON importieren, CSV exportieren, Einladungslink erzeugen

## Deployment: GitHub → Vercel → Neon

1. Diesen Ordner als Repository auf GitHub pushen.
2. In Vercel **Add New → Project**, das Repo importieren. Framework-Preset «Other», keine Build-Einstellungen nötig.
3. Im Vercel-Projekt unter **Storage → Create Database → Neon** eine Datenbank anlegen und mit dem Projekt verbinden. Vercel setzt `DATABASE_URL` automatisch.
4. Unter **Settings → Environment Variables** setzen:
   - `TEAM_PASSWORD` – das Passwort für alle Freiwilligen
   - `ADMIN_PASSWORD` – dein Passwort für die Verwaltung (muss sich vom Team-Passwort unterscheiden)
5. **Redeploy** auslösen. Beim ersten Aufruf legt das Tool die Tabellen selbst an und spielt die 34 Gebiete ein.

## Lokal ausprobieren

```
npm install
npm run dev
```

Läuft auf http://localhost:3000 mit einer eingebetteten Datenbank in `./.localdb`. Passwörter lokal: Team `gruen`, Admin `admin`.

## Aufbau

| Datei | Zweck |
| --- | --- |
| `public/` | Oberfläche (HTML, CSS, JavaScript ohne Build-Schritt; Leaflet liegt in `public/vendor`) |
| `api/data.js` | Die einzige Server-Funktion: liefert den Stand und führt Aktionen aus |
| `lib/db.js` | Datenbankzugriff und Tabellenschema |
| `lib/seed.js` | Startdaten der 34 Gebiete |
| `dev.js` | Lokaler Entwicklungsserver |

## Gut zu wissen

- Die Gebiete starten als **Punkte an ungefährer Lage** (aus der alten Übersichtskarte geschätzt). Unter «Verwalten» bzw. im Gebiet → «Fläche einzeichnen» wird daraus eine genaue Fläche.
- Die **Detailpläne** liegen in `public/karten/`. Beim Build auf Vercel (und mit `npm run karten`) lädt `scripts/karten.js` alle fehlenden Bilder von `ps-ps.ch/gruene-6-10/karten/`. Am besten einmal `npm run karten` ausführen und die Bilder committen – dann ist das Tool von der alten Seite unabhängig. Fehlt ein Bild lokal, lädt die Oberfläche es ersatzweise direkt von der alten Seite.
- Das Team-Passwort schützt vor zufälligen Besuchern, ist aber kein Konto-System: Wer es kennt, kann Gebiete übernehmen und freigeben.
