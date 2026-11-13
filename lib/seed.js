// Startdaten: die 34 Verteilgebiete des bisherigen Tools (Kürzel, Name, Flyerzahl, Abgrenzung, Detailplan).
// Die Grenzen (lib/grenzen.js) folgen den Strassenachsen und überlappen sich nicht. Fehlt eine Grenze,
// startet das Gebiet als Punkt an ungefährer Lage (aus der alten Übersichtskarte geschätzt).
// Die Detailpläne liegen in public/karten/ (scripts/karten.js lädt fehlende von der alten Seite nach).
import { GRENZEN } from './grenzen.js';

export const KARTEN_QUELLE = 'https://www.ps-ps.ch/gruene-6-10/karten/';
const K = '/karten/';
const pos = (x, y) => ({
  type: 'Point',
  coordinates: [
    +(8.4770 + (x - 120) * 0.000111).toFixed(5),
    +(47.4145 - (y - 113) * 0.0000755).toFixed(5),
  ],
});

const RAW = [
  ['H1', 'Rütihof', '1200?', 120, 113, 'ruetihof.png', ''],
  ['H2', 'Riedhofstrasse', '1200?', 165, 178, 'riedhof.png', 'Riedhofstrasse zwischen Frankentalstrasse und Bombach (siehe Detailplan).'],
  ['H3', 'Limmattal', '', 228, 290, 'limmattal.png', 'Frankental sowie Limmattalstrasse beidseitig, bis zur Europabrücke und darunter hindurch bis zum Fluss.'],
  ['H4', 'Imbisbühlstrasse', '1000?', 195, 236, 'imbisbuehlstrasse.png', 'Imbisbühlstrasse und Riedhofstrasse, jeweils vom Bombach bis zum Meierhofplatz.'],
  ['H5', 'Segantinistrasse', '1000?', 255, 215, '', 'Rund um die Segantinistrasse. Genaue Abgrenzung noch nicht beschrieben.'],
  ['H6', 'Höngg Zentrum', '', 315, 245, 'h6-hoengg-zentrum.png', 'Oberhalb des Meierhofplatzes, genaue Lage gemäss Detailplan.'],
  ['H7', 'Am Wasser', '1000', 405, 353, 'h7-amwasser.png', 'Entlang der Limmat vom Fischerweg (Bahnviadukt) bis zur Europabrücke, hauptsächlich Am Wasser und Grossmannstrasse.'],
  ['H8', 'Ackersteinstrasse', '1000', 358, 325, 'h8-ackersteinstr.png', 'Ackersteinstrasse vom Meierhofplatz bis dort, wo sie in «Im Sydefädeli» übergeht, dazu der Bogen Bauherrenstrasse/Tobeleggstrasse.'],
  ['H9', 'Rebbergstrasse', '1000?', 403, 316, 'h9-rebbergstrasse.png', 'Ottenbergstrasse, Rebbergstrasse und Kettberg. Im Osten bis Rebbergsteig und Waidspital-Areal (dort beginnt Wipkingen), im Westen bis zur gewundenen Kürbergstrasse (nur einseitig).'],
  ['H10', 'Emil-Klöti-Strasse', '', 355, 274, 'h10-emil-kloeti.png', 'Unterhalb der Emil-Klöti-Strasse: nach Westen bis und mit Bläsistrasse (beidseitig), nach Osten bis Kürbergstrasse (nur einseitig). Talwärts bis Brunnwiesenstrasse, ohne die Häuser direkt an der Limmattalstrasse.'],
  ['W1', 'Waidspital', '1050', 492, 336, 'waidspital.png', 'Wipkingen unterhalb des Waidspitals, von der Waidstrasse (ohne diese) bis zum Rebbergsteig (nur einseitig). Im Süden bis Hönggerstrasse (nur oberhalb) bzw. Dorfstrasse (bis zur Waidstrasse, dann beidseitig).'],
  ['W2', 'Wipkingen GZ', '900?', 480, 374, 'gzwipkingen.png', 'Westlich der Rosengartenstrasse zwischen Limmat und Hönggerstrasse; beidseits des Wipkingerplatzes bis zur Dorfstrasse, ab dort nur unterhalb bis zum Rebbergsteig. Im Sydefädeli bis zur Namensänderung; Breitensteinstrasse vom GZ bis dort, wo sie direkt an die Limmat führt. Die flussnahen Gebäude zwischen GZ und Wipkingerplatz sind keine Wohnbauten und entfallen.'],
  ['W3', 'Waidstrasse', '1400', 532, 341, 'waidstrasse.png', 'Zwischen Rosengartenstrasse und Waidstrasse. Bergwärts bis Wibichstrasse, südlich bis Dorfstrasse und Wipkingerweg. Die Waidstrasse gehört bis zu ihrem Ende an der Hönggerstrasse dazu.'],
  ['W4', 'Rosengarten', '800', 567, 364, 'rosengartenstrasse.png', 'Beidseits der Nordstrasse von der Rosengartenbrücke bis zur Nordbrücke, darüber das Gebiet zwischen Rosengartenstrasse und Scheffelstrasse (beidseitig, ohne die Siedlung oberhalb des Bahneinschnitts). Zusätzlich das Dreieck Bucheggstrasse/Rosengartenstrasse/Rötelstrasse bis gegen den Bucheggplatz.'],
  ['W5', 'Rotbuchstrasse', '1050', 615, 372, 'rotbuchstrasse.png', 'Dreieck zwischen Rötelstrasse und Rotbuchstrasse (beide nur einseitig), bis und mit der Siedlung oberhalb des Bahneinschnitts.'],
  ['W6', 'Nordstrasse', '1300', 616, 421, 'nordstrasse.png', 'Nordstrasse beidseitig von der Kornhausstrasse bis zur Nordbrücke, dazu das angrenzende Gebiet bis Rotbuchstrasse und Kornhausstrasse (diese beiden nur einseitig).'],
  ['W7', 'Schule Letten', '1000', 616, 449, 'letten.png', 'Rousseaustrasse und Imfeldstrasse samt Umgebung. Im Norden bis Nordstrasse (gehört nicht dazu) und Wasserwerkstrasse, im Westen bis zum Bahndamm, im Osten bis zur Kornhausstrasse.'],
  ['W8', 'Röschibach', '1000-1200', 550, 405, 'roeschibachstrasse.png', 'Zwischen Rosengartenstrasse im Westen und Bahndamm, von der Limmat bis zur Nordstrasse (gehört nicht dazu).'],
  ['U1', 'Hofwiesenstrasse', '1200', 650, 352, 'hofwiesenstrasse.png', 'Beidseits der Hofwiesenstrasse zwischen Schaffhauserplatz und Bucheggplatz, von der Rötelstrasse im Südwesten (nur einseitig) bis zur Zeppelinstrasse im Nordosten (beidseitig).'],
  ['U2', 'Milchbuck', '500-600', 663, 327, 'u2-guggachstrasse.png', 'Dreieck zwischen Bucheggstrasse, Schaffhauserstrasse und Guggachstrasse. An der Guggachstrasse auch die Gebäude zwischen Strasse und Sportplatz (Seite Schulhaus Milchbuck). Dazu der Birkenhof und die Häuser zwischen Schulhaus Milchbuck und Schaffhauserstrasse, die nicht an der Zeppelinstrasse liegen.'],
  ['U3', 'Scheuchzerstrasse', '900', 692, 356, 'milchbuckstrasse.png', 'Südlich des Irchelparks, östlich der Schaffhauserstrasse. Im Osten bis Winterthurerstrasse (zwischen den Haltestellen Universität Irchel und Langmauerstrasse), südlich davon bis «Im Eisernen Zeit». Scheuchzerstrasse auf ganzer Länge beidseitig bis zur Riedtlistrasse. Die Häuser an der Hotzenstrasse gehören nicht dazu (PLZ 8006).'],
  ['U4', 'Buchegg', '550-750', 622, 297, 'bucheggplatz-gis.png', 'Dreieck Bucheggstrasse/Hofwiesenstrasse/Wehntalerstrasse sowie die Siedlung zwischen Hofwiesenstrasse und Käferberg.'],
  ['U5', 'Allenmoos', '1700', 674, 283, 'allenmoos.png', 'Hofwiesenstrasse beidseitig von der Kreuzung Wehntalerstrasse bis zum Badi-Eingang. Dazu das Rechteck zwischen Buchegg-/Schaffhauserstrasse, Allenmoosstrasse, Wehntalerstrasse und Langfuren (nur diese beidseitig). Die Ringstrasse gehört bereits ganz zum Kreis 11.'],
  ['U6', 'Wehntalerstrasse', '900-1000', 616, 222, 'wehntalerstrasse.png', 'Wehntalerstrasse beidseitig vom Knoten Hofwiesenstrasse Richtung Affoltern bis zum Knoten Maienstrasse/Maienweg, dazu die Birchstrasse bis zur Fussgängerpasserelle (ca. 200 Flyer) und das Dreieck Künzlistrasse/Kiefernweg/Hoffeld.'],
  ['U7', 'Irchel', 'ca. 250', 750, 387, 'irchelpark.png', 'Halbkreis um den Irchelpark: Winterthurerstrasse zwischen den Haltestellen Langmauerstrasse und Universität Irchel (nur einseitig), dann beidseitig Langensteinenstrasse und das Gebiet um die Frohburgstrasse zwischen Irchelpark und Waldrand, bis zur Abzweigung am Tierspital vorbei zur Tramhaltestelle Tierspital.'],
  ['O1', 'Zürichberg', '100', 800, 477, 'zuerichberg.png', 'Susenbergstrasse, Freudenbergstrasse und Restelbergstrasse, jeweils zwischen Germaniastrasse und Spyristeig. Liegt im Kreis 6, gehört aber nicht zur PLZ 8006.'],
  ['O2', 'Frohburgstrasse', '650', 765, 421, 'o2-frohburgstrasse.png', 'Frohburgstrasse vom Irchelpark bis zur Seilbahn Rigiblick. Auf der einen Seite bis Blümlisalpstrasse (beidseitig), auf der anderen bis zum Waldrand.'],
  ['O3', 'Letzistrasse', '700', 704, 395, 'o3-letzi.png', 'Rund um die Letzistrasse. Detailbeschreibung fehlt noch – siehe Detailplan.'],
  ['O4', 'Hutten', '800', 771, 502, 'o4-hutten.png', 'Dreieck zwischen Rigiplatz und den Spital- und Hochschulbauten. Im Westen entlang der Universitätsstrasse (nur einseitig), bergwärts die Gladbachstrasse (nur einseitig) bis Spyriplatz, dann die Spyristrasse hinunter (nur einseitig) bis Vogelsangstrasse/Hochstrasse. Ab Spyristrasse die Hochstrasse nur einseitig bis Schmelzbergstrasse.'],
  ['O5', 'Rigistrasse', '850', 762, 456, 'o5-rigistrasse.png', 'Die Seilbahn Rigiblick trennt das Gebiet von O2; die Rigistrasse führt mitten hindurch. Am höchsten Punkt (Übergang in die Hadlaubstrasse) beidseitig bis Spyristrasse/Spillmann-Weg. Spyristrasse abwärts bis Spyriplatz nur einseitig. Im Südwesten bis Gladbachstrasse, im Westen bis Universitätsstrasse (beide nur einseitig).'],
  ['S1', 'Pflugstrasse', '1300', 654, 431, 's1-pflugstrasse.png', 'Pflugstrasse zwischen Nordstrasse und Schaffhauserstrasse, südlich bis Schindlerstrasse (nur einseitig). Zusätzlich ab Schaffhauserplatz einmal um den Block mit Hotzenstrasse und Hotzensteig (3 Häuser). Alles Übrige gehört nicht dazu.'],
  ['S2', 'Krone', '900', 654, 481, 's2-krone.png', 'Nördlich von Stampfenbachstrasse und Nordstrasse, bis zur Schindlerstrasse im Norden.'],
  ['S3', 'Weinberg', '', 694, 475, 's3-weinberg.png', 'Zwischen Weinbergstrasse und Stampfenbachstrasse, vom Schulhaus Weinberg bis Haldenegg. Dazu die Turnerstrasse und alles zwischen Weinbergstrasse und Scheuchzerstrasse (ohne diese), von der Kinkelstrasse im Norden bis und mit Sonneggstrasse im Süden.'],
  ['S4', 'Scheuchzerstrasse Süd', '1550', 724, 502, 's4-scheuchzer.png', 'Im Westen Scheuchzerstrasse und Sonneggstrasse (beide beidseitig), im Osten Universitätsstrasse (nur einseitig), im Norden Riedtlistrasse (nur einseitig).'],
];

export const KARTEN = RAW.map((r) => r[5]).filter(Boolean);

export const SEED_AREAS = RAW.map(([code, name, flyers, x, y, map, description]) => ({
  code, name, flyers, description,
  map_url: map ? K + map : '',
  geometry: GRENZEN[code] || pos(x, y),
}));
