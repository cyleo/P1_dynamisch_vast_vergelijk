import { appStore } from "../domain/store.js";
import { renderChart } from "./charts.js";

/**
 * Displays the setup modal dialog.
 */
export function showSetupModal(tab) {
  const isFile = window.location.protocol === "file:";
  const origin = isFile ? "http://localhost:8080" : window.location.origin;

  document.getElementById("modal-cors-snippet").textContent =
    `http:\n  cors_allowed_origins:\n    - ${origin}`;

  // Mixed Content Warning for HTTPS origins
  const mixedWarning = document.getElementById("ha-mixed-content-warning");
  if (mixedWarning) {
    if (window.location.protocol === "https:") {
      mixedWarning.style.display = "block";
      const siteUrlEl = mixedWarning.querySelector(".site-url");
      if (siteUrlEl) siteUrlEl.textContent = window.location.origin;
    } else {
      mixedWarning.style.display = "none";
    }
  }

  document.getElementById("modal-backdrop").style.display = "flex";

  // Open the direct tab by default, map old 'cors' to 'manual'
  const targetTab = tab === 'cors' ? 'manual' : (tab || "direct");
  if (typeof showModalTab === "function") showModalTab(targetTab);
}

/**
 * Closes the setup modal dialog.
 */
export function closeSetupModal() {
  document.getElementById("modal-backdrop").style.display = "none";
}

/**
 * Opens a modal explaining the specific simulation logic for a hardware component.
 */
export function showHardwareExplainer(kind) {
  const { title, body } = hardwareExplainerContent(kind);
  document.getElementById("explain-title").innerHTML = title;
  document.getElementById("explain-body").innerHTML = body;
  document.getElementById("explain-backdrop").style.display = "flex";
}

export function closeHardwareExplainer() {
  document.getElementById("explain-backdrop").style.display = "none";
}

export function hardwareExplainerContent(kind) {
  const watervalBlock = `
    <div class="explain-block" style="border-left-color: var(--accent-yellow);">
      <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><path d="M2 6c.6.5 1.2 1 2.5 1s2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1 1.2 1 2.5 1 2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1"></path><path d="M2 12c.6.5 1.2 1 2.5 1s2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1 1.2 1 2.5 1 2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1"></path><path d="M2 18c.6.5 1.2 1 2.5 1s2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1 1.2 1 2.5 1 2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1"></path></svg> De Zonne-waterval (Volgorde van stroomverdeling)</h4>
      <p style="margin-top:0.4rem;">Opgewekte zonnestroom stroomt in deze vaste prioriteitsvolgorde door je woning:</p>
      <ol style="margin-left: 1.2rem; padding: 0; line-height: 1.6;">
        <li><strong>Huisverbruik:</strong> Eerst worden je actieve apparaten in huis gevoed.</li>
        <li><strong>Warmtepomp:</strong> Het resterende zonne-overschot dekt als eerste de warmtepomplast (indien actief).</li>
        <li><strong>Elektrische auto (EV):</strong> Wat daarna over is gaat naar de EV (indien zonne-laden actief is en de auto is gekoppeld).</li>
        <li><strong>Thuisaccu:</strong> Wat daarna nog overblijft laadt de thuisaccu op.</li>
        <li><strong>Elektriciteitsnet:</strong> Pas als alles verzadigd is, gaat het restant naar het net (en wordt op dat moment eventueel gedimd bij negatieve prijzen).</li>
      </ol>
    </div>
  `;

  if (kind === "battery") {
    const activeMode = document.getElementById("bat-mode")?.value || "zelf";
    const tag = (m) => activeMode === m ? ` <span style="color:var(--accent-green);font-size:0.75rem;">(nu actief)</span>` : "";
    return {
      title: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="font-size: 1.2rem; color: var(--accent-cyan);"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg> Hoe werkt het thuisbatterij-model?`,
      body: `
        <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
          De accu wordt <strong>per uur</strong> doorgerekend, en apart voor het dynamische en het vaste
          contract (twee gescheiden laadtoestanden). Belangrijk: <strong>de accu hoeft nooit vol</strong> —
          hij laadt alléén zoveel als economisch zin heeft. Op een rustige dag blijft hij deels leeg.
          Bij opslaan en ontladen gaat een deel verloren (round-trip-rendement, bv. 90% → 10% verlies).
        </p>
        ${watervalBlock}
        <div class="explain-block">
          <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg> Maximaal zelfverbruik (standaard)${tag("zelf")}</h4>
          <ul>
            <li><strong>Opslaan:</strong> zonne-overschot dat je anders zou exporteren gaat in de accu —
              maar niet méér dan je die dag zelf nog kunt verbruiken. De rest wordt gewoon geëxporteerd
              (geen onnodig opslaan dat toch niet ontladen wordt).</li>
            <li><strong>Ontladen:</strong> zodra je stroom van het net zou halen. Dat bespaart altijd de
              volle all-in prijs (inclusief energiebelasting), dus zelfverbruik is altijd lonend.</li>
            <li>Geen handel met het net.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">laden:   alleen zon, tot opslag = min(accu_capaciteit, dag-import)
ontladen: dekt eigen import (bespaart all-in)</code>
        </div>
        <div class="explain-block">
          <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg> Kostenbewust${tag("kosten")}</h4>
          <ul>
            <li>Als zelfverbruik, plus: in de <strong>goedkoopste uren van de dag</strong> laadt de accu
              bij van het net — maar <strong>alléén het stukje dat de zon niet dekt</strong> en dat je
              later zelf verbruikt.</li>
            <li>Zo voorkom je dat je stroom inkoopt die de zon toch levert: over élke ingekochte kWh
              betaal je namelijk energiebelasting, die je alleen terugverdient als die kWh later
              net-import verdringt.</li>
            <li>Laden gebeurt alleen als de dure uren (× rendement) duurder zijn dan de goedkope laaduren.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">+ net-laden als: dure_all_in_prijs × rendements_factor > goedkope_all_in_prijs
  laad_budget = max(0, maximale_eigen_behoefte − zonne_overschot × rendements_factor) / rendements_factor</code>
        </div>
        <div class="explain-block">
          <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg> Maximale winst${tag("winst")}</h4>
          <ul>
            <li>Als kostenbewust, plus: in de duurste uren <strong>verkoopt de accu het overschot terug aan het net</strong>.</li>
            <li>Dit gebeurt alleen als de opbrengst — de <strong>kale spotprijs</strong> (zónder BTW en
              zónder energiebelasting) — na rendementsverlies hoger is dan wat het laden kostte, én alléén
              voor energie bóven je eigen-verbruik-voorraad.</li>
            <li>Onder het 2027-model betaal je energiebelasting over élke ingekochte kWh, maar krijg je die
              níét terug bij verkoop. <strong>Daardoor komt deze modus op normale prijzen vrijwel altijd
              gelijk uit met "Kostenbewust"</strong> — zelfverbruik (bespaart all-in incl. EB) is bijna
              altijd waardevoller dan teruglevering (kale spot). Echt voordeel ontstaat pas bij flinke
              prijspieken én vrije accu-capaciteit.</li>
            <li>In het <strong>2026-scenario (saldering)</strong> ligt dit anders: teruglevering binnen je
              jaarverbruik is dan de all-in import-prijs waard (BTW en inkoopvergoeding krijg je via de
              jaarverrekening terug) — de verkoop-drempel rekent in dat scenario met die hogere waarde en
              de accu exporteert dus vaker.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">+ verkoop als: beursprijs / 1.21 − teruglever_opslag > goedkope_all_in_prijs / rendements_factor
  export = max(0, opgeslagen_stroom − maximale_eigen_behoefte)</code>
        </div>
        <p class="explain-note">
          <svg class="icon icon-inline" viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke-width: 2.5;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> De knop "Bereken Ideale Accu Formaat" veegt verschillende groottes door met de gekozen modus en
          toont de terugverdientijd (bij €450/kWh) — zo zie je dat een grotere accu niet automatisch beter is.
        </p>
        <details class="explain-formula">
          <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
          <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
            <p><strong>1. Rendement bij laden en ontladen:</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Bij het opslaan van stroom treedt energieverlies op. Bij een rendement van bijvoorbeeld 90% (rendementsfactor 0.90) wordt 10% omgezet in warmte:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">nieuwe_opgeslagen_stroom = oude_opgeslagen_stroom + (ingeladen_stroom × rendements_factor)
geleverde_stroom = ontladen_stroom  (ontladen gaat zonder extra verlies)</code>

            <p><strong>2. Slimme opslaglimiet (voorkomt onnodig hamsteren):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              De accu laadt per dag nooit meer op dan je die dag daadwerkelijk zelf nodig hebt. Dit voorkomt dat een hele grote accu onnodig stroom vasthoudt die je toch niet verbruikt:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">maximale_eigen_behoefte = de kleinste waarde van (accu_capaciteit OF totale_dag_import)
opslag_limiet = maximale_eigen_behoefte  (plus eventueel verkoopruimte in de winst-modus)</code>

            <p><strong>3. Consumentenprijs (all-in importprijs):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              De all-in prijs die je betaalt per kWh stroom van het net. Beursprijs én opslag voer je incl. btw in, dus je telt ze rechtstreeks bij de energiebelasting op. Dit is wat je bespaart door stroom uit de accu te gebruiken:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">all-in prijs = beursprijs (incl. btw) + inkoop-opslag (incl. btw) + energiebelasting</code>

            <p><strong>4. Laden vanaf het net (wanneer loont dit?):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Laden vanaf het net in goedkope uren is alleen rendabel als de all-in prijs tijdens de dure uren (vermenigvuldigd met het rendement) hoger is dan de all-in prijs tijdens de goedkope uren:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">dure_all_in_prijs × rendements_factor  >  goedkope_all_in_prijs</code>

            <p><strong>5. Hoeveel laden vanaf het net (Net-laad-budget):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              We berekenen precies hoeveel stroom er van het net geladen moet worden, rekening houdend met de verwachte zonne-energie van die dag (om te voorkomen dat we belasting betalen over stroom die we ook gratis van de zon hadden kunnen krijgen):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">net_laad_budget = maximale_waarde van (0 OF maximale_eigen_behoefte − zonne_overschot × rendements_factor) / rendements_factor</code>

            <p><strong>6. Teruglevering loont (alleen in de winst-modus):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Terugleveren loont alleen als de ontvangen vergoeding hoger is dan de inkoopkosten per geleverde kWh:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">terugleververgoeding per kWh  =  beursprijs / 1.21 − teruglever_opslag
laadkosten per geleverde kWh  =  goedkope_all_in_prijs / rendements_factor
verkopen loont als:  terugleververgoeding > laadkosten
export_stroom = maximale_waarde van (0 OF opgeslagen_stroom − maximale_eigen_behoefte)</code>
          </div>
        </details>`,
    };
  }
  if (kind === "heatpump") {
    return {
      title: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="font-size: 1.2rem; color: var(--accent-purple);"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg> Hoe werkt het warmtepomp-model?`,
      body: `
        <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
          De warmtepomp voegt een <strong>elektrische stooklast</strong> toe (de schuif = gemiddeld
          wintervermogen in kW). Die last wordt per uur opgeteld bij je import (of trekt eerst van je
          zon-overschot af) en telt mee in <strong>beide</strong> contracten.
        </p>
        <div class="explain-block">
          <h4>Seizoensvorm via graaddagen</h4>
          <ul>
            <li>De jaarverdeling volgt het Nederlandse klimaat (graaddagen, basis 18&deg;C, De Bilt-normaal):
              piek in dec/jan, geleidelijk aflopend naar het voorjaar, met een kleine zomer-vloer voor
              warmtapwater.</li>
            <li>Per uur: <em>last = winter-stooklast × maandfactor × dag/nacht-factor</em>.</li>
            <li>Dag/nacht: 's nachts ~1,2× (kouder + opwarmen na de nachtverlaging), overdag ~0,9×.</li>
          </ul>
        </div>
        <p class="explain-note">
          ⓘ Beperking: de maandfactor is vlak per maand — hij lijnt nog niet per dag uit met echte
          koudegolven/EPEX-prijspieken. In een strenge koudegolf is warmtepomp-op-dynamisch dus iets
          optimistisch ingeschat.
        </p>
        <details class="explain-formula">
          <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
          <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
            <p><strong>Stooklast per uur:</strong></p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">stooklast = winter_stooklast × maandfactor_verwarmingsbehoefte × dag_nacht_factor</code>
            
            <p><strong>Dag/nacht factor:</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              In de nacht staat de warmtepomp vaak iets harder te werken (door lagere buitentemperatuur of opstarten in de vroege ochtend):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">nacht (tussen 22:00 en 07:00 uur) = 1.2
overdag (tussen 07:00 en 22:00 uur) = 0.9</code>
            
            <p><strong>Maandfactoren voor de verwarmingsbehoefte (op basis van graaddagen):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Deze factoren bepalen hoe de warmtevraag over het jaar is verdeeld (hoog in de winter, laag in de zomer):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">jan: 1.38  ·  feb: 1.21  ·  mrt: 1.10  ·  apr: 0.77
mei: 0.44  ·  jun: 0.17  ·  jul: 0.15  ·  aug: 0.15
sep: 0.29  ·  okt: 0.66  ·  nov: 1.02  ·  dec: 1.31</code>
          </div>
        </details>`,
    };
  }
  // EV
  return {
    title: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="font-size: 1.2rem; color: var(--accent-blue);"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg> Hoe werkt het EV-model?`,
    body: `
      <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
        Uit <strong>wekelijkse afstand × verbruik per 100 km</strong> volgt de jaarlijkse laadvraag.
        Die wordt slim over de uren verdeeld — apart gepland voor het dynamische en het vaste contract.
      </p>
      ${watervalBlock}
      <div class="explain-block">
        <h4>Slim laden (look-ahead per dag)</h4>
        <ul>
          <li>Eerst <strong>gratis zonne-overschot</strong> (overdag, ~10–16u), als zonne-laden aanstaat.</li>
          <li>Daarna het restant in de <strong>goedkoopste resterende uren</strong> (dynamisch) resp. de
            <strong>daluren</strong> (vast contract).</li>
        </ul>
      </div>
      <div class="explain-block">
        <h4>Wanneer staat de auto ingeplugd?</h4>
        <ul>
          <li><strong>Altijd thuis:</strong> laden mag overdag én 's nachts.</li>
          <li><strong>Kantoortijden:</strong> ma–vr 08:00–17:00 is de auto weg — dan vervalt zonne-laden op
            werkdagen en wordt vooral 's avonds/nachts geladen.</li>
          <li>Zonne-laden uit = de hele laadvraag komt volgens het schema van het net.</li>
        </ul>
      </div>
      <details class="explain-formula">
        <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
        <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
          <p><strong>Benodigde laadstroom:</strong></p>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">jaarlijkse_laadvraag = (wekelijkse_afstand × verbruik_per_100km / 100) × 52 weken
gemiddelde_dagvraag  = (wekelijkse_afstand × verbruik_per_100km / 100) / 7 dagen</code>
          
          <p><strong>Verdeling van de laadstroom per dag (begrensd op ${EV_MAX_CHARGE_KW} kW per uur):</strong></p>
          <ol style="margin-left: 1.2rem; padding: 0; color: var(--text-muted); line-height: 1.6;">
            <li>Eerst vullen met het gratis <strong>zonne-overschot</strong> (meestal tussen 10:00 en 16:00 uur).</li>
            <li>Als er nog meer stroom nodig is: de rest inplannen tijdens de <strong>goedkoopste uren van de dag</strong> (dynamisch contract) of tijdens de <strong>daluren</strong> (vast contract).</li>
          </ol>
          <p style="margin-top: 0.5rem; color: var(--text-muted);">
            Bij de instelling "Kantoortijden" kan de auto op werkdagen (maandag t/m vrijdag) tussen 08:00 en 17:00 uur niet laden omdat de auto dan weg is.
          </p>
        </div>
      </details>`,
  };
}

/**
 * Toggles the visibility of detail rows within the calculation tables.
 */
export function toggleTableDetail(headerId, subRowClass) {
  const header = document.getElementById(headerId);
  if (!header) return;
  const chevron = header.querySelector(".toggle-chevron");
  const subRows = document.querySelectorAll("." + subRowClass);
  if (!subRows.length) return;
  
  const isHidden = subRows[0].style.display === "none";
  subRows.forEach(row => {
    if (row.id === "tbl-dyn-afname-detail") {
      row.style.display = "none";
      const subChevron = document.getElementById("afname-toggle-icon");
      if (subChevron) subChevron.style.transform = "rotate(0deg)";
    } else {
      row.style.display = isHidden ? "" : "none";
    }
  });
  if (chevron) {
    chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
  }
}

/**
 * Toggles the expanded/collapsed state of a UI card panel.
 */
export function toggleCard(titleEl) {
  const card = titleEl.closest(".glass-panel");
  if (card) card.classList.toggle("collapsed");
}

/**
 * Toggles the visibility of a specific line in the simulation profile chart.
 */
export function toggleProfileLine(key) {
  const current = appStore.getState().profileVisibleLines;
  const nextLines = { ...current, [key]: !current[key] };
  appStore.setState({ profileVisibleLines: nextLines });
  const legendEl = document.getElementById(`legend-${key}`);
  if (legendEl) {
    legendEl.style.opacity = nextLines[key] ? "1" : "0.35";
    legendEl.style.textDecoration = nextLines[key] ? "none" : "line-through";
  }
  renderChart();
}

/**
 * Displays a modal asking the user to map CSV columns to simulation roles.
 */
export function showCsvMapModal(entities, guesses) {
  return new Promise((resolve, reject) => {
    const backdrop = document.getElementById("csv-map-backdrop");
    const selectIds = [
      "csv-sel-imp1", "csv-sel-imp2", "csv-sel-exp1", "csv-sel-exp2",
      "csv-sel-solar", "csv-sel-ev", "csv-sel-hp", "csv-sel-batIn", "csv-sel-batOut"
    ];
    
    selectIds.forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      select.innerHTML = "";
      
      const role = id.replace("csv-sel-", "");
      const isOptional = ["solar", "ev", "hp", "batIn", "batOut"].includes(role);
      
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = isOptional ? "— Niet koppelen (optioneel) —" : "— Selecteer sensor (vereist) —";
      select.appendChild(emptyOpt);
      
      entities.forEach(ent => {
        const opt = document.createElement("option");
        opt.value = ent;
        opt.textContent = ent;
        select.appendChild(opt);
      });
      
      if (guesses[role] && entities.includes(guesses[role])) {
        select.value = guesses[role];
      } else {
        select.value = "";
      }
    });
    
    backdrop.style.display = "flex";
    
    const cleanup = () => {
      backdrop.style.display = "none";
      document.getElementById("csv-map-confirm").removeEventListener("click", onConfirm);
      document.getElementById("csv-map-cancel").removeEventListener("click", onCancel);
    };
    
    function onConfirm() {
      const selection = {
        imp1: document.getElementById("csv-sel-imp1").value,
        imp2: document.getElementById("csv-sel-imp2").value,
        exp1: document.getElementById("csv-sel-exp1").value,
        exp2: document.getElementById("csv-sel-exp2").value,
        solar: document.getElementById("csv-sel-solar").value,
        ev: document.getElementById("csv-sel-ev").value,
        hp: document.getElementById("csv-sel-hp").value,
        batIn: document.getElementById("csv-sel-batIn").value,
        batOut: document.getElementById("csv-sel-batOut").value
      };
      if (!selection.imp1 && !selection.imp2) {
        alert("Selecteer minimaal één afname-sensor.");
        return;
      }
      cleanup();
      resolve(selection);
    }
    
    function onCancel() {
      cleanup();
      reject(new Error("CSV-import geannuleerd door gebruiker."));
    }
    
    document.getElementById("csv-map-confirm").addEventListener("click", onConfirm);
    document.getElementById("csv-map-cancel").addEventListener("click", onCancel);
  });
}

export function showUploadError(msg) {
  document.getElementById("data-status").textContent = "Upload mislukt";
  let errEl = document.getElementById("upload-error");
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.id = "upload-error";
    errEl.style.cssText = "color:var(--accent-orange);font-size:0.8rem;margin-top:0.6rem;";
    document.getElementById("dropzone").after(errEl);
  }
  errEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> ` + msg;
  setTimeout(() => { errEl.innerHTML = ""; }, 8000);
}

export function toggleAfnameDetail() {
  afnameDetailOpen = !afnameDetailOpen;
  document.getElementById("tbl-dyn-afname-detail").style.display = afnameDetailOpen ? "" : "none";
  document.getElementById("afname-toggle-icon").style.transform = afnameDetailOpen ? "rotate(180deg)" : "";
  if (afnameDetailOpen) renderAfnameDetail();
}

/**
 * Updates the Digital Twin banner text indicating active hardware simulations.
 */
export function updateDigitalTwinBanner(meta) {
  const banner = document.getElementById("digital-twin-banner");
  if (!banner) return;
  // Toon de banner zodra apparaten gekoppeld zijn (ook als de strip uitstaat).
  const hasDevices = meta && (meta.active || (meta.devices &&
    (meta.devices.ev || meta.devices.hp || meta.devices.battery)));
  window.digitalTwinMode = meta && meta.active ? meta : null;
  if (!hasDevices) { window.dtMeasuredMode = false; banner.style.display = "none"; return; }

  const names = [];
  if (meta.devices?.ev) names.push("elektrische auto");
  if (meta.devices?.hp) names.push("warmtepomp");
  if (meta.devices?.battery) names.push("thuisbatterij");
  const human = names.length === 1 ? names[0]
    : names.slice(0, -1).join(", ") + " en " + names.slice(-1);
  const devEl = document.getElementById("digital-twin-devices");
  if (devEl) devEl.textContent = human || "hardware";

  const { dtViewMode } = appStore.getState();
  const mode = dtViewMode || "simulate";
  // Forceert de hardware-lijnen in de 24u-grafiek aan voor de "Gemeten"-stand (zie charts.js).
  window.dtMeasuredMode = mode === "measured" && hasDevices;
  const accent = mode === "simulate" ? "var(--accent-cyan)"
    : mode === "measured" ? "var(--accent-green)" : "var(--accent-orange)";
  banner.style.border = `1px solid ${accent}`;
  banner.style.background = mode === "simulate" ? "rgba(56,189,248,0.08)"
    : mode === "measured" ? "rgba(74,222,128,0.08)" : "rgba(251,146,60,0.08)";

  const statusEl = document.getElementById("dt-status-label");
  if (statusEl) {
    statusEl.textContent = mode === "simulate" ? "simuleren"
      : mode === "measured" ? "gemeten" : "uit";
    statusEl.style.color = accent;
  }

  // Markeer de actieve segment-knop.
  document.querySelectorAll("#dt-mode-switch .dt-mode-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.dtMode === mode);
  });

  const bodyEl = document.getElementById("dt-banner-body");
  if (bodyEl) {
    bodyEl.innerHTML = mode === "simulate"
      ? `Je bestaande <span id="digital-twin-devices">${human || "hardware"}</span> is uit de historische baseline <strong>gestript</strong>. De schuiven hieronder modelleren nu <strong>vervangende</strong> hardware, geen toevoegingen.`
      : mode === "measured"
      ? `<strong>Gemeten situatie.</strong> De rekening is op je ruwe meterstanden (je échte verbruik, inclusief je huidige <span id="digital-twin-devices">${human || "hardware"}</span>). De hardware-schuiven staan hieronder <strong>uit</strong> — dit is je werkelijkheid, geen simulatie.`
      : `De strip staat <strong>uit</strong> — ruwe meterstanden worden 1-op-1 gebruikt. De hardware-schuiven modelleren <strong>toevoegingen</strong> bovenop je bestaande <span id="digital-twin-devices">${human || "hardware"}</span>.`;
  }

  renderMeasuredBreakdown(meta, mode);
  banner.style.display = "block";
}

/**
 * Tekent het "Huidige situatie (gemeten)"-paneel: werkelijke kWh per apparaat over de
 * gemeten periode. Alleen zichtbaar in de "Gemeten"-stand. Puur observationeel — de
 * totalen komen rechtstreeks uit de gekoppelde apparaatsensoren (untangle-meta).
 */
function renderMeasuredBreakdown(meta, mode) {
  const box = document.getElementById("dt-measured-breakdown");
  if (!box) return;
  if (mode !== "measured") { box.style.display = "none"; box.innerHTML = ""; return; }

  const { energyData } = appStore.getState();
  const hours = Array.isArray(energyData) ? energyData.length : 0;
  const days = hours ? Math.max(1, Math.round(hours / 24)) : 0;
  const fmt = (v) => (v || 0).toLocaleString("nl-NL", { maximumFractionDigits: 0 });

  const rows = [];
  if (meta.devices?.ev) rows.push(["Elektrische auto", `${fmt(meta.ev)} kWh geladen`]);
  if (meta.devices?.hp) rows.push(["Warmtepomp", `${fmt(meta.hp)} kWh verbruikt`]);
  if (meta.devices?.battery) {
    rows.push(["Batterij — geladen", `${fmt(meta.batIn)} kWh in`]);
    rows.push(["Batterij — ontladen", `${fmt(meta.batOut)} kWh uit`]);
  }
  if (meta.solar) rows.push(["Zonnepanelen", `${fmt(meta.solar)} kWh opgewekt`]);

  if (!rows.length) { box.style.display = "none"; box.innerHTML = ""; return; }

  const period = days ? ` over je gemeten periode (${days} ${days === 1 ? "dag" : "dagen"})` : "";
  // De per-apparaat totalen zijn gemeten; de zon-vs-net verdeling in de Sankey/kosten-
  // uitsplitsing is een schatting (je P1-meter meet die split per apparaat niet).
  const note = (meta.devices?.ev || meta.devices?.hp || meta.devices?.battery) && meta.solar
    ? `<div class="dt-measured-note">De totalen zijn gemeten. In de Sankey en kosten-uitsplitsing is de <strong>zon-vs-net verdeling per apparaat geschat</strong> (je meter meet die niet) — energiebehoudend verdeeld over gelijktijdig verbruik.</div>`
    : "";
  box.innerHTML =
    `<div class="dt-measured-title">Huidige situatie — gemeten${period}</div>` +
    `<div class="dt-measured-grid">` +
    rows.map(([label, val]) =>
      `<div class="dt-measured-row"><span>${label}</span><strong>${val}</strong></div>`).join("") +
    `</div>` + note;
  box.style.display = "block";
}

