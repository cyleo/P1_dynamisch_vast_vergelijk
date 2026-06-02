# P1 Energie Contract Analysator

Bereken of een **dynamisch** of **vast** energiecontract goedkoper is voor jouw situatie — op basis van je eigen P1 smart meter data uit Home Assistant.

![screenshot placeholder](https://placehold.co/800x400?text=P1+Energie+Contract+Analysator)

## Wat doet het?

- **Koppelt met Home Assistant** via WebSocket API om tot ~2 jaar historische P1-data op te halen
- **Vergelijkt twee contractvormen** met de 2027-tariefregels (einde saldering, EB op bruto afname):
  - Vast contract: piek/dal tarieven, teruglevertarief, VTK
  - Dynamisch contract: EPEX spotprijzen per uur (Frank Energie / EnergyZero)
- **Simuleert hardware-scenario's**: warmtepomp, elektrische auto, thuisbatterij, zonnepanelen dimmen bij negatieve spotprijzen
- **Grafieken**: dagprofiel (24u), overzicht per dag/week, simulatievergelijking

## Geen installatie vereist

Puur HTML/CSS/JavaScript — geen server, geen database, geen npm. Alles draait lokaal in je browser.

## Snel starten

### Optie 1 — Lokaal bestand (geen HA-koppeling)

Open `index.html` direct in je browser. Je kunt tarieven aanpassen en grafieken bekijken met de ingebouwde voorbeelddata.

> **Let op**: Verbinding met Home Assistant werkt niet via `file://` vanwege browser CORS-beleid.

### Optie 2 — Met Home Assistant koppeling

Start een lokale HTTP-server in de projectmap:

```bash
python3 -m http.server 8080
```

Open dan `http://localhost:8080` in je browser.

#### Nginx CORS-configuratie (voor externe HA-instanties)

Als je Home Assistant extern bereikbaar is (bijv. via `hass.jouwdomein.nl`), voeg dan het volgende toe aan je nginx-configuratie voor de HA-locatie:

```nginx
# Sta CORS toe vanaf localhost (voor de lokale webserver)
add_header Access-Control-Allow-Origin "http://localhost:8080" always;
add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;

if ($request_method = OPTIONS) {
    return 204;
}
```

## Home Assistant instellen

1. Maak een **Long-Lived Access Token** aan in HA: *Profiel → Langdurige toegangstokens*
2. Open de app en vul je HA-URL + token in
3. Selecteer je sensoren:
   - **Import T1/T2**: bijv. `sensor.p1_meter_energy_import_tariff_1/2`
   - **Export T1/T2**: bijv. `sensor.p1_meter_energy_export_tariff_1/2`
   - **Zonnepanelen** (optioneel): kWh- of Wh-sensor van je omvormer
     - Enphase: `sensor.inverter_XXXX_lifetime_energy_production` (Wh → automatisch omgezet)
     - SolarEdge / Fronius: meestal kWh
4. Kies het aantal dagen historische data (max ~730 dagen)

## Tariefinstellingen

### Vast contract (2027-model)
| Instelling | Standaard | Omschrijving |
|------------|-----------|--------------|
| Piektarief | €0,27/kWh | Tarief buiten dal-uren |
| Daltarief | €0,24/kWh | Ma–vr 23:00–07:00 + weekend |
| Teruglevertarief | €0,07/kWh | Vergoeding voor teruggeleverde stroom |
| VTK | €0,00/kWh | Vaste Terugleverkosten (kosten per teruggeleverd kWh) |
| Vastrecht | €7,50/maand | Vaste maandelijkse kosten |

### Dynamisch contract
| Instelling | Standaard | Omschrijving |
|------------|-----------|--------------|
| Opslag | €0,018/kWh | Opslag boven EPEX spotprijs (excl. BTW) |
| Profielverlies | 2% | Korting op teruglevering vanwege profielverschillen |
| Vastrecht | €6,00/maand | Vaste maandelijkse kosten |

## 2027-tariefmodel

Vanaf 1 januari 2027 eindigt de **salderingsregeling** in Nederland. De app rekent al met dit model:

- **Energiebelasting (EB)** wordt geheven over de **bruto afname** (niet meer netto na aftrek teruglevering)
- **Geen saldering**: teruggeleverde stroom vermindert je EB-grondslag niet meer
- Zonnepanelen dimmen bij negatieve EPEX-prijzen is daardoor eerder voordelig dan bij saldering

## Hardware-simulaties

De app kan inschatten wat het effect is van extra apparatuur:

- **Warmtepomp**: extra basisverbruik in de winter
- **Elektrische auto**: extra laadverbruik, optioneel zonne-energie-matching overdag
- **Thuisbatterij**: opslaan bij lage prijzen, ontladen bij hoge prijzen (arbitrage)
- **Zonnepanelen dimmen/uitschakelen**: bij negatieve EPEX-spotprijzen
  - *Dimmen*: omvormer regelt terug tot eigen verbruik (nul-export)
  - *Uitschakelen*: omvormer volledig uit (alles van het net)

## Technisch

- **EPEX-prijzen**: opgehaald via Frank Energie GraphQL API en/of EnergyZero API
- **Fallback**: seizoensprofielen (winter/lente/zomer/herfst) wanneer geen live data beschikbaar
- **HA WebSocket API**: `recorder/statistics_during_period` met `period:"hour"` — ondersteunt jarenlange data (REST history API max ~10 dagen)
- Geen externe dependencies, geen tracking, geen cookies

## Bestanden

```
index.html   — gebruikersinterface
app.js       — alle berekeningen en HA-integratie
style.css    — styling
```

## Licentie

MIT — vrij te gebruiken, aanpassen en verspreiden.
