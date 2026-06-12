/**
 * Lightweight Vanilla JS Pub/Sub Store.
 * Replaces the fragile global state spanning across the monolith.
 */
class Store {
  constructor(initialState) {
    this.state = initialState;
    this.listeners = new Set();
  }

  /**
   * Retrieves the current immutable state object.
   */
  getState() {
    return this.state;
  }

  /**
   * Partially updates the state and notifies all subscribers.
   * @param {Object} updates - The partial state changes.
   */
  setState(updates) {
    this.state = { ...this.state, ...updates };
    this.notify();
  }

  /**
   * Subscribes a function to state changes.
   * @param {Function} listener - Callback invoked with the new state.
   * @returns {Function} Unsubscribe function.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Mutates the epexHistory Map in place and notifies subscribers.
   * Routes all EPEX writes through the store so subscribers stay in sync.
   * @param {Iterable<[string, number]>} entries - key/value pairs to set.
   */
  updateEpexHistory(entries) {
    for (const [k, v] of entries) this.state.epexHistory.set(k, v);
    this.notify();
  }

  /**
   * Manually triggers a re-render for all listeners.
   */
  notify() {
    this.listeners.forEach(fn => fn(this.state));
  }
}

/**
 * Global application store instance.
 */
export const appStore = new Store({
  // Data State
  energyData: [],
  epexHistory: new Map(),
  fullYearData: null,
  _lastHAStats: null,
  _lastRoleMap: null,
  // Bron om de Digital-Twin-stand achteraf te wisselen zonder opnieuw te importeren:
  //  { kind: "ha", stats, roleMap }  → her-parse via processHAStatistics
  //  { kind: "hourly", hourly, devices } → her-parse via untangleHourlyRecords (CSV)
  dtReparse: null,
  isDemoData: true,
  digitalTwinEnabled: true,
  // Tri-state weergave van de gekoppelde hardware:
  //  "simulate" → strip de echte apparaten, schuiven modelleren vervanging (= digitalTwinEnabled:true)
  //  "measured" → ruwe P1-rekening + toon werkelijke kWh per apparaat (schuiven geneutraliseerd)
  //  "off"      → ruwe P1, schuiven modelleren toevoegingen bovenop je situatie
  // digitalTwinEnabled (de strip-vlag die de parser leest) blijft afgeleid = (dtViewMode === "simulate").
  dtViewMode: "simulate",

  // UI & View State
  overviewMode: "day", // "day" | "week" | "month"
  overviewMetric: "energy", // "energy" | "cost" | "savings"
  activeViewType: "bars", // "bars" | "sankey"
  sankeyInterval: "year", // "year" | "month" | "week" | "day"
  sankeyValue: "",
  simMode: "day", // "day" | "week"
  simDrillDay: null,
  
  // Chart Display Toggles
  profileVisibleLines: {
    imp: true,
    exp: true,
    spot: true,
    solar: true,
    ev: true,
    hp: true,
    bat: true
  },
  
  // Pricing & Taxation State
  liveEnergyTax: 0.11084,
  calibratedProfile: null,
  calibrationMeta: { buckets: 0, samples: 0 },
  
  // App Cache & Tracking
  fullYearStamp: "",
  yearScale: 1.0,
  dataMeta: { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 },
  activeSimulation: {},
  untangle: { active: false },
  dataQuality: null,
  
  // Dismissal Flags
  epexWarnDismissed: false,
  prognosisDismissed: false,
  dataQualityDismissed: false
});
