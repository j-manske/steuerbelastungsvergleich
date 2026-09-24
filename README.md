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
tests/              41 Kontrollfälle, davon 7 mit von Hand gerechnetem Sollwert
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

`http://localhost:8765/tests/` aufrufen. Die Seite führt 41 Kontrollfälle aus und zeigt
je Fall Soll- und Istwert an. Erwartet wird `41/41 bestanden`.

Sieben Fälle sind mit *Sollwert von Hand* markiert: ihr Erwartungswert ist als feste Zahl
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

- Gesellschafter: eine unbeschränkt steuerpflichtige natürliche Person, keine weiteren
  Einkünfte, keine Kirchensteuer
- Hinzurechnungen und Kürzungen (§§ 8, 9 GewStG) bleiben außer Betracht
- Tätigkeitsvergütung in allen Ausprägungen betragsgleich und fremdüblich; der Verzicht
  auf eine Vergütung dient als Kontrollrechnung
- Ausschüttungen unterliegen der Abgeltungsteuer; kein Teileinkünfteverfahren, keine
  Günstigerprüfung, kein Sparer-Pauschbetrag
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

## Bedienung

- **Gewerbesteuerhebesatz** ist die Untersuchungsvariable; das Sensitivitätsdiagramm
  zeigt den Verlauf von 280 % bis 600 % (Abschnitt 2.3 der Arbeit: gesetzliche
  Untergrenze nach § 16 Abs. 4 S. 2 GewStG bis zum oberen Rand des Gemeindebereichs) und
  markiert den eingestellten Wert. Das Zahlenfeld lässt darüber hinausgehende Werte zu;
  die Diagrammspanne wird dann entsprechend erweitert.
- **Entnahme- bzw. Ausschüttungsquote** gibt den laufend entnommenen Anteil an; der Rest
  wird thesauriert. Voreingestellt sind 0 % (Vollthesaurierung).
- **Betrachtungsdauer** wird in Jahren angegeben, der letzte VZ ergibt sich daraus.
  Voreingestellt sind sieben Perioden ab 2026, also genau der Zeitraum, für den ein
  verabschiedeter Rechtsstand vorliegt. Über die Schnellwahl sind 1, 5, 7, 10 und 15
  Jahre erreichbar, im Eingabefeld sind 1 bis 30 Jahre möglich. Reicht der Zeitraum über
  2032 hinaus, weist ein Hinweis auf den fortgeschriebenen Rechtsstand hin.
- **Ermittlungsschema im Detail** zeigt für jede Ausprägung und jeden VZ sämtliche
  Zwischenschritte mit Normverweis.
- **CSV-Export** gibt die Periodenübersicht im deutschen Zahlenformat aus.
