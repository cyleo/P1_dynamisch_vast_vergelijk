# P1 Energie Contract Analysator — Gebruikershandleiding

> **Voor wie?** Dit document is voor iedereen die wil weten hoe deze app werkt, wat de getallen betekenen, en hoe je de beste resultaten krijgt. Voor technische details, zie [MODEL_DOCUMENTATION.md](./MODEL_DOCUMENTATION.md).

---

## Inhoudsopgave

1. [Wat doet deze app?](#wat-doet-deze-app)
2. [Hoe begin je?](#hoe-begin-je)
3. [Stap 1: Je verbruiksdata importeren](#stap-1-je-verbruiksdata-importeren)
4. [Stap 2: Je huidige tarieven instellen](#stap-2-je-huidige-tarieven-instellen)
5. [Stap 3: Hardware-opstellingen (optioneel)](#stap-3-hardware-opstellingen-optioneel)
6. [De resultaten begrijpen](#de-resultaten-begrijpen)
7. [Grafieken uitgelegd](#grafieken-uitgelegd)
8. [Veelgestelde vragen](#veelgestelde-vragen)
9. [Tips en best practices](#tips-en-best-practices)
10. [Problemen oplossen](#problemen-oplossen)

---

## Wat doet deze app?

Deze app vergelijkt **twee soorten elektriciteitscontracten** voor je woning, gebaseerd op jouw **echte verbruiksgegevens** van het afgelopen jaar:

### 1. **Vaste contract** (Standaard abonnement)
- Vaste prijs per kWh (piektarief + daltarief)
- Vastrecht (maandelijks basisbedrag)
- Teruglevertarief (wat je krijgt voor zonnepanelen die je teruggeeft)
- Vaste terugleverkost (VTK)

### 2. **Dynamisch contract** (Variabel abonnement)
- Prijs volgt de beurs (EPEX markt) elk uur
- Goedkoop in de nacht, duur rond 18:00u
- Soms zelfs negatief (je krijgt geld om te verbruiken!)
- Ideaal als je flexibel bent met laden/laden

### Wat berekent de app?
✅ Je totale jaarlijkse energiekosten voor beide contracten  
✅ Besparing (of meerkosten) bij overstap  
✅ Effect van zonnepanelen, slimme accu, elektrische auto, warmtepomp  
✅ Meer-/minderwaarde per dag, week en maand  

### Belangrijk: Geen data verzonden
🔒 **Alles gebeurt in jouw browser.** Jouw verbruiksdata verlaat je computer nooit. Geen accounts, geen cloud, geen privacy-problemen.

---

## Hoe begin je?

### Snelle start (3 stappen)
1. **Stap 1**: Upload je verbruiksdata (Home Assistant of CSV-bestand)
2. **Stap 2**: Vul je huidige tarieven in (of kies een leverancier)
3. **Lees de resultaten**: Groene badge = dynamisch beter, rode badge = vast beter

### Met geavanceerde opstellingen (4–5 minuten)
1. Stap 1 + 2 (zie boven)
2. **Stap 3**: Vink hardware aan (elektrische auto, accu, warmtepomp)
3. Stel in hoeveel je ervan hebt en hoe je het gebruikt
4. Kijk naar de besparing per opstelling

---

## Stap 1: Je verbruiksdata importeren

### Optie A: Home Assistant (Aanbevolen)
Home Assistant is een populair open-source thuisautomatiserings-platform. Veel mensen hebben al een P1-meter-integratie hiermee.

**Voordelen:**
- Directe verbinding, geen handmatig export
- Jaren aan historische data (niet alleen laatste maand)
- Automatische sensor-herkenning

**Hoe:**
1. Klik op **"Home Assistant koppelen"** (Stap 1)
2. Voer je HA-URL in (`http://192.168.1.x:8123` of je domein)
3. Voer je Long-Lived Access Token in (uit HA-instellingen)
4. Selecteer je import-, export- en zonnepaneel-sensoren
5. Klik **"Gegevens ophalen"**

**Problemen?**
- **"Mixed Content" waarschuwing**: Je HA draait op `http://` maar de app op `https://`. Dit is beveiligd en werkt niet. Oplossing: Gebruik manuele export (Optie B) of zet HA op HTTPS.
- **HA reageert niet / timeout**: Controleer je URL en token; zorg dat je toestemming hebt op het netwerk.

### Optie B: Manuele CSV-export
Exporteer je eigen verbruiksdata handmatig uit Home Assistant of je meter.

**Formaten die werken:**
- Home Assistant lange CSV (`entity_id, state, last_changed`)
- Home Assistant brede CSV (kolommen per sensor)
- Custom CSV (jij selecteert welke kolom wat is)

**Hoe:**
1. Klik op **"Bestand uploaden"** (Stap 1)
2. Sleep je CSV hiernaartoe (of klik om te selecteren)
3. De app detecteert kolommen automatisch
4. Controleer de mapping (import = afname, export = teruglevering) en klik **"Importeren"**

**Tips:**
- **Eenheid**: Zorg dat je data in `kWh` is (niet `Wh`). De app converteert automatisch als nodig.
- **Bereik**: Hoe meer gegevens, hoe nauwkeuriger. Minstens 2–3 maanden ideaal, liever een heel jaar.
- **Gaten**: Als je data hiaten heeft, vult de app die automatisch in met je eigen seizoenspatroon.

### Optie C: Demo-data gebruiken
Geen eigen data beschikbaar? Geen probleem.

Bij je eerste bezoek laadt de app automatisch **voorbeeld-data**: een realistisch Nederlands huishouden (3200 kWh verbruik, 3600 kWh zon per jaar). Dit geeft je meteen inzicht hoe de app werkt.

⚠️ **Herinner jezelf**: Dit zijn **niet jouw gegevens**. Upload je eigen data in Stap 1 voor je echte situatie.

### Data-kwaliteitsbanner
Nadat je data geladen is, zie je een banner:
- 🟢 **Groen**: Alle uren gemeten
- 🟡 **Geel**: Kleine hiaten (interpolatie) of seizoensschatting
- 🔴 **Rood**: Grote hiaten (> 6 uur) gevuld met gemiddelde

Dit is normaal en accuraat. Geen actie nodig.

---

## Stap 2: Je huidige tarieven instellen

### Vaste contract
Vul je huidige tarieven in uit je jaarrekening:

| Veld | Voorbeeld | Wat betekent het |
|------|-----------|------------------|
| **Piektarief** | €0,27/kWh | Wat je betaalt voor stroom 08:00–23:00u |
| **Daltarief** | €0,24/kWh | Wat je betaalt voor stroom 23:00–08:00u |
| **Teruglevertarief** | €0,07/kWh | Wat je krijgt als je zonne-energie teruggeeft |
| **Terugleverkost (VTK)** | €0,00/kWh | Extra kosten voor teruglevering (meestal €0,00–€0,05) |
| **Vastrecht** | €7,50/maand | Je vaste maandelijks bedrag |

**Waar vind je deze?**
- Je jaarrekening (of maandelijkse factuur)
- Website van je leverancier
- Contact met je leverancier

**Leverancier-snelkeuze:**
Klik op "Leverancier kiezen" voor indicatieve tarieven van Vattenfall, Eneco, GreenChoice, enz. Dit zijn **grove richtlijnen**—controleer je echte contract voor nauwkeurigheid.

### Dynamisch contract
| Veld | Voorbeeld | Wat betekent het |
|------|-----------|------------------|
| **Inkoop-opslag** | €0,024/kWh | Bovenop EPEX-prijs die je betaalt |
| **Teruglever-opslag** | €0,020/kWh | Bovenop wat je voor teruglevering krijgt |
| **Vastrecht** | €6,00/maand | Vaste maandelijkse kosten |

**Energiebelasting (EB)**:
- Glijdende schuif rechtsboven
- Dit wordt automatisch opgehaald van Frank Energie (je leverancier)
- Falls offline: gebruikt de 2026-waarde (~€0,111/kWh) als fallback
- **2027 waarde nog onbekend** bij de regering → schuif aanpassen als je weet wat het wordt

### Waar krijg je dynamische tarieven?
- Frank Energie, easyEnergy, Stroomversnellers
- Controleer hun website voor actuele opslag-bedragen
- Opslag kan per maand veranderen; deze app gebruikt een jaargemiddelde

---

## Stap 3: Hardware-opstellingen (Optioneel)

Heb je (of overweeg je) elektrische apparatuur? Laat het weten en zie het effect op je kosten.

### Elektrische auto (EV)

**Wat vul je in?**
- **Wekelijkse afstand**: Hoeveel km rij je per week? (bijv. 100 km)
- **Verbruik**: Hoeveel kWh per 100 km? (bijv. Tesla: 15–18, Opel Corsa-E: 20–22)
- **Zonne-match**: Hoeveel procent laden van je eigen zonnepanelen? (0–100%)
- **Beschikbaarheid**: Thuis (altijd beschikbaar) of forenzen (werktijd niet thuis)?

**Hoe werkt het?**
De app plant intelligente laadtijden:
1. Eerst je zonnepanelen gebruiken (goedkoop, duurzaam)
2. Dan de goedkoopste uren van het net (als dynamisch contract)
3. Voorkomen: dure piektijden, hele nacht laden (inefficiënt)

**Effect op kosten:**
- Vast: Meestal +€200–400/jaar (extra verbruik)
- Dynamisch: Veel lager als je slim laadt (€100–200/jaar)

### Thuisbatterij (Accu)

**Wat vul je in?**
- **Capaciteit**: Hoeveel kWh kan de accu opslaan? (bijv. 10 kWh)
- **Vermogen**: Hoe snel kan ie laden/ontladen? (bijv. 5 kW)
- **Rendement**: Hoeveel energie gaat verloren? (default 90%, goed)
- **Modus**: Hoe wil je dat ie werkt?

**Drie accu-modus's:**

#### 1. **Zelf** — Maximaal zelfverbruik (Standaard)
- Sla zonne-energie op voor 's avonds
- Gebruik het zelf; niet terugleveren
- **Voordeel**: Veilig, geen complexiteit
- **Besparing**: Vast: +€100–300/jaar; Dynamisch: +€50–150/jaar

#### 2. **Kosten** — Kostenbewust
- Sla zon op + koop de goedkoopste uren van het net
- Sla niet meer op dan je morgen nodig hebt
- Lever niet terug (alleen zelfverbruik)
- **Voordeel**: Balans tussen besparing en eenvoud
- **Besparing**: Dynamisch: +€200–500/jaar

#### 3. **Winst** — Maximale winst
- Sla zon + goedkope uren op
- Verkoop terug als het duur is (hoge prijs → marge)
- Risico: Lastig om geld te verdienen met extreme spreads
- **Voordeel**: Maximale besparing (theoretisch)
- **Besparing**: Dynamisch: +€300–700/jaar (afhankelijk van prijsvolatiliteit)

**Wanneer loont een accu?**
- Terugverdientijd: De app berekent dit (bovenaan Stap 3)
- Typisch: 10–15 jaar voor 10 kWh (afhankelijk van kosten, energieprijzen)
- Subsidies?: Controleer je gemeente/provincie (niet in app, maar relevant!)

### Warmtepomp

**Wat vul je in?**
- **Wintervermogen**: Hoeveel kWh verbruikt je warmtepomp op een koude winterdag? (bijv. 20 kWh)
  
**Hoe werkt het?**
- Winter (koud): Veel stroom (verwarmingsseizoen)
- Zomer (warm): Weinig stroom (alleen warm water)
- App berekent maandelijk met Nederlands klimaat (graaddagen, De Bilt normaal)

**Effect:**
- Vast: +€600–1200/jaar (extra verbruik)
- Dynamisch: Goedkoper als je 's nachts kunt verwarmen (stapelwerk)
- Met accu: Veel goedkoper (kun je goedkope uren laden)

**Tip**: Een warmtepomp loont vooral op dynamische contracten of met een accu.

### Zonnepanelen — Dimmen/Uitschakelen

**Alleen relevant als je negatieve EPEX-prijzen hebt** (rare momenten).

Soms is de stroomprijs **negatief** (te veel aanbod, geen vraag). Dan krijg je geld om te verbruiken. Jouw zonnepanelen blokkeren dit.

**Drie opties:**
1. **Niets doen** (default): Alles exporteren, alle uren
2. **Dimmen**: Omvormer regelt automatisch af (geen export, huisverbruik wel)
3. **Uitschakelen**: Omvormer helemaal uit (huisverbruik van het net)

**Effect**: Slechts enkele uren per jaar (meestal niet relevant).

---

## De resultaten begrijpen

### Besparingen-kaart (Grote rode/groene badge)

Dit is het belangrijkste getal:
- 🟢 **GROEN**: Dynamisch is goedkoper (besparing €XX per jaar)
- 🔴 **ROOD**: Vast is goedkoper (extra kosten €XX per jaar)

**Wat je verder ziet:**
- **Percentage**: Hoeveel procent goedkoper/duurder
- **Scenario**: 2026 (saldering) of 2027 (geen saldering)

### Detailtabel: Vast contract

| Regel | Wat betekent het |
|-------|------------------|
| **Piekafname** | Verbruik 08:00–23:00u × piektarief |
| **Dalafname** | Verbruik 23:00–08:00u × daltarief |
| **Teruglevering** | Jouw teruggeleverde kWh × terulevtarief (AFTREK) |
| **Terugleverkost** | Extra kosten voor teruglevering |
| **Vastrecht** | 12 × je maandelijks bedrag |
| **Totaal voor energiebelastingkorting** | Subtotaal |
| **Energiebelastingkorting** | Teruggave van de regering (−€629/jaar in 2026) |
| **Netbeheerkosten** | Kosten voor het distributienetwerk (±€480/jaar) |
| **TOTAAL** | Je jaarlijkse factuur |

### Detailtabel: Dynamisch contract

| Regel | Wat betekent het |
|-------|------------------|
| **Afname** | Totale import × gemiddelde EPEX-prijs + opslag |
| **Teruglevering** | Totale export × gemiddelde EPEX-prijs − opslag (AFTREK) |
| **Energiebelasting** | Alle import × energiebelasting (€/kWh) |
| **Vastrecht** | 12 × je maandelijks bedrag |
| **Energiebelastingkorting** | Teruggave (−€629/jaar) |
| **Netbeheerkosten** | Distributienetwerk (±€480/jaar) |
| **TOTAAL** | Je jaarlijkse factuur |

---

## Grafieken uitgelegd

### 1. **24-uurs Gemiddeld Energieprofiel & Spotprijs**
Bovenste grafiek (donkerblauw + groen + geel).

- **Blauwe lijn**: Hoeveel stroom je gemiddeld per uur verbruikt
- **Groene lijn**: Hoeveel je gemiddeld per uur teruggeeft (zonnepanelen)
- **Gele stippellijn**: EPEX-prijs per uur (spot-markt)
- **Waar kijken naar**:
  - Piek rond 18:00u (ochtend-spits bij werken)
  - Zonne-piek 12:00u (middag)
  - Prijs 18:00–23:00u duur (vraag hoog)

### 2. **Gedetailleerde Analyse — Dag/Week/Maand**
Tweede rij: drie staafgrafieken naast elkaar.

Kies links bovenaan "Dag", "Week" of "Maand":

**Per Dag:**
- Blauwe staaf = Vast contract kosten die dag
- Groene staaf = Dynamisch contract kosten die dag
- Rood/groen pictogram = Welke beter is

**Per Week:**
- Iso-weeknummering (week 1–52)
- Zelfde vergelijking, brede staafpatroon

**Per Maand:**
- Januari–december
- Overzicht jaarlijks patroon (winter duurder)

### 3. **Hardware-effecten**
Derde graafiek: gekleurde blokjes per apparat.

Elke hardware-installatie toont zijn/haar impact:
- 🔋 **Accu**: Groene besparing (rood = duurder)
- 🚗 **EV**: Roze besparing (afhankelijk van laadstrategie)
- 🔥 **Warmtepomp**: Oranje extra verbruik
- ☀️ **Zonnepanelen**: Geel besparing (tegen beide contracten)

**Cumulatief**: Alle effecten tezamen (veel beter dan individueel).

### 4. **Geavanceerd: Sankey-diagram**
(Geavanceerde modus, overzicht aanpassen)

Energiestroom visualisatie:
- Links: Zon + Net
- Midden: Huis, Accu, EV, Warmtepomp (allemaal verbonden)
- Rechts: Accu, Net (teruglevering)

Dikte lijnen = hoeveelheid energie. Dit geeft je inzicht hoe jouw energie beweegt.

---

## Veelgestelde vragen

### "Waarom zijn er verschillen tussen mijn rekening en wat de app zegt?"

**Mogelijke redenen:**
1. **Andere periode**: App rekent jaarlijks; je facturatie kan halfjaarlijks zijn
2. **Tariefwijziging midyear**: Leverancier verhoogde prijzen; app gebruikt één tarief heel jaar
3. **Seizoenscorrectie**: App annualiseert korte data-periodes
4. **Vastrecht**: App telt volledige jaar; je facturatie kan gedeeltelijk jaar zijn
5. **Energiebelasting**: 2027 is nog onbekend; app gebruikt 2026-proxy

**Oplossing**: Verdeel je werkelijke factuurbedrag door je data-periode en vergelijk.

### "Mijn vaste contract zit niet in de leveranciers-menu"

Kies de dichtstbijzijnde, of voer handmatig in:
- Bel je leverancier voor exacte tarieven
- Controleer je jaarrekening
- Voer in: piek/dal/vastrecht/VTK

### "De app zegt dynamisch is goedkoper, maar mijn vrienden zeggen vast?"

Ieder huishouden is anders:
- **Veel 's nachts thuis**? Dynamisch wint (goedkoop nachtverbruik)
- **Veel dagverbruik** (werk thuis, zonnepanelen)? Vast wint (stabiel)
- **Veel elektrische apparaten** (EV, WP)? Hangt af van laadstrategie

De app rekent **jouw profiel**. Gebruik demo-data om ook vrienden-profielen te testen.

### "Kan de app voorspellen wat het gaat kosten volgende jaar?"

Nee. Energieprijzen veranderen. De app laat zien: "**Als volgende jaar dezelfde prijzen en verbruik zijn**."

Realiteit:
- Energieprijzen fluctueren wildly (oorlog, weer, seizoen)
- Jouw verbruik verandert (nieuw apparaat, gedrag, winter vs zomer)
- Tariefen worden aangepast (leverancier)

**Tip**: Gebruik de app jaarlijks opnieuw met actuele gegevens.

### "Hoe nauwkeurig is de prognose als ik maar 3 maanden data heb?"

Redelijk, met voorbehoud:
- App vuilt gaten in met je eigen seizoenspatroon
- Voor maanden zonder data: gemiddeld profiel (mediaan van soortgelijke maanden)
- **Foutmarge**: ±10–15% voor gaten, ±5% voor berekening

**Aanbeveling**: Wacht tot je 6+ maanden data hebt (betere seizoensdekking).

### "Waarom toont de app soms negatieve prijzen in het schema?"

Dit gebeurt echt op EPEX:
- Te veel wind/zonne-aanbod op de markt
- Niet genoeg vraag
- Netbeheerder betaalt jou om stroom af te nemen (negatieve prijs)

**Zeldzaam** (~3% van de uren in Nederland). App toont het voor volledigheid.

### "Is dit open source?"

Ja! GitHub: https://github.com/cyleo/P1_dynamisch_vast_vergelijk

Je mag het kopiëren, aanpassen, en zelf draaien. Attributie (CC-BY) voor demo-data.

---

## Tips en best practices

### Voor het Beste Resultaat

1. **Laad minstens 6 maanden data** (hoe meer, hoe beter)
   - Seizoensverschillen (winter duurder)
   - Typisch 1-jaar data is ideaal

2. **Controleer je leverancier-tarieven** (niet op geheugen afgaan)
   - Jaarrekening checken
   - Website leverancier
   - Snelkeuze is slechts richtlijn

3. **Vul hardware realistisch in**
   - Echte maandelijkse afstanden (niet "wishful thinking")
   - Werkelijke accu-capaciteit (niet marketing-getal)
   - Wintervermogen WP (niet zomer-waarde)

4. **Lees de tooltips** 
   - Elk veld heeft een (i)-icoontje
   - Uitleg-panelen geven detail

5. **Probeer scenario's**
   - "Wat als ik 10 kWh accu zou hebben?"
   - Schuif het vermogen, zie het effect live

### Voor Dynamische Contracten (Slim Laden)

- **EV laden 's nachts** (goedkoopste uren)
- **Accu opslaan** rond 23:00–08:00u
- **Warmtepomp**: Voorkeur nacht-opwarming + overdag-afgifte
- **Zonnepanelen**: Sla over op accu, niet direct teruggeven

**Effect**: Tot **50% besparing** op dynamisch vs ongecontroleerd laden.

### Voor Vaste Contracten

- **Gedrag minder belangrijk** (tarief vast)
- **Zonnepanelen**: Elke kWh teruggeleverd geeft dezelfde credit
- **Accu**: Voor zelfverbruik (avondgebruik)
- **Elektrische apparaten**: Kosten evenveel dag/nacht

**Aanbeveling**: Met vaste tarief, "slimme" hardware helpt minder. Bespaar liever elektriciteit (isolatie, LED, etc.).

### Herfreshment

- **Maandelijks**: Check je werkelijk verbruik vs. verwacht
- **Jaarlijks**: Herimporteer je data, controleer tariefen
- **Bij groot gedrag/hardware-wijziging**: Run de app opnieuw

---

## Problemen oplossen

### "Ik zie alleen demo-data, niet mijn eigen data"

**Stap 1: Herimporteer jouw bestand**
1. Scroll naar Stap 1 ("Bestand uploaden" of "Home Assistant")
2. Upload je CSV of verbind met HA opnieuw
3. Klik "Importeren" / "Gegevens ophalen"

**Stap 2: Refresh browser**
- Druk F5 of Ctrl+Shift+R (harde refresh)
- Cache kan oude data vasthouden

**Stap 3: Check browser console**
- Druk F12, ga naar "Console" tab
- Zoek rode foutmeldingen (copy/paste in een issue)

### "Home Assistant-verbinding werkt niet"

**Controleer:**
- ✅ Je HA-URL klopt (`http://192.168...` of je domein)
- ✅ Je token is geldig (Long-Lived Access Token uit HA → Settings → Developer Tools)
- ✅ HTTPS-siteuatie: HTTPS-app kan geen HTTP-HA bereiken (Mixed Content blok)
  - Oplossing: Zet HA op HTTPS, of exporteer handmatig (Optie B)

### "CSV uploaden mislukt / kolommen verkeerd herkend"

**Check je CSV:**
- ✅ Eerste rij = kolomnamen (bijv. `timestamp, entity_id, state`)
- ✅ Geen lege rijen onderaan
- ✅ Scheidingsteken: komma of puntkomma (app detecteert beide)
- ✅ Datumformat: ISO (`2024-01-15T12:30:00`) of `DD-MM-YYYY`

**Handmatig toewijzen:**
- Upload sowieso: app toont mapping-scherm
- Controleer/corrigeer kolom-rollen
- Klik "Bevestigen"

### "Data-kwaliteitsbanner zegt veel gaten/geschat"

Dit is normaal. Oorzaken:
- **HA-sensor kapot**: Vervangen door seizoensgemiddelde
- **DST-spanning**: 1 uur weg (lente) / erbij (herfst)
- **Meter-herstart**: Waarde teruggezet; gap tussen meting

**Geen probleem als**:
- Minder dan 40% van je jaar geschat
- Grote gaten (> 1 week) niet in winter (verwarmingseizoen critiek)

### "Waarom is de EB-schuif grijzaals? Kan ik niet aanpassen?"

De waarde wordt auto-opgehaald van Frank Energie (je leverancier).
- Offline → Gebruikt 2026-fallback
- 2027 is nog onbekend (regering beslist)
- Je mag handmatig aanpassen door op de schuif te klikken

### "De app ziet de zonnepanelen niet"

**Controle:**
1. Heb je een zonnepaneel-sensor in Home Assistant?
   - Bijv. `sensor.inverter_energy_production`
2. Staat ie in je HA-statistieken (recorder ingeschakeld)?
3. Eenheid: kWh of Wh? (App converteert beiden)

**Handmatig CSV:**
- Upload je verbruiks-CSV met een zonne-kolom
- Geef aan welke kolom = zonne-opbrengst

### "De besparingen lijken te hoog / laag"

**Veelgestelde fouten:**
1. ❌ Piektarief × daltarief omgewisseld
2. ❌ VTK vergeten (voegt toe aan vast)
3. ❌ Leverancier-opslag vergeten (voegt toe aan dynamisch)
4. ❌ Energiebelasting uitgesloten (dringt door in beide)
5. ❌ Vastrecht fout (÷12 als je maandelijks hebt)

**Verificatie:**
- Check je jaarrekening: Hoeveel betaalde je afgelopen jaar echt?
- Trek daarvan de energiebelastingkorting af (−€629)
- Trek netbeheerkosten af (−€480)
- Vergelijk met app-totaal

### "Sliders geven vreemde waarden / hangen vast"

**Try:**
- Refresh pagina (F5)
- Zorg dat app.js niet gecached is (CTRL+SHIFT+Delete → cache leegmaken)

**Geavanceerd:**
- Open Developer Tools (F12 → Console)
- Typ: `localStorage.clear()` en Enter
- Refresh pagina

---

## Contact & Feedback

**Iets gevonden wat niet klopt?**
- GitHub Issues: https://github.com/cyleo/P1_dynamisch_vast_vergelijk/issues
- Zorg dat je screenshots/tarieven meegeeft

**Privacykwesties?**
- Alles in je browser; geen data ontvangen
- Je data verlaat je computer nooit
- Code is open source (controleerbaar)

**Wil je bijdragen?**
- Vertalingen, bug fixes, nieuwe features
- See GitHub repo voor ontwikkelaars-info

---

## Handige Links

- **Live app**: https://energie.vulpini.nl
- **GitHub repository**: https://github.com/cyleo/P1_dynamisch_vast_vergelijk
- **Blog-artikel (NL)**: https://github.com/cyleo/P1_dynamisch_vast_vergelijk/blob/main/blogpost.md
- **EPEX-prijzen (referentie)**: https://www.epexspot.com/en/market-data
- **Frank Energie (prijs-data)**: https://frankenergie.nl
- **Home Assistant**: https://www.home-assistant.io

---

## Samenvatting: In 30 Seconden

1. **Upload je jaar-data** (Home Assistant of CSV)
2. **Vul je huidige tarieven in**
3. **Lees de besparings-badge**:
   - 🟢 Groen? → Dynamisch beter
   - 🔴 Rood? → Vast beter
4. **Probeer hardware** (optioneel): Zie effect accu/EV/WP
5. **Plan actie**: Overstappen ja/nee?

---

**Veel succes met jouw energiebeslissing! 🔋⚡**

---

**Versie**: 2.0 (2026-06-10) | **Taal**: Nederlands | **Geldig tot**: Totdat energiewetten veranderen
