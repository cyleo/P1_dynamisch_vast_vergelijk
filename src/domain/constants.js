// ── Simulatie-constanten (voorheen verspreide magic numbers) ─────────────────
export const EV_MAX_CHARGE_KW = 11.0;   // max laadvermogen EV per uur (kWh)
export const BATTERY_C_RATE = 0.5;    // laad/ontlaadvermogen = capaciteit × C-rate
export const EVENING_PEAK_MULT = 3.0;    // koken/verlichting: synthetische avond × baseload (17–21u)

// Maandelijkse warmtepomp-belastingfactor o.b.v. NL klimaat-graaddagen (HDD, basis 18°C,
// De Bilt-normaal 1991–2020), genormaliseerd op de wintermaanden (dec–feb gem. ≈ 1,3 =
// de "winter stooklast"-schuif). Zomer houdt een vloer (~0,15) voor warmtapwater.
// Realistischere seizoensvorm dan de oude 3-staps 1,3/0,7/0,15: koudste maand (jan) piekt
// en de schouderseizoenen lopen geleidelijk. NB: dit lijnt nog NIET per dag uit met de
// EPEX-koudepieken — daarvoor zijn KNMI-daggegevens (graaddagen per dag) nodig.
export const HEATPUMP_HDD_FACTOR = {
  1: 1.38, 2: 1.21, 3: 1.10, 4: 0.77, 5: 0.44, 6: 0.17,
  7: 0.15, 8: 0.15, 9: 0.29, 10: 0.66, 11: 1.02, 12: 1.31,
};

// Constant market prices & taxes (fallback if live fetch fails)
export const ENERGY_TAX_2026 = 0.11084; // €/kWh (including VAT)
// Vermindering energiebelasting (heffingskorting) — vaste jaarlijkse korting per
// elektriciteitsaansluiting. 2026: €628,96 incl. BTW (bron: Milieu Centraal / Belastingdienst).
// Geldt identiek voor béide contracten (één aansluiting) → comparison-neutraal, maar zonder
// deze post liggen de absolute jaartotalen ~€629 te hoog t.o.v. de echte jaarrekening.
export const EB_REBATE_2026 = 628.96; // €/jaar incl. BTW
// Netbeheerkosten (vastrecht stroomaansluiting t/m 3x25A) — gemiddeld over grote netbeheerders
// (Enexis/Liander/Stedin) voor 2026: ca €480,- per jaar incl. BTW.
// Geldt identiek voor béide contracten (één aansluiting) → comparison-neutraal, maar nodig
// voor een realistisch en compleet totaalbedrag op de jaarrekening.
export const NETBEHEER_2026 = 480.00; // €/jaar incl. BTW

// Seizoensgebonden EPEX-fallbackprofielen (ruwe beursprijzen €/kWh, excl. BTW, excl. EB, excl. opslag)
// Gebaseerd op typische Nederlandse EPEX-patronen per seizoen.
// getFallbackSpot() past automatisch BTW toe (×1.21) op positieve uren.
//
// HERIJKT (v=23): de oude profielen maakten de lente/zomer-middag te diep negatief,
// waardoor de export-gewogen "capture price" van zonnestroom ≈ €0,00/kWh werd. Empirisch
// (NL 2024-2025 kwartierdata) is teruggeleverde zonnestroom ~52% van het jaargemiddelde
// waard. Deze set is geijkt op: vlak jaargemiddelde €0,091, solar-capture €0,048 (53%),
// verbruik-gewogen €0,109, ~3% negatieve uren — gevalideerd via _validate/tune_profiles.js.
// NB: dit is de NOODOPLOSSING; met live/gekalibreerde EPEX-data (buildCalibratedProfile)
// worden deze waarden overschreven door echte marktprijzen.
export const EPEX_PROFILES = {
  // Dec · Jan · Feb — hoge nachten/avonden, koude pieken, weinig zon → zelden negatief
  winter: {
    0: 0.07, 1: 0.06, 2: 0.06, 3: 0.06, 4: 0.06, 5: 0.07,
    6: 0.10, 7: 0.13, 8: 0.14, 9: 0.12, 10: 0.10, 11: 0.09,
    12: 0.09, 13: 0.09, 14: 0.10, 15: 0.11, 16: 0.13, 17: 0.16,
    18: 0.15, 19: 0.13, 20: 0.11, 21: 0.09, 22: 0.08, 23: 0.07
  },
  // Mrt · Apr · Mei — zon drukt de middag, ondiep negatief rond zon-noon
  spring: {
    0: 0.05, 1: 0.04, 2: 0.04, 3: 0.04, 4: 0.04, 5: 0.05,
    6: 0.07, 7: 0.09, 8: 0.09, 9: 0.07, 10: 0.06, 11: 0.05,
    12: 0.01, 13: -0.01, 14: 0.04, 15: 0.07, 16: 0.08, 17: 0.10,
    18: 0.12, 19: 0.13, 20: 0.11, 21: 0.09, 22: 0.07, 23: 0.06
  },
  // Jun · Jul · Aug — diepste zon-kannibalisatie, goedkope nachten
  summer: {
    0: 0.03, 1: 0.02, 2: 0.02, 3: 0.02, 4: 0.02, 5: 0.04,
    6: 0.06, 7: 0.07, 8: 0.07, 9: 0.06, 10: 0.06, 11: 0.04,
    12: -0.01, 13: -0.02, 14: 0.03, 15: 0.06, 16: 0.07, 17: 0.09,
    18: 0.11, 19: 0.12, 20: 0.11, 21: 0.09, 22: 0.07, 23: 0.05
  },
  // Sep · Okt · Nov — mix, loopt op richting winter
  autumn: {
    0: 0.06, 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.06,
    6: 0.08, 7: 0.11, 8: 0.13, 9: 0.10, 10: 0.07, 11: 0.06,
    12: 0.05, 13: 0.04, 14: 0.05, 15: 0.08, 16: 0.12, 17: 0.15,
    18: 0.15, 19: 0.13, 20: 0.11, 21: 0.09, 22: 0.08, 23: 0.07
  }
};
