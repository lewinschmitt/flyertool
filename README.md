# Flyer-Tool Kreise 6 und 10

Koordiniert, wer in welchem Gebiet Flyer verteilt – mit Karte, mehreren parallelen Kampagnen und ohne Login-Hürde.

## Was es kann

- **Karte und Liste** aller Gebiete: pink = frei, gelb = vergeben, grün = verteilt
- **Filter «Nur freie Gebiete»** auf Karte und Liste: hebt hervor, was noch niemand übernommen hat; alles andere tritt in den Hintergrund
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
| `lib/altnotizen.js` | Kommentare aus dem bisherigen Tool, werden einmalig als Notizen eingespielt |
| `lib/grenzen.js` | Grenzen der Gebiete als GeoJSON-Flächen |
| `public/karten/` | Detailpläne der Gebiete (PNG) |
| `dev.js` | Lokaler Entwicklungsserver |

## Gut zu wissen

- Die **Grenzen** der Gebiete sind als Flächen auf der Karte eingezeichnet (`lib/grenzen.js`). Sie stammen aus den eingefärbten Flächen der Detailpläne und wurden anhand der Gebäude auf OpenStreetMap eingepasst (Genauigkeit wenige Meter). Benachbarte Gebiete können sich an gemeinsamen Strassen leicht überlappen – so wie in den Plänen. Korrekturen: Gebiet antippen → «Fläche neu zeichnen».
- **H5 Segantinistrasse** hat keinen Detailplan und ist deshalb nur ein Punkt an ungefährer Lage. Unter «Fläche einzeichnen» wird daraus eine Fläche.
- Bestehende Datenbanken erhalten die Grenzen beim nächsten Aufruf automatisch – aber nur für Gebiete, die noch ein Punkt sind. Selbst gezeichnete Flächen bleiben unverändert.
- Die **Detailpläne** (33 PNG-Bilder) liegen in `public/karten/` und gehören zum Repository; das Tool ist damit von der alten Seite unabhängig. `npm run karten` lädt nur noch fehlende Bilder von `ps-ps.ch/gruene-6-10/karten/` nach.
- **Schutz vor Passwort-Raten**: Nach 10 falschen Passwörtern innert 15 Minuten wird der Absender (IP-Adresse) gesperrt, bis die Fehlversuche aus dem Zeitfenster gefallen sind – auch für das richtige Passwort. Die Werte stehen oben in `api/data.js` (`MAX_FAILURES`, `WINDOW_MIN`). Wer hinter derselben Adresse sitzt (z. B. gemeinsames WLAN), ist mitgesperrt. Gegen Angriffe von sehr vielen Adressen hilft nur ein langes Passwort.
- Das Team-Passwort schützt vor zufälligen Besuchern, ist aber kein Konto-System: Wer es kennt, kann Gebiete übernehmen und freigeben.
