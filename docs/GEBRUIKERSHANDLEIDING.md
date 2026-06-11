# Gebruikershandleiding

> Deze handleiding legt uit hoe de app werkt, wat de getallen betekenen en hoe je er bruikbare resultaten uit haalt. Voor de rekenmodellen en aannames achter de schermen, zie [MODEL_DOCUMENTATION.md](./MODEL_DOCUMENTATION.md).

## Inhoud

- Wat doet deze app?
- Snel beginnen
- Stap 1 — Verbruiksdata importeren
- Stap 2 — Tarieven instellen
- Stap 3 — Hardware (optioneel)
- De resultaten lezen
- De grafieken
- Veelgestelde vragen
- Tips
- Problemen oplossen

---

## Wat doet deze app?

De app vergelijkt twee soorten elektriciteitscontracten voor jouw woning, op basis van je eigen verbruik van het afgelopen jaar.

**Vast contract.** Een vaste prijs per kWh (piek en dal), een maandelijks vastrecht, een teruglevertarief voor je zonnestroom en eventuele vaste terugleverkosten (VTK).

**Dynamisch contract.** De prijs volgt elk uur de stroombeurs (EPEX). Doorgaans goedkoop 's nachts en duur in de avondpiek rond 18:00 uur, en soms zelfs negatief. Aantrekkelijk als je flexibel bent met laden en verwarmen.

De app berekent voor beide contracten je jaarlijkse energiekosten, het verschil tussen de twee, en het effect van zonnepanelen, een thuisbatterij, een elektrische auto en een warmtepomp — uitgesplitst per dag, week en maand.

Alles draait lokaal in je browser. Je verbruiksdata verlaat je computer niet: geen account, geen cloud.

---

## Snel beginnen

1. Importeer je verbruiksdata (Home Assistant of een CSV-bestand).
2. Vul je huidige tarieven in, of kies een leverancier als startpunt.
3. Lees de besparingskaart: groen betekent dat dynamisch goedkoper uitvalt, oranje dat vast goedkoper is.

Wil je hardware meenemen, ga dan naar Stap 3 en vink een elektrische auto, batterij of warmtepomp aan. Reken op vier tot vijf minuten voor een volledige analyse.

---

## Stap 1 — Verbruiksdata importeren

### Optie A: Home Assistant (aanbevolen)

Heb je je P1-meter in Home Assistant, dan is dit de snelste route. Je haalt in één keer jaren aan historie op.

1. Klik op **Home Assistant koppelen**.
2. Vul je HA-URL in (`http://192.168.1.x:8123` of je eigen domein).
3. Plak een Long-Lived Access Token uit je HA-profiel.
4. Kies je import-, export- en zonnepaneelsensoren.
5. Klik op **Gegevens ophalen**.

Loopt het vast?

- **Mixed Content-melding.** Je HA draait op `http://` terwijl de app op `https://` staat. Browsers blokkeren dat. Zet HA op HTTPS, of gebruik de handmatige export (optie B).
- **Geen reactie of time-out.** Controleer de URL en het token, en of je op hetzelfde netwerk zit.

### Optie B: CSV-export

Exporteer je verbruik handmatig uit Home Assistant of je meter. De app herkent drie formaten:

- Home Assistant lange CSV (`entity_id, state, last_changed`)
- Home Assistant brede CSV (een kolom per sensor)
- Eigen CSV (je wijst zelf aan welke kolom wat is)

1. Klik op **Bestand uploaden**.
2. Sleep je CSV erin, of klik om te kiezen.
3. De app detecteert de kolommen en toont een koppelscherm.
4. Controleer de toewijzing (import = afname, export = teruglevering) en bevestig.

Let op de eenheid: kWh werkt het best, maar Wh wordt automatisch omgerekend. Hoe meer data, hoe nauwkeuriger — een heel jaar is ideaal, twee à drie maanden is het minimum. Ontbrekende uren vult de app aan met je eigen seizoenspatroon.

### Optie C: demo-data

Zonder eigen data laadt de app bij het eerste bezoek een realistisch Nederlands voorbeeldhuishouden (circa 3200 kWh verbruik en 3600 kWh zon per jaar). Handig om rond te kijken, maar het zijn niet jouw cijfers — importeer in Stap 1 je eigen data voor een echte vergelijking.

### Data-kwaliteitsbanner

Na het laden verschijnt een korte banner over de kwaliteit van je data:

- **Groen** — alle uren gemeten.
- **Geel** — kleine hiaten (geïnterpoleerd) of een seizoensschatting voor ontbrekende maanden.
- **Rood** — grote hiaten (meer dan zes uur) opgevuld met een gemiddeld dagprofiel.

Geel en rood zijn meestal prima; de schatting blijft realistisch zolang het grootste deel van het jaar gemeten is.

---

## Stap 2 — Tarieven instellen

### Vast contract

Vul de tarieven van je huidige of beoogde contract in. Je vindt ze op je jaarafrekening of op de site van je leverancier.

| Veld | Voorbeeld | Betekenis |
|------|-----------|-----------|
| Piektarief | €0,27/kWh | Afname tussen 08:00 en 23:00 uur |
| Daltarief | €0,24/kWh | Afname tussen 23:00 en 08:00 uur |
| Teruglevertarief | €0,07/kWh | Vergoeding voor teruggeleverde zonnestroom |
| Terugleverkosten (VTK) | €0,00/kWh | Eventuele kosten voor teruglevering (vaak €0,00–€0,05) |
| Vastrecht | €7,50/maand | Vast maandbedrag |

Met **Leverancier kiezen** vul je in één klik indicatieve tarieven van bekende leveranciers in. Beschouw die als startpunt en controleer je eigen contract.

### Dynamisch contract

| Veld | Voorbeeld | Betekenis |
|------|-----------|-----------|
| Inkoop-opslag | €0,024/kWh | Opslag bovenop de EPEX-prijs (incl. btw) |
| Teruglever-opslag | €0,020/kWh | Opslag op de terugleververgoeding (incl. btw) |
| Vastrecht | €6,00/maand | Vast maandbedrag |

De energiebelasting stel je in met de schuif rechtsboven. De app haalt die waar mogelijk op bij Frank Energie; lukt dat niet, dan geldt de 2026-waarde (ongeveer €0,111/kWh) als terugval. Het tarief voor 2027 is nog niet vastgesteld — pas de schuif aan zodra dat bekend is.

Dynamische opslagbedragen verschillen per leverancier (Frank Energie, easyEnergy, Tibber en anderen) en kunnen per maand wijzigen. De app rekent met één jaargemiddelde.

---

## Stap 3 — Hardware (optioneel)

Heb je elektrische apparatuur, of overweeg je die, vink het dan aan om het effect op je rekening te zien.

### Elektrische auto

| Invoer | Toelichting |
|--------|-------------|
| Wekelijkse afstand | Aantal kilometer per week |
| Verbruik | kWh per 100 km (richtwaarde 15–22) |
| Zonne-match | Aandeel dat je uit eigen zon laadt (0–100%) |
| Beschikbaarheid | Thuis (altijd) of forens (overdag op het werk) |

De app plant het laden: eerst uit eigen zonoverschot, dan in de goedkoopste uren van het net, en het vermijdt de dure avondpiek. Op een vast contract komt een auto er meestal als extra verbruik bij; op dynamisch valt dat met slim laden flink lager uit.

### Thuisbatterij

| Invoer | Toelichting |
|--------|-------------|
| Capaciteit | Opslag in kWh (bijv. 10 kWh) |
| Vermogen | Laad-/ontlaadsnelheid in kW (bijv. 5 kW) |
| Rendement | Verlies bij laden/ontladen (90% is gangbaar) |
| Modus | Hoe de batterij beslist (zie hieronder) |

De batterij kent drie strategieën:

- **Zelf — maximaal zelfverbruik.** Sla zonnestroom op voor 's avonds en gebruik die zelf. Geen handel met het net. Eenvoudig en voorspelbaar.
- **Kosten — kostenbewust.** Naast zon laadt de batterij ook in de goedkoopste neturen, maar nooit meer dan je de volgende dag zelf verbruikt. Geen teruglevering.
- **Winst — maximale winst.** Zoals kosten, plus verkopen bij hoge prijzen. Theoretisch de hoogste opbrengst, maar de marges zijn onzeker en hangen sterk af van de prijsschommelingen.

De terugverdientijd staat boven in Stap 3. Voor een batterij van 10 kWh is tien tot vijftien jaar gangbaar, afhankelijk van prijs en energietarieven. Reken eventuele subsidies van gemeente of provincie er zelf bij; die zitten niet in de app.

### Warmtepomp

Vul in hoeveel kWh je warmtepomp op een koude winterdag verbruikt (bijvoorbeeld 20 kWh). De app verdeelt dat over het jaar met een Nederlands klimaatprofiel (graaddagen, normaal De Bilt): veel in de winter, weinig in de zomer (alleen warm water).

Een warmtepomp verhoogt je verbruik fors. Op een dynamisch contract of in combinatie met een batterij valt dat het gunstigst uit, omdat je dan in de goedkopere uren kunt verwarmen.

### Zonnepanelen dimmen

Alleen relevant bij negatieve EPEX-prijzen: momenten waarop er zoveel aanbod is dat je geld toe krijgt om af te nemen. Je teruglevering levert dan niets op of kost zelfs geld. Je hebt drie keuzes:

- **Niets doen** — altijd alles terugleveren.
- **Dimmen** — de omvormer regelt terug: geen teruglevering, je huis blijft wel draaien.
- **Uitschakelen** — de omvormer volledig uit; je huis trekt alles van het net.

In de praktijk gaat het om enkele uren per jaar en is het effect klein.

---

## De resultaten lezen

### Besparingskaart

Het belangrijkste getal staat groot bovenaan:

- **Groen** — dynamisch is goedkoper; het bedrag is je jaarlijkse besparing.
- **Oranje** — vast is goedkoper; het bedrag zijn je jaarlijkse meerkosten.

Daaronder zie je het verschil in procenten en het gekozen fiscale scenario: 2026 (met saldering) of 2027 (zonder saldering).

### Detailtabel — vast contract

| Regel | Betekenis |
|-------|-----------|
| Piekafname | Verbruik 08:00–23:00 uur × piektarief |
| Dalafname | Verbruik 23:00–08:00 uur × daltarief |
| Teruglevering | Teruggeleverde kWh × teruglevertarief (aftrek) |
| Terugleverkosten | Eventuele VTK |
| Vastrecht | 12 × het maandbedrag |
| Subtotaal | Vóór korting en netbeheer |
| Heffingskorting energiebelasting | Vermindering per aansluiting (circa −€629 in 2026) |
| Netbeheerkosten | Transport en distributie (circa €480 per jaar) |
| Totaal | Je jaarrekening |

### Detailtabel — dynamisch contract

| Regel | Betekenis |
|-------|-----------|
| Afname | Totale import × gemiddelde EPEX-prijs plus opslag |
| Teruglevering | Totale export × gemiddelde EPEX-prijs min opslag (aftrek) |
| Energiebelasting | Belaste afname × energiebelasting per kWh |
| Vastrecht | 12 × het maandbedrag |
| Heffingskorting energiebelasting | Vermindering per aansluiting (circa −€629 in 2026) |
| Netbeheerkosten | Transport en distributie (circa €480 per jaar) |
| Totaal | Je jaarrekening |

Heffingskorting en netbeheerkosten zijn voor beide contracten gelijk. Ze veranderen het verschil tussen vast en dynamisch dus niet, maar geven wel een realistischer jaartotaal.

---

## De grafieken

### 24-uurs verbruiksprofiel en spotprijs

De bovenste grafiek toont een gemiddelde dag:

- **Blauwe lijn** — gemiddeld verbruik per uur.
- **Groene lijn** — gemiddelde teruglevering per uur (zonnepanelen).
- **Gele stippellijn** — EPEX-spotprijs per uur.

Je herkent doorgaans een zonnepiek rond het middaguur en een verbruiks- en prijspiek in de avond rond 18:00 uur.

### Gedetailleerde analyse — dag, week, maand

Drie staafgrafieken naast elkaar. Kies linksboven tussen dag, week en maand. Per periode staat een blauwe staaf (vast) naast een groene staaf (dynamisch), zodat je ziet welk contract wanneer voordeliger is. De maandweergave laat het seizoenspatroon zien: winters zijn duurder.

### Hardware-effecten

Per onderdeel zie je de jaarimpact: batterij, elektrische auto, warmtepomp en zonnepanelen. Een besparing kleurt groen, meerkosten kleuren oranje of rood. De cumulatieve balk telt alles bij elkaar op.

### Sankey-diagram (geavanceerde weergave)

Een stroomdiagram van je energie: links de bronnen (zon en net), in het midden de verbruikers (huis, batterij, auto, warmtepomp) en rechts wat terug naar het net gaat. De dikte van de stromen geeft de hoeveelheid energie weer.

---

## Veelgestelde vragen

**Waarom wijkt de app af van mijn jaarrekening?**
Meestal door een andere periode, een tariefwijziging halverwege het jaar, of de seizoenscorrectie waarmee de app korte meetperiodes naar een vol jaar schaalt. Deel je werkelijke factuurbedrag door de gemeten periode en vergelijk dat met het jaartotaal van de app.

**Mijn leverancier staat niet in de keuzelijst.**
Kies de dichtstbijzijnde en pas de tarieven daarna handmatig aan met de cijfers van je jaarafrekening.

**De app zegt dynamisch, een ander zegt vast. Wie heeft gelijk?**
Beide kunnen kloppen — het hangt van je profiel af. Veel verbruik 's nachts pakt gunstig uit op dynamisch; veel dagverbruik met zonnepanelen leunt naar vast. De app rekent met jóuw data.

**Kan de app de kosten voor volgend jaar voorspellen?**
Nee. Het is een vergelijking onder de aanname dat verbruik en prijzen gelijk blijven. Energieprijzen schommelen sterk; gebruik de app jaarlijks opnieuw met actuele data.

**Hoe betrouwbaar is een prognose met maar drie maanden data?**
Redelijk, maar met een slag om de arm. Ontbrekende maanden vult de app met een gemiddeld profiel van vergelijkbare maanden. Met zes maanden of meer wordt de seizoensdekking duidelijk beter.

**Waarom staan er soms negatieve prijzen in de grafiek?**
Dat gebeurt echt op EPEX: bij veel wind- en zonaanbod en weinig vraag wordt de prijs negatief. Het is zeldzaam (een paar procent van de uren) en wordt voor de volledigheid getoond.

**Is de app open source?**
Ja. De broncode staat op [GitHub](https://github.com/cyleo/P1_dynamisch_vast_vergelijk). De demo-data valt onder CC-BY (attributie in de repo).

---

## Tips

- Laad bij voorkeur minimaal zes maanden data, liefst een heel jaar, voor goede seizoensdekking.
- Controleer je tarieven op je jaarafrekening in plaats van uit het hoofd; de leverancierskeuze is slechts een richtlijn.
- Vul hardware realistisch in: werkelijke kilometers, echte batterijcapaciteit, het winterverbruik van je warmtepomp.
- Hover over de (i)-icoontjes voor uitleg per veld; de uitleg-panelen geven meer detail.
- Speel met scenario's — verschuif bijvoorbeeld de batterijcapaciteit en zie het effect direct.

**Op een dynamisch contract** loont slim sturen: laad de auto en de batterij in de goedkope nachturen en verwarm zoveel mogelijk buiten de avondpiek. Dat scheelt fors ten opzichte van ongestuurd laden.

**Op een vast contract** maakt het moment van verbruik niet uit. Een batterij helpt vooral voor zelfverbruik; verder loont besparen (isolatie, ledverlichting) meer dan slim sturen.

---

## Problemen oplossen

**Ik zie alleen demo-data, niet mijn eigen data.**
Importeer je bestand opnieuw via Stap 1 en bevestig het koppelscherm. Helpt dat niet, doe dan een harde refresh (Ctrl+Shift+R) om een verouderde cache te omzeilen. Blijft het misgaan, kijk dan in de browserconsole (F12) naar rode foutmeldingen.

**De Home Assistant-verbinding werkt niet.**
Controleer de URL en het token (een Long-Lived Access Token uit je HA-profiel). Een app op HTTPS kan geen HA op HTTP bereiken (Mixed Content); zet HA op HTTPS of gebruik de handmatige export.

**De CSV-import mislukt of herkent kolommen verkeerd.**
Zorg dat de eerste regel kolomnamen bevat en dat er geen lege regels onderaan staan. Komma en puntkomma worden allebei herkend. In het koppelscherm corrigeer je zelf welke kolom welke rol heeft.

**De banner meldt veel hiaten of schatting.**
Dat is meestal normaal: een sensor die even uitviel, de zomer-/wintertijdwissel of een meterherstart. Zolang minder dan circa 40% van het jaar geschat is, blijft het resultaat bruikbaar.

**De energiebelastingschuif lijkt vast te staan.**
De waarde wordt automatisch opgehaald; offline geldt de 2026-terugval. Je kunt hem altijd handmatig aanpassen door op de schuif te klikken — dat is ook nodig zodra het 2027-tarief bekend is.

**De app ziet mijn zonnepanelen niet.**
Controleer of je een zonnesensor in Home Assistant hebt en of die in de statistieken staat (recorder ingeschakeld). Bij een CSV-import wijs je in het koppelscherm aan welke kolom de zonopbrengst is.

**De besparing lijkt te hoog of te laag.**
Veelvoorkomende oorzaken: piek- en daltarief verwisseld, VTK of leveranciersopslag vergeten, of het vastrecht verkeerd ingevuld. Vergelijk het jaartotaal van de app met je werkelijke afrekening minus de heffingskorting en de netbeheerkosten.

---

Live app: [energie.vulpini.nl](https://energie.vulpini.nl) · Referenties: [EPEX-marktdata](https://www.epexspot.com/en/market-data), [Frank Energie](https://frankenergie.nl), [Home Assistant](https://www.home-assistant.io)
