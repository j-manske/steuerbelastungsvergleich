# Steuerbelastungsvergleich der Rechtsformen

Webbasiertes Tool zum mehrperiodigen steuerlichen Rechtsformvergleich (Seminararbeit,
Lehrstuhl für Betriebswirtschaftliche Steuerlehre, Universität Bayreuth).

Verglichen werden vier Ausprägungen:

1. Personengesellschaft (Regelbesteuerung)
2. Personengesellschaft mit Thesaurierungsbegünstigung nach § 34a EStG
3. GmbH
4. Optierende Gesellschaft nach § 1a KStG

Untersuchungsvariable ist der Gewerbesteuerhebesatz. Vergleichsmaßstab ist der Barwert
der Gesamtsteuerbelastung über den gewählten Betrachtungszeitraum.

## Aufbau

```
index.html          Oberfläche
styles.css
src/core/rates.js   Rechtsstandstabelle je Veranlagungszeitraum
src/core/tarif.js   Steuerliche Grundfunktionen (§ 32a EStG, SolZ, GewSt, § 35 EStG)
src/core/model.js   Periodenmodell der vier Ausprägungen, Sensitivität, Barwerte
src/ui/             Darstellung: Diagramme, Formatierung, Ereignisbehandlung
tests/              72 Kontrollfälle, davon 12 mit von Hand gerechnetem Sollwert
```

Berechnungskern (`src/core/`) und Oberfläche (`src/ui/`) sind strikt getrennt. Der Kern
ist zustandsfrei: `berechne(szenario)` liefert zu einer Eingabe ein vollständiges
Ergebnisobjekt einschließlich sämtlicher Zwischenschritte mit Normverweis.

## Betrieb

Das Tool besteht ausschließlich aus statischen Dateien. Es gibt **keinen Build-Schritt**,
keine Abhängigkeiten und keine Serverlogik — nur HTML, CSS und native ES-Module.

Wegen der ES-Module muss über HTTP ausgeliefert werden; ein Öffnen per `file://`
funktioniert nicht.

### Lokal

```
python3 -m http.server 8765
```

Dann `http://localhost:8765` aufrufen.

### Im Internet freischalten

Alle Dateien dieses Verzeichnisses in das Document Root hochladen — das war es. Konkret:

- **Statisches Hosting (Netlify, Vercel, Cloudflare Pages):** Ordner in die Weboberfläche
  ziehen oder Repository verbinden. Build-Befehl leer lassen, Publish-Verzeichnis `/`.
- **GitHub Pages:** Repository anlegen, Dateien pushen, in den Repository-Einstellungen
  unter *Pages* den Branch als Quelle wählen.
- **Eigener Server (nginx, Apache):** Verzeichnis nach `/var/www/steuertool` kopieren und
  als Document Root eines vHost eintragen. Keine PHP-, Node- oder Datenbankinstallation
  nötig.
- **Universitätsserver:** Upload per SFTP in das Webverzeichnis genügt.

Der Ordner `tests/` kann beim Deployment weggelassen werden; er schadet aber auch nicht
und dokumentiert die Prüfung der Berechnungslogik.

Es werden keine Daten übertragen oder gespeichert. Sämtliche Berechnungen laufen im
Browser des Nutzers, sodass keine datenschutzrechtlichen Anforderungen an den Server
entstehen.

## Kontrollrechnungen

`http://localhost:8765/tests/` aufrufen. Die Seite führt 72 Kontrollfälle aus und zeigt
je Fall Soll- und Istwert an. Erwartet wird `72/72 bestanden`.

Zwölf Fälle sind mit *Sollwert von Hand* markiert: ihr Erwartungswert ist als feste Zahl
vorgegeben und der Rechenweg im Quelltext vollständig ausgeschrieben. Die übrigen prüfen
Struktur- und Verhaltenseigenschaften (Linearität, Monotonie, Grenzen des
Anrechnungsvolumens, Übergang zum Mindesthebesatz).

Das Prüfszenario in `tests/tests.js` ist bewusst **nicht** aus `STANDARD_SZENARIO`
abgeleitet. Ein Kontrollfall, dessen Sollwert sich aus den Konstanten des Codes speist,
kann eine Änderung dieser Konstanten nicht aufdecken.

## Rechtsstand pflegen

Sämtliche zeitabhängigen Größen stehen ausschließlich in `src/core/rates.js`:

- `EST_TARIFE` — Tarifformel nach § 32a EStG und Freigrenze des Solidaritätszuschlags
  je Veranlagungszeitraum
- `RECHTSSTAND` — Körperschaftsteuersatz (§ 23 Abs. 1 KStG), Sondertarif nach § 34a EStG
  und gewerbesteuerlicher Mindesthebesatz (§ 16 Abs. 4 S. 2 GewStG) je VZ
- `KONSTANTEN` — Steuermesszahl, Freibetrag nach § 11 Abs. 1 S. 3 GewStG,
  Anrechnungsfaktor des § 35 EStG, Abgeltungsteuersatz, Nachversteuerungssatz

Eine Änderung des Rechtsstands erfordert damit keinen Eingriff in die Berechnungslogik.
Jahre außerhalb der hinterlegten Spanne werden mit dem Randjahr fortgeschrieben und in
der Tabelle „Rechtsstand je Veranlagungszeitraum" als solche gekennzeichnet.

> **Zu prüfen:** Die Tarifkonstanten für VZ 2026 und die Freigrenze des
> Solidaritätszuschlags (20.350 EUR) sollten vor der Veröffentlichung gegen den
> Gesetzestext abgeglichen werden.

## Basisszenario

Voreingestellt ist das Basisszenario aus Abschnitt 3.1 der Arbeit:

| Parameter | Wert |
| --- | --- |
| Gewinn vor Steuern und Tätigkeitsvergütung | 500.000 EUR |
| Tätigkeitsvergütung | 100.000 EUR |
| Entnahme- bzw. Ausschüttungsquote | 50 % |
| Kalkulationszinssatz | 3 % p.a. |
| Betrachtungszeitraum | VZ 2026–2032 (7 Perioden) |
| Gewerbesteuerhebesatz | 400 % |

Damit reproduziert die Startansicht die Zeile 400 % der Ergebnistabelle der Arbeit:
42,63 % (PersG Regel), 41,84 % (PersG § 34a) und 43,17 % (GmbH bzw. optierende
Gesellschaft), jeweils als Barwert der Gesamtsteuerbelastung in Prozent des Barwerts des
Gewinns vor Steuern.

## Modellannahmen

Die vollständige Annahmenübersicht ist im Tool über die Schaltfläche
„Methodik & Annahmen" abrufbar. Sie entspricht Tabelle 1 der Arbeit. Zentral:

- Gesellschafter: eine unbeschränkt steuerpflichtige natürliche Person, keine
  Kirchensteuer. Weitere tarifliche Einkünfte sind voreingestellt 0, über das Feld
  „Weitere tarifliche Einkünfte" aber als Sockelbetrag zuschaltbar (siehe unten)
- Hinzurechnungen und Kürzungen (§§ 8, 9 GewStG) bleiben außer Betracht
- Tätigkeitsvergütung in allen Ausprägungen betragsgleich und fremdüblich; der Verzicht
  auf eine Vergütung dient als Kontrollrechnung
- Ausschüttungen unterliegen im Grundfall der Abgeltungsteuer; kein Sparer-Pauschbetrag.
  Teileinkünfteverfahren (§ 32d Abs. 2 Nr. 3 EStG) und Günstigerprüfung (§ 32d Abs. 6
  EStG) sind als Modellvarianten zuschaltbar, in der Voreinstellung aber aus
- In der Schlussperiode vollständige Entnahme bzw. Ausschüttung samt Nachversteuerung
  nach § 34a Abs. 4 EStG
- Thesauriertes Vermögen wird nicht verzinst; die Zeitwirkung wird allein über den
  Kalkulationszinssatz abgebildet. Erträge aus der Wiederanlage thesaurierter Mittel
  bildet das Modell nicht ab
- Die Entnahme- bzw. Ausschüttungsquote bezieht sich bei der Personengesellschaft auf
  den Gewinn vor Einkommensteuer, bei den Kapitalgesellschaften auf den Jahresüberschuss
  nach Körperschaft- und Gewerbesteuer; die zufließenden Beträge sind daher bei gleicher
  Quote nicht identisch

Über die Schaltflächen unter „Modellvarianten" lassen sich einzelne Annahmen umschalten,
etwa die Einbeziehung des Sondertarifs nach § 34a EStG in den Ermäßigungshöchstbetrag des
§ 35 EStG oder die Ausschüttungsfiktion des § 1a Abs. 3 S. 5 KStG.

### Die Nachsteuer gehört nicht in den Ermäßigungshöchstbetrag

Die Option betrifft allein die Steuer auf den begünstigten Gewinn nach § 34a **Abs. 1**
EStG. Die Nachsteuer des § 34a **Abs. 4** EStG bleibt in beiden Stellungen außer Ansatz.
Das ist eine bewusste Entscheidung und keine Vereinfachung:

- **Wortlaut.** § 35 Abs. 1 S. 1 EStG ermäßigt die tarifliche Steuer nur, „soweit sie
  anteilig auf im zu versteuernden Einkommen enthaltene gewerbliche Einkünfte entfällt".
  Der Nachversteuerungsbetrag ist keine Einkunft und nicht Teil des zvE; § 34a Abs. 4 S. 2
  EStG unterwirft ihn einem eigenen Satz von 25 %.
- **Systematik.** Er steht damit weder in der „Summe der positiven gewerblichen
  Einkünfte" noch in der „Summe aller positiven Einkünfte" des § 35 Abs. 1 S. 2 EStG.
  Eine Steuer in den Multiplikator aufzunehmen, deren Bemessungsgrundlage in der Quote
  fehlt, hebt gerade die Proportionalität auf, die die Vorschrift herstellen soll. Die
  Parallele ist die Abgeltungsteuer: auch sie bleibt außen vor, und § 35 Abs. 1 S. 4 EStG
  nennt mit § 32d Abs. 6 S. 2 EStG nur den Fall, in dem die Kapitalerträge in das zvE
  zurückkehren.
- **Periodenbezug.** § 35 Abs. 1 S. 1 Nr. 1 EStG knüpft an den Messbetrag des dem
  Veranlagungszeitraum entsprechenden Erhebungszeitraums. Die Nachsteuer trifft Gewinne
  früherer Jahre, deren Messbeträge dort bereits ihr eigenes Anrechnungsvolumen erzeugt
  haben. Ihre Einbeziehung eröffnete einen periodenübergreifenden Transfer, den § 35 EStG
  mit dem Verbot des Vor- und Rücktrags gerade ausschließt.

Die Frage ist nicht akademisch. Im Basisszenario bleibt sie ohne Wirkung, weil der
Höchstbetrag dort nicht bindet. Bindet er aber — volle Thesaurierung, Sondertarif außer
Ansatz, Gewinn 300.000 EUR, h = 300 % —, dann stünde einer Nachsteuer von 210.588,75 EUR
ein Höchstbetrag von 0 EUR gegenüber: die Anrechnung kippt vollständig, die
Gesamtbelastung springt um 28.927,50 EUR von 144.954,03 auf 173.881,53 EUR. Der
Kontrollfall „§ 34a Abs. 4 EStG: die Nachsteuer erhöht den Ermäßigungshöchstbetrag nicht"
fixiert das.

Zwei Varianten betreffen die Besteuerung der Ausschüttung beim Gesellschafter und wirken
daher nur auf GmbH und optierende Gesellschaft:

- **Teileinkünfteverfahren** (§ 32d Abs. 2 Nr. 3 EStG): 60 % der Ausschüttung gehen in das
  zu versteuernde Einkommen ein, 40 % bleiben nach § 3 Nr. 40 Buchst. d EStG steuerfrei.
  Vorteilhaft erst unterhalb eines Grenzsteuersatzes von 41,67 %, weil 60 % davon gerade
  25 % ergeben. Im Basisszenario ist der Antrag nachteilig.
- **Günstigerprüfung** (§ 32d Abs. 6 EStG): die Ausschüttung wird in voller Höhe dem zu
  versteuernden Einkommen hinzugerechnet, wenn das zu einer niedrigeren Steuer führt.
  Maßstab ist der *Durchschnitts*-, nicht der Grenzsteuersatz auf die Ausschüttung, und
  die Vergleichsgröße beträgt 26,375 % — nicht 25 %, weil der Solidaritätszuschlag auf
  die Kapitalertragsteuer pauschal ohne Freigrenze erhoben wird, auf die veranlagte
  Einkommensteuer dagegen mit Freigrenze und Milderungszone (§ 4 SolZG). Praktisch
  greift der Antrag nur, solange die übrigen Einkünfte unter rund 24.750 EUR liegen.

Beide verdrängen den gesonderten Tarif; der Solidaritätszuschlag folgt dann § 4 SolZG mit
Freigrenze und Milderungszone statt der pauschalen Erhebung auf die Kapitalertragsteuer.
Da § 32d Abs. 6 EStG nur Erträge erfasst, die dem gesonderten Tarif unterliegen, sperrt
ein beantragtes Teileinkünfteverfahren die Günstigerprüfung.

### Weitere tarifliche Einkünfte (Sockelbetrag)

Tabelle 2 der Arbeit unterstellt einen Gesellschafter ohne weitere Einkünfte. Diese
Annahme ist nicht neutral: der Grenzsteuersatz des § 32a EStG hängt am gesamten zu
versteuernden Einkommen, nicht am Gewinn allein. Das Feld erlaubt es, die Annahme
aufzuheben, ohne den Vergleichsmaßstab zu verändern.

Die weiteren Einkünfte *W* wirken ausschließlich als Sockel. In jede Tarifberechnung geht
*W + X* ein, zugerechnet wird aber nur die Differenz `ESt(W + X) − ESt(W)`, entsprechend
beim Solidaritätszuschlag. Verglichen wird damit weiterhin allein die Belastung des
Betriebsergebnisses; Nenner der Effektivbelastung bleibt der Gewinn. Bei *W* = 0 ändert
sich kein einziger Wert — die 27 veröffentlichten Werte der Ergebnistabelle sind durch
Kontrollfälle als unverändert abgesichert.

Zwei Wirkungen sind zu beachten:

- Der Ermäßigungshöchstbetrag des § 35 EStG wird nach § 35 Abs. 1 S. 2 EStG auf den
  Anteil der gewerblichen Einkünfte an der Summe der Einkünfte gekürzt. Ohne weitere
  Einkünfte beträgt der Quotient 1; mit Sockel sinkt er. Weil wegen der Progression
  stets `ESt(W) ≤ ESt(W + G) · W/(W + G)` gilt, kann die zugerechnete Steuer durch die
  Anrechnung nie negativ werden.
- Der Sockel belastet die Personengesellschaft stärker als die Kapitalgesellschaften:
  bei transparenter Besteuerung schlägt der höhere Grenzsteuersatz auf den gesamten
  Gewinn durch, bei GmbH und optierender Gesellschaft nur auf die Tätigkeitsvergütung,
  während die Ausschüttung dem festen Satz des § 32d Abs. 1 EStG unterliegt. Der
  Sondertarif des § 34a Abs. 1 EStG und die Nachversteuerung nach § 34a Abs. 4 EStG
  bleiben vom Sockel unberührt, da beide feste Sätze sind.

Für die Wahlrechte des § 32d EStG ist der Sockel die eigentlich maßgebliche Größe: er
entscheidet darüber, ob Teileinkünfteverfahren oder Günstigerprüfung überhaupt greifen
können.

### Der Knick bei 400 % und das Vorteilsfenster

Die Steuerermäßigung des § 35 EStG beträgt das Vierfache des Messbetrags, höchstens aber
die tatsächlich gezahlte Gewerbesteuer (§ 35 Abs. 1 S. 5 EStG). Beide Größen sind bei
einem Hebesatz von 400 % gleich groß, denn aus `4 · M = M · h/100` folgt `h = 400`. Der
Messbetrag kürzt sich heraus — die Grenze liegt **unabhängig von Gewinn, Freibetrag und
Tätigkeitsvergütung** stets bei genau 400 %. Das ist keine Eigenheit des Basisszenarios,
sondern eine Eigenschaft des Gesetzes; ein Kontrollfall sichert es über mehrere Gewinn-
und Vergütungsstufen ab.

Daraus folgen zwei völlig verschiedene Hebesatzbereiche:

| Bereich | bindende Grenze | Steigung je 100 Hebesatzpunkte |
| --- | --- | --- |
| unter 400 % | gezahlte Gewerbesteuer (§ 35 Abs. 1 S. 5 EStG) | `− 0,055 · Messbetrag` |
| über 400 % | Anrechnungsvolumen 4 × Messbetrag | `+ Messbetrag` |

Unterhalb von 400 % zehrt die Anrechnung die Gewerbesteuer vollständig auf; übrig bleibt
allein der Solidaritätszuschlag auf die geminderte Einkommensteuer, weshalb die Belastung
sogar leicht *fällt*. Oberhalb von 400 % ist die Anrechnung eingefroren, und jeder
weitere Hebesatzpunkt schlägt ungemindert durch. Im Basisszenario sind das −0,18
gegenüber +3,33 Prozentpunkten je 100 Punkte — bei der Kapitalgesellschaft dagegen
durchgehend +2,09, ohne Knick.

Weil eine geknickte Kurve eine Gerade zweimal schneidet, ist der Vorteil der
Personengesellschaft **kein Schwellenwert, sondern ein Fenster**: im Basisszenario ist
die Regelbesteuerung nur zwischen rund 376 % und 444 % günstiger als die GmbH, der
Sondertarif des § 34a EStG zwischen rund 341 % und 507 %. Unterhalb des Fensters trägt
die Kapitalgesellschaft die niedrigere Belastung, oberhalb schlägt die nicht angerechnete
Gewerbesteuer durch. Das Fenster verengt sich mit steigender Thesaurierung; bei
vollständiger Thesaurierung ist die Regelbesteuerung im gesamten untersuchten Bereich
nicht mehr vorteilhaft.

Das Ermittlungsschema weist zwei Überhänge aus, weil sie Verschiedenes bedeuten:

- **nicht angerechnete Gewerbesteuer** — gezahlte Gewerbesteuer, die keine Ermäßigung
  ausgelöst hat und damit endgültige Belastung bleibt (gezahlte Gewerbesteuer ./.
  Ermäßigung). Oberhalb von 400 % trägt dieser Posten den gesamten Hebesatzeffekt der
  Personengesellschaft: im Vergleich 400 % gegen 500 % steigt die Gesamtbelastung um
  exakt den Betrag, der hier zusätzlich erscheint.
- **nachrichtlich: ungenutztes Anrechnungsvolumen (verfällt)** — der Teil des Vierfachen
  des Messbetrags, der leerläuft und weder vor- noch rücktragbar ist (Anrechnungsvolumen
  ./. Ermäßigung).

Die zwei Posten sind **nicht disjunkt und dürfen nicht addiert werden**. Hinter ihnen
stehen drei Ursachen, die die Arbeit unterscheidet:

| Ursache | Norm | tritt auf |
| --- | --- | --- |
| Anrechnungsvolumen ohne dahinterstehende Gewerbesteuer | § 35 Abs. 1 S. 5 EStG | nur unter 400 % |
| Gewerbesteuer über 4 × Messbetrag | § 35 Abs. 1 S. 1 Nr. 1 EStG | nur über 400 % |
| vom Ermäßigungshöchstbetrag blockiert | § 35 Abs. 1 S. 2 EStG | hebesatzunabhängig |

Nur die ersten beiden schließen einander aus. Die dritte ist von ihnen unabhängig und
zählt zu **beiden** Posten gleichzeitig — sie ist zugleich ungenutztes Volumen und
endgültig bleibende Gewerbesteuer. Praktisch relevant wird das, wenn die Steuer nach
§ 34a Abs. 1 EStG nicht in den Höchstbetrag einbezogen wird: dann bleibt auch bei einem
Hebesatz von 280 % Gewerbesteuer endgültig. Die Hinweise unter dem Schema benennen
deshalb jede bindende Ursache einzeln mit Betrag.

## Bedienung

- **Gewerbesteuerhebesatz** ist die Untersuchungsvariable; das Sensitivitätsdiagramm
  zeigt den Verlauf von 280 % bis 600 % (Abschnitt 2.3 der Arbeit: gesetzliche
  Untergrenze nach § 16 Abs. 4 S. 2 GewStG bis zum oberen Rand des Gemeindebereichs) und
  markiert den eingestellten Wert. Das Zahlenfeld lässt darüber hinausgehende Werte zu;
  die Diagrammspanne wird dann entsprechend erweitert. Zusätzlich markiert das Diagramm
  den Knickpunkt des § 35 EStG bei 400 %, die Rangwechsel als Punkte und das
  Vorteilsfenster als hinterlegten Bereich.
- **Zweiten Hebesatz vergleichen** stellt dem eingestellten Hebesatz einen zweiten
  gegenüber — etwa zwei Gemeinden bei sonst gleichem Szenario. Der Hebesatzvergleich
  weist je Ausprägung Barwert, Effektivbelastung, die Differenz in EUR und
  Prozentpunkten sowie die mittlere Steigung je 100 Hebesatzpunkte aus und meldet einen
  Rangfolgenwechsel. Betragsgleiche Ausprägungen erhalten denselben Rang, damit die
  Sortierreihenfolge keinen Wechsel vortäuscht. Liegt der Knick bei 400 % zwischen den
  beiden Werten, ist die ausgewiesene Steigung ein Mischwert; darauf wird hingewiesen.
  Das Ermittlungsschema zeigt dann beide Hebesätze nebeneinander mit Differenzspalte.
- **Weitere tarifliche Einkünfte** kalibrieren den Grenzsteuersatz des Gesellschafters.
  Die auf sie selbst entfallende Steuer wird herausgerechnet; voreingestellt sind 0 EUR,
  sodass die Startansicht unverändert die Werte der Arbeit zeigt.
- **Entnahme- bzw. Ausschüttungsquote** gibt den laufend entnommenen Anteil an; der Rest
  wird thesauriert. Voreingestellt sind 50 %, also hälftige Entnahme und hälftige
  Thesaurierung.
- **Betrachtungsdauer** wird in Jahren angegeben, der letzte VZ ergibt sich daraus.
  Voreingestellt sind sieben Perioden ab 2026, also genau der Zeitraum, für den ein
  verabschiedeter Rechtsstand vorliegt. Über die Schnellwahl sind 1, 5, 7, 10 und 15
  Jahre erreichbar, im Eingabefeld sind 1 bis 30 Jahre möglich. Reicht der Zeitraum über
  2032 hinaus, weist ein Hinweis auf den fortgeschriebenen Rechtsstand hin.
- **Ermittlungsschema im Detail** zeigt für jede Ausprägung und jeden VZ sämtliche
  Zwischenschritte mit Normverweis.
- **CSV-Export** gibt die Periodenübersicht im deutschen Zahlenformat aus.
