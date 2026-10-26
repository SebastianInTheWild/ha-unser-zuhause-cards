// „Unser Zuhause – Karten“: alle Karten für das Dashboard „Unser Zuhause“ (auch einzeln nutzbar)
// Autor: SebastianInTheWild · MIT-Lizenz
// uz-energy-now-card, uz-energy-day-card (+ Editor), uz-system-status-card, uz-zombie-card,
// uz-camera-grid-card (+ Editor), uz-link-tile, uz-collapsible-card, uz-badge-row, uz-spacer-card

const UZ_CARDS_VERSION = "1.0.0";

const SYSTEM_PATH = "system";

const DEVICE_ICONS = { wallbox: "mdi:car-electric", heizung: "mdi:heat-pump-outline", auto: "mdi:car", gas: "mdi:fire" };

// Liest die Quellen aus dem Standard-Energie-Dashboard (energy/get_prefs)
function energySources(prefs) {
  const src = (type) => (prefs?.energy_sources || []).filter((s) => s.type === type);
  const grid = src("grid")[0];
  return {
    gridFrom: grid?.stat_energy_from ?? grid?.flow_from?.[0]?.stat_energy_from,
    gridTo: grid?.stat_energy_to ?? grid?.flow_to?.[0]?.stat_energy_to,
    // Leistung mit Vorzeichen (HA: positiv = Netzbezug bzw. Entladen)
    gridRate: grid?.stat_rate ?? grid?.power?.[0]?.stat_rate,
    batteryRate: src("battery")[0]?.stat_rate,
    solar: src("solar")[0]?.stat_energy_from,
    solarRate: src("solar")[0]?.stat_rate,
    batteryOut: src("battery")[0]?.stat_energy_from,
    batteryIn: src("battery")[0]?.stat_energy_to,
    batterySoc: src("battery")[0]?.stat_soc,
    water: src("water")[0]?.stat_energy_from,
    waterRate: src("water")[0]?.stat_rate,
    devices: prefs?.device_consumption || [],
  };
}

// ---------- Karten: Energiefluss (uz-energy-now-card, uz-energy-day-card) ----------
// Eigenständige Karten mit eigenem Editor, auf jedem Dashboard nutzbar.
// Quellen (Netz, PV, Batterie, Wasser, Geräte) kommen automatisch aus dem Energie-Dashboard;
// Leistungssensoren, Akkustand und Geräte stellt man im Karten-Editor ein.
// Aufbau wie bei der Power Flow Card Plus: Kreise und Icons als HTML (auch in der App korrekt),
// Linien als SVG. Größen skalieren mit der Kartenbreite, damit die Werte immer in die Kreise passen.
//
// Konfiguration (alles optional):
//   title, mode (nur uz-energy-flow-card: now | day), devices: ["Wallbox", …] (Namen aus dem Energie-Dashboard),
//   device_power: { Wallbox: sensor… }, show_water, show_legend, fossil_entity,
//   power_grid_in, power_grid_out, power_solar, power_battery_in, power_battery_out, battery_soc,
//   extra: [{ entity, name, icon, color, power }], refresh_interval

const FLOW_COLORS = {
  grid: "#488fc2",
  lowCarbon: "#0f9d58",
  solar: "#ff9800",
  battery: "#f06292",
  water: "#00bcd4",
  consumers: ["#a280db", "#e34f4f", "#5ec26a", "#d0cc5b", "#ff7f50", "#3f51b5"],
};

const FLOW = { W: 480, R: 38, ROW: 115, X_GRID: 45, X_MID: 165, X_HOME: 290, X_RIGHT: 432 };
const ACTIVE_W = 10; // ab dieser Leistung (W) gilt eine Linie als aktiv

// Aufteilung auf die einzelnen Wege (wie die Energie-Verteilungskarte von HA)
function splitFlows({ solar = 0, gridIn = 0, gridOut = 0, batIn = 0, batOut = 0 }) {
  const solarToBattery = Math.min(batIn, solar);
  const gridToBattery = Math.max(batIn - solarToBattery, 0);
  const solarLeft = solar - solarToBattery;
  const solarToGrid = Math.min(gridOut, solarLeft);
  const batteryToGrid = Math.max(gridOut - solarToGrid, 0);
  const solarToHome = Math.max(solarLeft - solarToGrid, 0);
  const batteryToHome = Math.max(batOut - batteryToGrid, 0);
  const gridToHome = Math.max(gridIn - gridToBattery, 0);
  return {
    solarToHome, solarToBattery, solarToGrid,
    gridToHome, gridToBattery,
    batteryToHome, batteryToGrid,
    home: solarToHome + batteryToHome + gridToHome,
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// Energie-Einstellungen (energy/get_prefs) einmal je Verbindung laden
const energyPrefsCache = new WeakMap();
function loadEnergyPrefs(hass) {
  const key = hass.connection || hass;
  if (!energyPrefsCache.has(key)) {
    energyPrefsCache.set(key, hass.callWS({ type: "energy/get_prefs" }).catch(() => undefined));
  }
  return energyPrefsCache.get(key);
}

// Batterie-Icon passend zum Ladestand (10er-Schritte)
function batteryIcon(soc) {
  if (!Number.isFinite(soc)) return "mdi:battery-high";
  const step = Math.round(Math.min(Math.max(soc, 0), 100) / 10) * 10;
  if (step === 100) return "mdi:battery";
  if (step === 0) return "mdi:battery-outline";
  return `mdi:battery-${step}`;
}

// Kartenkonfiguration + Energie-Dashboard → konkrete Entitäten für die Darstellung
function resolveFlowConfig(config, prefs) {
  const s = energySources(prefs);
  const wanted = (Array.isArray(config.devices) ? config.devices : [])
    .map((n) => String(typeof n === "object" ? n?.name : n).toLowerCase());
  const devicePower = config.device_power && typeof config.device_power === "object" ? config.device_power : {};
  const devices = s.devices
    .filter((d) => wanted.includes(String(d.name || "").toLowerCase()))
    .sort((a, b) => wanted.indexOf(a.name.toLowerCase()) - wanted.indexOf(b.name.toLowerCase()));
  return {
    grid: s.gridFrom ? { import: s.gridFrom, export: s.gridTo, fossil: config.fossil_entity || undefined } : undefined,
    solar: s.solar,
    battery: s.batteryOut || s.batteryIn
      ? { out: s.batteryOut, in: s.batteryIn, soc: config.battery_soc || s.batterySoc }
      : undefined,
    water: config.show_water !== false && s.water ? { entity: s.water, rate: s.waterRate } : undefined,
    power: {
      grid_in: config.power_grid_in || undefined,
      grid_out: config.power_grid_out || undefined,
      solar: config.power_solar || s.solarRate,
      battery_in: config.power_battery_in || undefined,
      battery_out: config.power_battery_out || undefined,
      // Ohne eigene Sensoren: Leistung aus dem Energie-Dashboard
      grid_net: config.power_grid_in || config.power_grid_out ? undefined : s.gridRate,
      battery_net: config.power_battery_in || config.power_battery_out ? undefined : s.batteryRate,
    },
    consumers: [
      ...devices.map((d) => ({
        entity: d.stat_consumption,
        name: d.name,
        icon: DEVICE_ICONS[d.name.toLowerCase()] || "mdi:flash",
        power: devicePower[d.name] || d.stat_rate,
      })),
      ...(Array.isArray(config.extra) ? config.extra : []).filter((x) => x?.entity),
    ],
  };
}

class UzEnergyFlowCard extends HTMLElement {
  // Unterklassen legen die Ansicht fest; die allgemeine Karte nutzt config.mode
  static get MODE() {
    return undefined;
  }

  static getConfigElement() {
    const el = document.createElement("uz-energy-flow-card-editor");
    el.showMode = !this.MODE;
    return el;
  }

  static getStubConfig() {
    return { show_water: true, show_legend: true };
  }

  setConfig(config) {
    this._config = { ...config };
    this._mode = this.constructor.MODE || config.mode || "day";
    this._values = {};
    this._resolved = undefined;
    this._shape = undefined; // neue Konfiguration → Gerüst neu aufbauen
    clearInterval(this._timer);
    this._timer = undefined;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => {
        const node = ev.composedPath().find((el) => el.dataset?.entity);
        if (!node) return;
        this.dispatchEvent(
          new CustomEvent("hass-more-info", { detail: { entityId: node.dataset.entity }, bubbles: true, composed: true })
        );
      });
    }
    if (this._hass) this._prepare();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._prepare();
      return;
    }
    // Aktuelle Leistung ändert sich laufend: höchstens alle 5 s neu zeichnen
    if (this._resolved && Date.now() - (this._lastRender || 0) > 5000) this._render();
  }

  connectedCallback() {
    if (this._resolved && !this._timer) this._start();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto" };
  }

  // Quellen auflösen: alte Strategy-Konfiguration (grid/solar/…) direkt, sonst aus dem Energie-Dashboard
  async _prepare() {
    const c = this._config;
    if (c.grid || c.solar || c.battery) {
      this._resolved = c;
    } else {
      const prefs = await loadEnergyPrefs(this._hass);
      if (this._config !== c) return; // inzwischen neu konfiguriert
      this._resolved = resolveFlowConfig(c, prefs);
    }
    this._start();
  }

  _start() {
    clearInterval(this._timer);
    // Aktuelle Werte kommen direkt aus den Zuständen, keine Statistik nötig
    if (this._mode === "now") {
      this._render();
      return;
    }
    this._fetch();
    this._timer = setInterval(() => this._fetch(), (this._config.refresh_interval || 60) * 1000);
  }

  _statIds() {
    const c = this._resolved;
    return [
      c.grid?.import, c.grid?.export, c.solar, c.battery?.out, c.battery?.in, c.water?.entity,
      ...(c.consumers || []).map((x) => x.entity),
    ].filter(Boolean);
  }

  // Änderung der Statistik seit Mitternacht (calendar: day = heute)
  async _fetch() {
    if (!this._hass || !this._resolved) return;
    const ids = [...new Set(this._statIds())];
    const results = await Promise.all(
      ids.map((id) =>
        this._hass
          .callWS({
            type: "recorder/statistic_during_period",
            statistic_id: id,
            calendar: { period: "day" },
            types: ["change"],
          })
          .then((r) => [id, typeof r?.change === "number" ? r.change : null])
          .catch(() => [id, null])
      )
    );
    this._values = Object.fromEntries(results);
    this._render();
  }

  _unit(id) {
    return this._hass?.states[id]?.attributes?.unit_of_measurement || "";
  }

  // Energie normiert auf kWh
  _kwh(id) {
    const v = id ? this._values[id] : null;
    if (v == null) return null;
    const unit = this._unit(id);
    if (unit === "Wh") return v / 1000;
    if (unit === "MWh") return v * 1000;
    return v;
  }

  // Aktuelle Leistung in W (0, wenn kein Sensor oder kein Zahlenwert)
  _watt(id) {
    return Math.abs(this._signedWatt(id));
  }

  // Wie _watt, aber mit Vorzeichen (Leistungssensoren des Energie-Dashboards: + Bezug/Entladen, − Einspeisung/Laden)
  _signedWatt(id) {
    if (!id) return 0;
    const v = parseFloat(this._hass?.states[id]?.state);
    if (!Number.isFinite(v)) return 0;
    const unit = this._unit(id);
    if (unit === "kW") return v * 1000;
    if (unit === "MW") return v * 1e6;
    return v;
  }

  _num(v, digits) {
    const lang = this._hass?.locale?.language || "de";
    return v.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  _fmtEnergy(kwh) {
    if (kwh == null) return "–";
    if (Math.abs(kwh) < 1) return `${this._num(kwh * 1000, 0)} Wh`;
    return `${this._num(kwh, 1)} kWh`;
  }

  // Beliebige Einheit (Wasser, Gas …); Energie-Einheiten wie oben
  _fmtAny(id) {
    const unit = this._unit(id);
    if (["Wh", "kWh", "MWh"].includes(unit) || !unit) return this._fmtEnergy(this._kwh(id));
    const v = this._values[id];
    if (v == null) return "–";
    if (unit === "m³" && Math.abs(v) < 10) return `${this._num(v * 1000, 0)} L`;
    return `${this._num(v, 2)} ${unit}`;
  }

  _fmtPower(w) {
    if (w == null) return "–";
    if (w >= 1000) return `${this._num(w / 1000, 2)} kW`;
    return `${this._num(w, 0)} W`;
  }

  // Aktueller Zustand eines Sensors mit eigener Einheit (z. B. Wasserdurchfluss)
  _fmtState(id) {
    const st = id ? this._hass?.states[id] : null;
    const v = parseFloat(st?.state);
    if (!Number.isFinite(v)) return "–";
    return `${this._num(v, v < 10 ? 1 : 0)} ${this._unit(id)}`.trim();
  }

  _render() {
    if (!this.shadowRoot || !this._resolved) return;
    this._lastRender = Date.now();
    const c = this._resolved;
    const p = c.power || {};
    const live = this._mode === "now"; // now: aktuelle Leistung statt Tageswerte
    const title = this._config.title ?? (live ? "Aktuell" : "Energie heute");
    const { W, R, ROW, X_GRID, X_MID, X_HOME, X_RIGHT } = FLOW;

    if (!c.grid && !c.solar && !c.battery) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px">Im Energie-Dashboard ist noch keine Energiequelle eingerichtet
        (Einstellungen → Dashboards → Energie).</div></ha-card>`;
      this._shape = undefined;
      return;
    }

    const consumers = c.consumers || [];
    const H = Math.max(3 * ROW, consumers.length * 100 + 30);
    const yMid = H / 2;
    const yTop = yMid - ROW;
    const yBottom = yMid + ROW;
    const step = consumers.length > 1 ? Math.min(ROW, (H - ROW) / (consumers.length - 1)) : 0;

    // Aktuelle Leistung (aktive Linien; im Modus now auch die Werte)
    const net = (key) => (p[key] ? this._signedWatt(p[key]) : null);
    const gridNet = net("grid_net");
    const batNet = net("battery_net");
    const pw = {
      gridIn: p.grid_in ? this._watt(p.grid_in) : gridNet !== null ? Math.max(gridNet, 0) : null,
      gridOut: p.grid_out ? this._watt(p.grid_out) : gridNet !== null ? Math.max(-gridNet, 0) : null,
      batOut: p.battery_out ? this._watt(p.battery_out) : batNet !== null ? Math.max(batNet, 0) : null,
      batIn: p.battery_in ? this._watt(p.battery_in) : batNet !== null ? Math.max(-batNet, 0) : null,
    };
    const now = splitFlows({
      solar: this._watt(p.solar), gridIn: pw.gridIn || 0, gridOut: pw.gridOut || 0, batIn: pw.batIn || 0, batOut: pw.batOut || 0,
    });

    // Werte in den Kreisen und Ring: Tageswerte (kWh) oder aktuelle Leistung (W)
    const fmt = live ? (v) => this._fmtPower(v) : (v) => this._fmtEnergy(v);
    const gridIn = live ? pw.gridIn : this._kwh(c.grid?.import);
    const gridOut = live ? pw.gridOut : this._kwh(c.grid?.export);
    const solar = live ? (p.solar ? this._watt(p.solar) : null) : this._kwh(c.solar);
    const batOut = live ? pw.batOut : this._kwh(c.battery?.out);
    const batIn = live ? pw.batIn : this._kwh(c.battery?.in);
    const day = live
      ? now
      : splitFlows({ solar: solar || 0, gridIn: gridIn || 0, gridOut: gridOut || 0, batIn: batIn || 0, batOut: batOut || 0 });
    const fossilPct = c.grid?.fossil ? parseFloat(this._hass?.states[c.grid.fossil]?.state) : NaN;
    const gridFossil = Number.isFinite(fossilPct) ? day.gridToHome * (fossilPct / 100) : day.gridToHome;
    const gridLowCarbon = day.gridToHome - gridFossil;
    const soc = c.battery?.soc ? parseFloat(this._hass?.states[c.battery.soc]?.state) : NaN;

    const nodes = [];
    const links = [];
    const node = (key, x, y, opts) => {
      nodes.push({ key, x, y, ...opts });
      return { x, y };
    };
    const curve = (a, b) => `M ${a.x} ${a.y} Q ${X_MID} ${yMid} ${b.x} ${b.y}`;
    const straight = (a, b) => `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    const side = (a, b) => `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`;
    // value: Leistung in W (Modus now) bzw. Energie heute (Modus day); > Schwelle = aktiv
    const link = (d, value, color) => links.push({ d, value, color });
    const flow = live ? now : day;
    const threshold = live ? ACTIVE_W : 0.001;

    const home = node("home", X_HOME, yMid, { name: "Haus", icon: "mdi:home", value: fmt(day.home) });
    const grid = c.grid
      ? node("grid", X_GRID, yMid, {
          name: "Netz", icon: "mdi:transmission-tower", color: FLOW_COLORS.grid,
          value: `↓ ${fmt(gridIn)}`,
          sub: [
            c.grid.export ? `↑ ${fmt(gridOut)}` : "",
            Number.isFinite(fossilPct) ? `${this._num(fossilPct, 0)} % fossil` : "",
          ].filter(Boolean),
          entity: live ? p.grid_in || p.grid_net || c.grid.import : c.grid.import,
        })
      : null;
    const pv = c.solar
      ? node("solar", X_MID, yTop, {
          name: "PV", icon: "mdi:solar-power", color: FLOW_COLORS.solar, value: fmt(solar),
          entity: live ? p.solar || c.solar : c.solar,
        })
      : null;
    const showSoc = live && Number.isFinite(soc);
    const bat = c.battery
      ? node("battery", X_MID, yBottom, {
          name: "Batterie",
          icon: showSoc ? batteryIcon(soc) : "mdi:battery-high",
          color: FLOW_COLORS.battery,
          value: `↓ ${fmt(batOut)}`,
          // Aktuell: Akkustand unter den Werten
          sub: [c.battery.in ? `↑ ${fmt(batIn)}` : "", showSoc ? `${this._num(soc, 0)} %` : ""].filter(Boolean),
          entity: live ? c.battery.soc || p.battery_out || p.battery_net || c.battery.out : c.battery.out,
        })
      : null;

    // Teilflüsse: aktuell = Leistung jetzt, heute = Energie seit Mitternacht
    if (grid) link(straight(grid, home), flow.gridToHome, FLOW_COLORS.grid);
    if (pv) link(curve(pv, home), flow.solarToHome, FLOW_COLORS.solar);
    if (pv && grid) link(curve(pv, grid), flow.solarToGrid, FLOW_COLORS.solar);
    if (pv && bat) link(straight(pv, bat), flow.solarToBattery, FLOW_COLORS.solar);
    if (bat) link(curve(bat, home), flow.batteryToHome, FLOW_COLORS.battery);
    if (bat && grid) {
      link(curve(bat, grid), flow.batteryToGrid, FLOW_COLORS.battery);
      link(curve(grid, bat), flow.gridToBattery, FLOW_COLORS.grid);
    }
    if (c.water?.entity) {
      const n = node("water", X_HOME, yTop, {
        name: c.water.name || "Wasser", icon: c.water.icon || "mdi:water", color: FLOW_COLORS.water,
        value: live ? this._fmtState(c.water.rate) : this._fmtAny(c.water.entity),
        entity: live ? c.water.rate || c.water.entity : c.water.entity,
      });
      // aktuell: Durchfluss > 0; heute: Verbrauch > 0 (Wert nur als Schalter für die Animation)
      const waterActive = live ? this._watt(c.water.rate) > 0 : (this._values[c.water.entity] || 0) > 0;
      link(straight(home, n), waterActive ? threshold * 50 : 0, FLOW_COLORS.water);
    }
    consumers.forEach((x, i) => {
      const color = x.color || FLOW_COLORS.consumers[i % FLOW_COLORS.consumers.length];
      const y = yMid + (i - (consumers.length - 1) / 2) * step;
      const n = node(`c${i}`, X_RIGHT, y, {
        name: x.name || this._hass?.states[x.entity]?.attributes?.friendly_name || x.entity,
        icon: x.icon || "mdi:flash", color,
        value: live ? (x.power ? this._fmtPower(this._watt(x.power)) : "–") : this._fmtAny(x.entity),
        entity: live ? x.power || x.entity : x.entity,
      });
      const isEnergy = ["Wh", "kWh", "MWh", ""].includes(this._unit(x.entity));
      const dayValue = isEnergy ? this._kwh(x.entity) || 0 : (this._values[x.entity] || 0) > 0 ? threshold * 50 : 0;
      link(side(home, n), live ? this._watt(x.power) : dayValue, color);
    });

    const maxValue = Math.max(...links.map((l) => l.value), threshold);

    // Ring ums Haus: Anteile der Quellen am Verbrauch
    const shares = [
      { label: "PV", value: day.solarToHome, color: FLOW_COLORS.solar },
      { label: "Batterie", value: day.batteryToHome, color: FLOW_COLORS.battery },
      { label: "Netz CO₂-arm", value: Number.isFinite(fossilPct) ? gridLowCarbon : 0, color: FLOW_COLORS.lowCarbon },
      { label: Number.isFinite(fossilPct) ? "Netz fossil" : "Netz", value: gridFossil, color: FLOW_COLORS.grid },
    ].filter((s) => s.value > 0.0001);
    const ringR = R - 3;
    const circ = 2 * Math.PI * ringR;
    let offset = 0;
    const ring = day.home > 0
      ? shares
          .map((s) => {
            const len = (s.value / day.home) * circ;
            const seg = `<circle cx="${X_HOME}" cy="${yMid}" r="${ringR}" fill="none" stroke="${s.color}" stroke-width="6"
              stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}"
              transform="rotate(-90 ${X_HOME} ${yMid})" />`;
            offset += len;
            return seg;
          })
          .join("")
      : `<circle cx="${X_HOME}" cy="${yMid}" r="${ringR}" fill="none" class="idle-ring" stroke-width="4" />`;
    const legend = this._config.show_legend !== false && day.home > 0
      ? shares
          .map((s) => `<span class="leg"><i style="background:${s.color}"></i>${s.label} ${this._num((s.value / day.home) * 100, 0)} %</span>`)
          .join("")
      : "";

    // Gerüst nur neu bauen, wenn sich Aufbau oder Anordnung ändern; sonst nur Werte
    // aktualisieren (ein komplettes Neuzeichnen lässt die Karte kurz schwarz aufblitzen)
    const shape = [
      W, H, title,
      ...nodes.map((n) => `${n.key}:${n.x},${n.y},${n.color},${(n.sub || []).length},${n.entity}`),
      ...links.map((l) => l.d + l.color),
    ].join("|");
    if (shape !== this._shape) {
      this._shape = shape;
      this._durs = [];
      this._buildSkeleton(title, W, H, R, nodes, links);
    }
    const root = this.shadowRoot;
    nodes.forEach((n, i) => {
      const v = root.getElementById(`v${i}`);
      if (v && v.textContent !== n.value) v.textContent = n.value;
      const icon = root.getElementById(`i${i}`);
      if (icon && icon.getAttribute("icon") !== n.icon) icon.setAttribute("icon", n.icon);
      (n.sub || []).forEach((s, j) => {
        const el = root.getElementById(`s${i}_${j}`);
        if (el && el.textContent !== s) el.textContent = s;
      });
    });
    links.forEach((l, i) => {
      const active = l.value >= threshold;
      const path = root.getElementById(`p${i}`);
      const dot = root.getElementById(`d${i}`);
      if (path) path.setAttribute("class", active ? "line" : "line idle");
      if (dot) dot.style.display = active ? "" : "none";
      // Geschwindigkeit in halben Sekunden, damit die Animation nicht ständig neu startet
      const dur = active ? (Math.round(Math.max(1, 5 - (l.value / maxValue) * 4) * 2) / 2).toFixed(1) : null;
      if (dur && this._durs[i] !== dur) {
        this._durs[i] = dur;
        root.getElementById(`m${i}`)?.setAttribute("dur", `${dur}s`);
      }
    });
    const ringEl = root.getElementById("ring");
    if (ringEl && this._ring !== ring) {
      this._ring = ring;
      ringEl.innerHTML = ring;
    }
    const legendEl = root.getElementById("legend");
    if (legendEl && this._legend !== legend) {
      this._legend = legend;
      legendEl.innerHTML = legend;
      legendEl.style.display = legend ? "" : "none";
    }
  }

  // Statischer Aufbau: SVG für Linien und Ring, Kreise als HTML darüber
  _buildSkeleton(title, W, H, R, nodes, links) {
    this._ring = undefined;
    this._legend = undefined;
    const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
    const paths = links
      .map((l, i) => `
        <path id="p${i}" d="${l.d}" class="line idle" stroke="${l.color}" />
        <circle id="d${i}" r="4" fill="${l.color}" style="display:none">
          <animateMotion id="m${i}" dur="3s" repeatCount="indefinite" path="${l.d}" />
        </circle>`)
      .join("");
    const nodeHtml = nodes
      .map((n, i) => `
        <div class="node ${n.key === "home" ? "home" : ""}" ${n.entity ? `data-entity="${esc(n.entity)}"` : ""}
             style="left:${pct(n.x, W)};top:${pct(n.y, H)};width:${pct(2 * R, W)};--c:${n.color || "var(--primary-text-color)"}">
          <span class="lbl">${esc(n.name)}</span>
          <div class="circle">
            <ha-icon id="i${i}" icon="${esc(n.icon)}"></ha-icon>
            <span id="v${i}" class="val"></span>
            ${(n.sub || []).map((s, j) => `<span id="s${i}_${j}" class="sub"></span>`).join("")}
          </div>
        </div>`)
      .join("");

    // Schriftgrößen in cqw (Anteil der Kartenbreite): Werte passen bei jeder Breite in die Kreise.
    // Davor jeweils ein px-Wert als Rückfall für ältere Browser.
    const cq = (px) => `${((px / W) * 100).toFixed(3)}cqw`;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px 16px; }
        .title { font-size: 1.1em; font-weight: 500; margin-bottom: 4px; }
        .flow { position: relative; width: 100%; aspect-ratio: ${W} / ${H}; container-type: inline-size; }
        svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
        svg.ring { z-index: 2; }
        .line { fill: none; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
        .line.idle { stroke: var(--disabled-text-color, #bdbdbd); opacity: .35; }
        .idle-ring { stroke: var(--disabled-text-color, #bdbdbd); }
        .node { position: absolute; transform: translate(-50%, -50%); aspect-ratio: 1; z-index: 1; }
        .node[data-entity] { cursor: pointer; }
        .circle {
          width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%;
          border: 2px solid var(--c); background: var(--card-background-color, #fff);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; line-height: 1.15; color: var(--primary-text-color); overflow: hidden;
        }
        .home .circle { border-color: transparent; }
        .circle ha-icon {
          display: flex; color: var(--c);
          --mdc-icon-size: 22px; --mdc-icon-size: ${cq(22)};
          margin-bottom: 2px; margin-bottom: ${cq(2)};
        }
        .val { font-weight: 600; white-space: nowrap; font-size: 11.5px; font-size: ${cq(11.5)}; }
        .sub { white-space: nowrap; color: var(--secondary-text-color); font-size: 9px; font-size: ${cq(9)}; }
        .lbl {
          position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); white-space: nowrap;
          color: var(--secondary-text-color); font-size: 11px; font-size: ${cq(11)};
          padding-bottom: 3px; padding-bottom: ${cq(3)};
        }
        .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; justify-content: center; margin-top: 8px; font-size: 12px; }
        .leg { display: inline-flex; align-items: center; gap: 5px; color: var(--secondary-text-color); }
        .leg i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
      </style>
      <ha-card>
        ${title ? `<div class="title">${esc(title)}</div>` : ""}
        <div class="flow">
          <svg class="lines" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${paths}</svg>
          ${nodeHtml}
          <svg class="ring" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g id="ring"></g></svg>
        </div>
        <div id="legend" class="legend" style="display:none"></div>
      </ha-card>`;
  }
}

// Zwei eigene Karten im Kartenauswahl-Dialog (Aktuell / Heute); die allgemeine Karte bleibt kompatibel
class UzEnergyNowCard extends UzEnergyFlowCard {
  static get MODE() {
    return "now";
  }
}

class UzEnergyDayCard extends UzEnergyFlowCard {
  static get MODE() {
    return "day";
  }
}

// ---------- Editor der Energiekarten (Stil wie Power Flow Card Plus: Liste → Unterseiten) ----------

const flowSensor = (name) => ({ name, selector: { entity: { domain: "sensor" } } });

const FLOW_EDITOR_SECTIONS = [
  {
    id: "grid", icon: "mdi:transmission-tower", title: "Netz",
    info: "Bezug und Einspeisung (Tageswerte) kommen aus dem Energie-Dashboard.",
    fields: ["power_grid_in", "power_grid_out", "fossil_entity"],
    schema: () => [flowSensor("power_grid_in"), flowSensor("power_grid_out"), flowSensor("fossil_entity")],
  },
  {
    id: "solar", icon: "mdi:solar-power", title: "Photovoltaik",
    info: "Erzeugung (Tageswert) kommt aus dem Energie-Dashboard.",
    fields: ["power_solar"],
    schema: () => [flowSensor("power_solar")],
  },
  {
    id: "battery", icon: "mdi:battery-high", title: "Batterie",
    info: "Laden und Entladen (Tageswerte) kommen aus dem Energie-Dashboard. Der Akkustand erscheint in der Ansicht „Aktuell“.",
    fields: ["power_battery_in", "power_battery_out", "battery_soc"],
    schema: () => [flowSensor("power_battery_in"), flowSensor("power_battery_out"), flowSensor("battery_soc")],
  },
  {
    id: "water", icon: "mdi:water", title: "Wasser",
    info: "Verbrauch und Durchfluss kommen aus dem Energie-Dashboard.",
    fields: ["show_water"],
    schema: () => [{ name: "show_water", selector: { boolean: {} } }],
  },
  {
    id: "devices", icon: "mdi:devices", title: "Geräte am Haus",
    info: "Geräte aus dem Energie-Dashboard, rechts am Haus. Für die Ansicht „Aktuell“ je Gerät einen Leistungssensor wählen.",
    fields: ["devices"],
    schema: (names, config) => [
      {
        name: "devices",
        selector: {
          select: { multiple: true, reorder: true, custom_value: true, options: names.map((n) => ({ value: n, label: n })) },
        },
      },
      ...((config.devices || []).length
        ? [{
            type: "expandable",
            name: "device_power",
            title: "Aktuelle Leistung je Gerät",
            icon: "mdi:flash",
            schema: config.devices.map((d) => ({ name: String(d), selector: { entity: { domain: "sensor" } } })),
          }]
        : []),
    ],
  },
  {
    id: "extra", icon: "mdi:plus-circle-outline", title: "Weitere Energieträger",
    info: "Zusätzliche Kreise rechts am Haus, z. B. Gas: Liste mit entity, name, icon, color, power.",
    fields: ["extra"],
    schema: () => [{ name: "extra", selector: { object: {} } }],
  },
  {
    id: "display", icon: "mdi:palette-outline", title: "Darstellung",
    info: "",
    fields: ["show_legend", "refresh_interval"],
    schema: () => [
      { name: "show_legend", selector: { boolean: {} } },
      { name: "refresh_interval", selector: { number: { min: 10, max: 3600, step: 10, mode: "box", unit_of_measurement: "s" } } },
    ],
  },
];

const FLOW_LABELS = {
  title: "Titel (leer = Standard)",
  mode: "Ansicht",
  power_grid_in: "Leistung Netzbezug",
  power_grid_out: "Leistung Einspeisung",
  fossil_entity: "Anteil fossiler Energie (CO2 Signal / Electricity Maps)",
  power_solar: "Leistung PV (leer = aus dem Energie-Dashboard)",
  power_battery_in: "Leistung Laden",
  power_battery_out: "Leistung Entladen",
  battery_soc: "Akkustand (%)",
  show_water: "Wasser anzeigen",
  devices: "Geräte (Reihenfolge per Ziehen)",
  extra: "Weitere Energieträger (YAML)",
  show_legend: "Legende mit Anteilen anzeigen",
  refresh_interval: "Tageswerte aktualisieren alle",
};

const FLOW_EDITOR_STYLE = `
  .rows { display: flex; flex-direction: column; margin-top: 8px; border: 1px solid var(--divider-color); border-radius: 12px; overflow: hidden; }
  .row {
    display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer;
    border-bottom: 1px solid var(--divider-color); background: var(--card-background-color);
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--secondary-background-color); }
  .row > ha-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); }
  .row .txt { flex: 1; min-width: 0; }
  .row .head { font-weight: 500; color: var(--primary-text-color); }
  .row .secondary { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .subhead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 16px; font-weight: 500; }
  .back {
    display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%;
    border: none; background: transparent; color: var(--primary-text-color); cursor: pointer;
  }
  .back:hover { background: var(--secondary-background-color); }
  .info { font-size: 12px; color: var(--secondary-text-color); margin: 0 0 12px; }
`;

class UzEnergyFlowCardEditor extends HTMLElement {
  constructor() {
    super();
    this.showMode = false;
    this._section = null; // geöffnete Unterseite
  }

  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      loadEnergyPrefs(hass).then((prefs) => {
        this._deviceNames = (prefs?.device_consumption || []).map((d) => d.name).filter(Boolean);
        this._update(true);
      });
    }
    this._forms().forEach((f) => (f.hass = hass));
  }

  _forms() {
    return [this._mainForm, this._subForm].filter(Boolean);
  }

  _emit(patch) {
    const next = { ...this._config, ...patch };
    Object.keys(next).forEach((k) => (next[k] === undefined || next[k] === "") && delete next[k]);
    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
    this._update();
  }

  _summary(section) {
    const c = this._config || {};
    const name = (id) => this._hass?.states[id]?.attributes?.friendly_name || id;
    switch (section.id) {
      case "grid": return c.power_grid_in ? name(c.power_grid_in) : "Leistungssensoren wählen";
      case "solar": return c.power_solar ? name(c.power_solar) : "Leistung aus dem Energie-Dashboard";
      case "battery": return c.battery_soc ? `Akkustand: ${name(c.battery_soc)}` : "Leistung und Akkustand wählen";
      case "water": return c.show_water === false ? "Ausgeblendet" : "Angezeigt";
      case "devices": return (c.devices || []).length ? c.devices.join(", ") : "Keine Geräte gewählt";
      case "extra": return `${(c.extra || []).length} Einträge`;
      default: return c.show_legend === false ? "Ohne Legende" : "Mit Legende";
    }
  }

  // Aufbau einmalig; danach nur Daten aktualisieren (stabile Elemente, keine verlorenen Klicks)
  _update(schemaChanged = false) {
    if (!this._config) return;
    if (!this._root) {
      this.innerHTML = `<style>${FLOW_EDITOR_STYLE}</style><div class="root"></div>`;
      this._root = this.querySelector(".root");
    }
    const section = FLOW_EDITOR_SECTIONS.find((s) => s.id === this._section);
    const view = section ? `sub:${section.id}` : "main";
    if (view !== this._view) {
      this._view = view;
      this._mainForm = this._subForm = undefined;
      this._root.innerHTML = "";
      if (section) this._buildSub(section);
      else this._buildMain();
    }
    if (section && this._subForm) {
      const key = JSON.stringify([this._deviceNames || [], this._config.devices || []]);
      if (schemaChanged || key !== this._subKey) {
        this._subKey = key;
        this._subForm.schema = section.schema(this._deviceNames || [], this._config);
      }
      this._subForm.data = { show_water: true, show_legend: true, refresh_interval: 60, ...this._config };
    }
    if (!section) {
      if (this._mainForm) this._mainForm.data = { mode: "day", ...this._config };
      this._root.querySelectorAll(".row").forEach((row) => {
        const s = FLOW_EDITOR_SECTIONS.find((x) => x.id === row.dataset.id);
        const sec = row.querySelector(".secondary");
        const text = this._summary(s);
        if (sec.textContent !== text) sec.textContent = text;
      });
    }
  }

  _makeForm(schema) {
    const form = document.createElement("ha-form");
    form.computeLabel = (s) => FLOW_LABELS[s.name] ?? this._hass?.states[s.name]?.attributes?.friendly_name ?? s.name;
    form.schema = schema;
    if (this._hass) form.hass = this._hass;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._emit(ev.detail.value);
    });
    return form;
  }

  _buildMain() {
    this._mainForm = this._makeForm([
      { name: "title", selector: { text: {} } },
      ...(this.showMode
        ? [{
            name: "mode",
            selector: { select: { mode: "dropdown", options: [{ value: "now", label: "Aktuell" }, { value: "day", label: "Heute" }] } },
          }]
        : []),
    ]);
    const rows = document.createElement("div");
    rows.className = "rows";
    rows.innerHTML = FLOW_EDITOR_SECTIONS.map((s) => `
      <div class="row" data-id="${s.id}">
        <ha-icon icon="${s.icon}"></ha-icon>
        <div class="txt"><div class="head">${esc(s.title)}</div><div class="secondary"></div></div>
        <ha-icon icon="mdi:chevron-right"></ha-icon>
      </div>`).join("");
    rows.addEventListener("click", (ev) => {
      const row = ev.target.closest?.(".row");
      if (!row) return;
      this._section = row.dataset.id;
      this._update();
    });
    this._root.append(this._mainForm, rows);
  }

  _buildSub(section) {
    const head = document.createElement("div");
    head.className = "subhead";
    head.innerHTML = `<button class="back" title="Zurück"><ha-icon icon="mdi:arrow-left"></ha-icon></button>
      <ha-icon icon="${section.icon}"></ha-icon><span>${esc(section.title)}</span>`;
    head.querySelector(".back").addEventListener("click", () => {
      this._section = null;
      this._update();
    });
    this._root.append(head);
    if (section.info) {
      const info = document.createElement("p");
      info.className = "info";
      info.textContent = section.info;
      this._root.append(info);
    }
    this._subKey = undefined;
    this._subForm = this._makeForm(section.schema(this._deviceNames || [], this._config));
    this._root.append(this._subForm);
  }
}

if (!customElements.get("uz-energy-flow-card-editor")) {
  customElements.define("uz-energy-flow-card-editor", UzEnergyFlowCardEditor);
}
if (!customElements.get("uz-energy-flow-card")) {
  customElements.define("uz-energy-flow-card", UzEnergyFlowCard);
  customElements.define("uz-energy-now-card", UzEnergyNowCard);
  customElements.define("uz-energy-day-card", UzEnergyDayCard);
  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: "uz-energy-now-card",
      name: "UZ Energiefluss – Aktuell",
      description: "Aktuelle Leistung mit Akkustand: Netz, PV, Batterie, Wasser und Geräte (Quellen aus dem Energie-Dashboard)",
      preview: true,
    },
    {
      type: "uz-energy-day-card",
      name: "UZ Energiefluss – Heute",
      description: "Energie seit Mitternacht mit Anteilen der Quellen (Quellen aus dem Energie-Dashboard)",
      preview: true,
    }
  );
}

const SYSTEM_LEVELS = {
  ok: { color: "#22c55e", label: "Alles in Ordnung", icon: "mdi:check-circle" },
  warn: { color: "#f59e0b", label: "Hinweise", icon: "mdi:alert" },
  bad: { color: "#ef4444", label: "Handlungsbedarf", icon: "mdi:alert-octagon" },
};
const LEVEL_ORDER = ["ok", "warn", "bad"];
const worst = (...levels) => levels.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a), "ok");

// Bewertung aus Zuständen + Reparaturen (reine Funktion, testbar). Protokollfehler zählen nur zur Info, nicht zur Farbe.
function systemStatus(hass, config, extra = {}) {
  const num = (id) => (id ? parseFloat(hass?.states?.[id]?.state) : NaN);
  const score = num(config.score);
  const updates = Object.values(hass?.states || {}).filter(
    (s) => s.entity_id.startsWith("update.") && s.state === "on" && !hass?.entities?.[s.entity_id]?.hidden,
  );
  const repairs = (extra.repairs || []).filter((i) => !i.ignored && !i.dismissed_version);
  const errors = extra.errors ?? 0;
  const busy = ["cpu", "ram", "disk"].filter((k) => num(config[k]) >= 90);
  const reasons = [];
  let level = "ok";
  if (Number.isFinite(score)) {
    const l = score >= 80 ? "ok" : score >= 60 ? "warn" : "bad";
    level = worst(level, l);
    if (l !== "ok") reasons.push(`Score ${Math.round(score)}`);
  }
  if (updates.length) {
    level = worst(level, "warn");
    reasons.push(`${updates.length} ${updates.length === 1 ? "Update" : "Updates"}`);
  }
  if (repairs.length) {
    level = worst(level, repairs.some((i) => ["error", "critical"].includes(i.severity)) ? "bad" : "warn");
    reasons.push(`${repairs.length} ${repairs.length === 1 ? "Reparatur" : "Reparaturen"}`);
  }
  if (busy.length) {
    level = worst(level, "warn");
    reasons.push(`${busy.map((k) => ({ cpu: "CPU", ram: "RAM", disk: "Speicher" })[k]).join(", ")} über 90 %`);
  }
  return { level, score, updates, repairs, errors, reasons };
}

// Navigation innerhalb des Dashboards (wie HA selbst)
function uzNavigate(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

class UzSystemStatusCard extends HTMLElement {
  static getStubConfig() {
    return { mode: "tile" };
  }

  setConfig(config) {
    this._config = { mode: "tile", ...config };
    this._sig = undefined;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._polled) this._poll();
    this._render();
  }

  connectedCallback() {
    this._timer = setInterval(() => this._poll(), 60000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return this._config?.mode === "full" ? 6 : 1;
  }

  getGridOptions() {
    return this._config?.mode === "full" ? { columns: "full", rows: "auto" } : { columns: "full", rows: 1 };
  }

  // Reparaturen und Protokoll gibt es nur über WebSocket (für Administratoren)
  async _poll() {
    if (!this._hass) return;
    this._polled = true;
    const [repairs, log] = await Promise.all([
      this._hass.callWS({ type: "repairs/list_issues" }).then((r) => r?.issues || []).catch(() => undefined),
      this._hass.callWS({ type: "system_log/list" }).catch(() => undefined),
    ]);
    this._extra = {
      repairs: repairs || [],
      errors: Array.isArray(log) ? log.filter((e) => e.level === "ERROR" || e.level === "CRITICAL").length : 0,
      admin: repairs !== undefined,
    };
    this._render();
  }

  _base() {
    const first = window.location.pathname.split("/").filter(Boolean)[0] || "lovelace";
    return `/${first}`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const st = systemStatus(this._hass, this._config, this._extra);
    const full = this._config.mode === "full";
    const sig = JSON.stringify([full, st.level, st.score, st.reasons, st.updates.map((u) => u.entity_id), st.repairs.map((r) => r.issue_id),
      full ? ["cpu", "ram", "disk"].map((k) => this._hass.states[this._config[k]]?.state) : 0]);
    if (sig === this._sig) return;
    this._sig = sig;
    const lv = SYSTEM_LEVELS[st.level];
    const scoreText = Number.isFinite(st.score) ? `${Math.round(st.score)}` : "–";
    const sub = st.reasons.length ? st.reasons.join(" · ") : lv.label;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const style = `<style>
      :host { display: block; }
      ha-card { overflow: hidden; }
      .tile { display: flex; align-items: center; gap: 12px; padding: 0 12px; cursor: pointer; height: 54px; box-sizing: border-box;
        background: color-mix(in srgb, var(--c) 10%, transparent); }
      .bubble { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none;
        background: color-mix(in srgb, var(--c) 20%, transparent); color: var(--c); }
      .bubble ha-icon { --mdc-icon-size: 22px; }
      .txt { flex: 1; min-width: 0; }
      .t { font-weight: 500; font-size: 14px; }
      .s { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .score { font-size: 18px; font-weight: 700; color: var(--c); }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent); }
      .full { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
      .hero { display: flex; align-items: center; gap: 16px; }
      .ring { width: 84px; height: 84px; flex: none; }
      .ring text { font-size: 26px; font-weight: 700; fill: var(--primary-text-color); }
      .lvl { font-size: 18px; font-weight: 600; color: var(--c); }
      .parts { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; }
      .rows { display: flex; flex-direction: column; border-radius: 12px; border: 1px solid var(--divider-color); overflow: hidden; }
      .row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; }
      .row + .row { border-top: 1px solid var(--divider-color); }
      .row:hover { background: var(--secondary-background-color); }
      .row ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
      .row .n { font-weight: 600; }
      .row.on ha-icon, .row.on .n { color: ${SYSTEM_LEVELS.warn.color}; }
      .list { font-size: 12px; color: var(--secondary-text-color); }
    </style>`;
    if (!full) {
      this.shadowRoot.innerHTML = `${style}
        <ha-card style="--c:${lv.color}">
          <div class="tile" id="go">
            <div class="bubble"><ha-icon icon="mdi:server"></ha-icon></div>
            <div class="txt"><div class="t">${esc(this._config.title || "System")}</div><div class="s">${esc(sub)}</div></div>
            ${Number.isFinite(st.score) ? `<div class="score">${scoreText}</div>` : ""}
            <div class="dot" title="${esc(lv.label)}"></div>
          </div>
        </ha-card>`;
      this.shadowRoot.getElementById("go").onclick = () => uzNavigate(`${this._base()}/${SYSTEM_PATH}`);
      return;
    }
    const attrs = this._hass.states[this._config.score]?.attributes || {};
    const parts = [attrs.hardware_score != null ? `Hardware ${attrs.hardware_score}` : "", attrs.application_score != null ? `Anwendung ${attrs.application_score}` : ""]
      .filter(Boolean).join(" · ");
    const pct = Number.isFinite(st.score) ? Math.max(0, Math.min(100, st.score)) : 0;
    const C = 2 * Math.PI * 34;
    const row = (id, icon, label, n, list, on) => `
      <div class="row${on ? " on" : ""}" data-go="${id}">
        <ha-icon icon="${icon}"></ha-icon>
        <div class="txt"><div>${esc(label)}</div>${list ? `<div class="list">${esc(list)}</div>` : ""}</div>
        <span class="n">${esc(String(n))}</span>
      </div>`;
    const name = (s) => s.attributes?.title || s.attributes?.friendly_name || s.entity_id;
    const admin = this._extra?.admin !== false;
    this.shadowRoot.innerHTML = `${style}
      <ha-card style="--c:${lv.color}">
        <div class="full">
          <div class="hero">
            <svg class="ring" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--divider-color)" stroke-width="8"/>
              <circle cx="42" cy="42" r="34" fill="none" stroke="${lv.color}" stroke-width="8" stroke-linecap="round"
                stroke-dasharray="${(C * pct) / 100} ${C}" transform="rotate(-90 42 42)"/>
              <text x="42" y="51" text-anchor="middle">${scoreText}</text>
            </svg>
            <div>
              <div class="lvl">${esc(lv.label)}</div>
              <div class="parts">${esc(parts || (Number.isFinite(st.score) ? "Global Health Score" : "Ohne Global Health Score"))}</div>
            </div>
          </div>
          <div class="rows">
            ${row("updates", "mdi:package-up", "Updates", st.updates.length, st.updates.map(name).join(", "), st.updates.length)}
            ${admin ? row("repairs", "mdi:tools", "Reparaturen", st.repairs.length,
              st.repairs.map((i) => `${i.domain}: ${String(i.translation_key || i.issue_id).replace(/_/g, " ")}`).join(", "), st.repairs.length) : ""}
            ${admin ? row("logs", "mdi:file-alert-outline", "Fehler im Protokoll", st.errors, "zählt nicht zum Status", false) : ""}
          </div>
        </div>
      </ha-card>`;
    const targets = { updates: "/config/updates", repairs: "/config/repairs", logs: "/config/logs" };
    this.shadowRoot.querySelectorAll("[data-go]").forEach((el) => (el.onclick = () => uzNavigate(targets[el.dataset.go])));
  }
}

if (!customElements.get("uz-system-status-card")) {
  customElements.define("uz-system-status-card", UzSystemStatusCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "uz-system-status-card",
    name: "UZ System-Status",
    description: "Zustand des Home-Assistant-Servers mit Farbindex (Score, Updates, Reparaturen, Fehler).",
    preview: true,
  });
}

// ---------- Zombies: nicht verfügbare Entitäten, nach Integration und Gerät gruppiert ----------
// Gleiche Regeln wie „Home Assistant Global Health Score“: bestimmte Domains, Zustand
// unavailable/unknown seit mehr als 5 Minuten, nicht deaktiviert, ohne Ignorier-Label
// (an der Entität oder am Gerät). Aktionen: Label setzen (ignorieren) oder löschen.

const ZOMBIE_DOMAINS = new Set([
  "alarm_control_panel", "binary_sensor", "camera", "climate", "cover", "device_tracker", "fan", "humidifier",
  "lawn_mower", "light", "lock", "media_player", "number", "remote", "select", "sensor", "siren", "switch",
  "text", "vacuum", "valve", "water_heater",
]);
const ZOMBIE_GRACE_MS = 5 * 60 * 1000;

// Reine Funktion (testbar): Zombies gruppieren
function groupZombies(hass, reg, devices, entries, label, now = Date.now()) {
  const devById = Object.fromEntries(devices.map((d) => [d.id, d]));
  const entryById = Object.fromEntries(entries.map((e) => [e.entry_id, e]));
  const regById = Object.fromEntries(reg.map((e) => [e.entity_id, e]));
  const groups = {};
  for (const st of Object.values(hass.states)) {
    const domain = st.entity_id.split(".")[0];
    if (!ZOMBIE_DOMAINS.has(domain) || !["unavailable", "unknown"].includes(st.state)) continue;
    if (now - new Date(st.last_changed).getTime() < ZOMBIE_GRACE_MS) continue;
    const e = regById[st.entity_id];
    if (e?.disabled_by) continue;
    const dev = e?.device_id ? devById[e.device_id] : undefined;
    if (e?.labels?.includes(label) || dev?.labels?.includes(label)) continue;
    const entry = e?.config_entry_id ? entryById[e.config_entry_id] : undefined;
    // Eine Gruppe je Integration; darin je Gerät (ohne Gerät: je Eintrag, z. B. powercalc)
    const key = e?.platform || "unbekannt";
    const g = (groups[key] ||= { key, platform: key, titles: new Set(), states: new Set(), devices: {}, count: 0 });
    g.titles.add(entry?.title || (e ? "YAML / ohne Eintrag" : "ohne Registry-Eintrag"));
    if (entry && entry.state !== "loaded") g.states.add(entry.disabled_by ? "deaktiviert" : entry.state);
    const dkey = dev?.id || `entry:${entry?.entry_id || ""}`;
    const gd = (g.devices[dkey] ||= {
      key: dkey,
      id: dev?.id,
      entry: entry?.entry_id,
      name: dev ? dev.name_by_user || dev.name : entry?.title || "Ohne Gerät",
      entities: [],
    });
    gd.entities.push({ entity_id: st.entity_id, name: st.attributes.friendly_name || st.entity_id, state: st.state, registered: !!e });
    g.count++;
  }
  return Object.values(groups)
    .map((g) => {
      const titles = [...g.titles];
      return {
        ...g,
        title: titles.length > 2 ? `${titles.length} Einträge` : titles.join(", "),
        entryState: [...g.states].join(", "),
        devices: Object.values(g.devices).sort((a, b) => b.entities.length - a.entities.length),
      };
    })
    .sort((a, b) => b.count - a.count);
}

class UzZombieCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = { ignore_label: "haghs_ignore", ...config };
    this._open = this._open || new Set();
    this._selected = this._selected || new Set(); // "gruppe::gerät"
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  connectedCallback() {
    this._timer = setInterval(() => this._load(), 5 * 60 * 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  async _load() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      const [reg, devices, entries] = await Promise.all([
        this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.callWS({ type: "config/device_registry/list" }),
        this._hass.callWS({ type: "config_entries/get" }),
      ]);
      this._groups = groupZombies(this._hass, reg, devices, entries, this._config.ignore_label);
      this._devices = devices;
      this._reg = reg;
      this._entries = Object.fromEntries(entries.map((e) => [e.entry_id, e]));
      // Auswahl auf noch vorhandene Einträge beschränken
      const valid = new Set(this._groups.flatMap((g) => g.devices.map((d) => `${g.key}::${d.key}`)));
      this._selected = new Set([...this._selected].filter((k) => valid.has(k)));
      this._error = undefined;
    } catch (e) {
      this._error = "Nur für Administratoren sichtbar.";
    }
    this._loading = false;
    this._render();
  }

  _device(gKey, dKey) {
    return this._groups?.find((g) => g.key === gKey)?.devices.find((d) => d.key === dKey);
  }

  // Ziele einer Aktion: eine Integration, ein Gerät oder die Auswahl
  _targets(scope, gKey, dKey) {
    if (scope === "selection") return [...this._selected].map((k) => this._device(...k.split("::"))).filter(Boolean);
    const g = this._groups.find((x) => x.key === gKey);
    if (!g) return [];
    return dKey === undefined ? g.devices : g.devices.filter((d) => d.key === dKey);
  }

  async _ensureLabel() {
    const label = this._config.ignore_label;
    const labels = await this._hass.callWS({ type: "config/label_registry/list" });
    if (!labels.some((l) => l.label_id === label)) {
      await this._hass.callWS({ type: "config/label_registry/create", name: label, icon: "mdi:eye-off-outline" });
    }
  }

  async _ignore(targets) {
    const label = this._config.ignore_label;
    await this._ensureLabel();
    for (const d of targets) {
      if (d.id) {
        const dev = this._devices.find((x) => x.id === d.id);
        if (dev && !dev.labels.includes(label)) {
          await this._hass.callWS({ type: "config/device_registry/update", device_id: d.id, labels: [...dev.labels, label] });
        }
      } else {
        for (const e of d.entities.filter((x) => x.registered)) {
          const r = this._reg.find((x) => x.entity_id === e.entity_id);
          await this._hass.callWS({ type: "config/entity_registry/update", entity_id: e.entity_id, labels: [...(r?.labels || []), label] });
        }
      }
    }
    return [];
  }

  async _removeEntities(d) {
    for (const e of d.entities.filter((x) => x.registered)) {
      await this._hass.callWS({ type: "config/entity_registry/remove", entity_id: e.entity_id }).catch(() => {});
    }
  }

  // Liefert Hinweise zu Geräten, deren Integration das Löschen ablehnt
  async _delete(targets) {
    const refused = [];
    for (const d of targets) {
      const entry = d.entry && this._entries?.[d.entry];
      if (d.id && entry?.supports_remove_device) {
        const ok = await this._hass
          .callWS({ type: "config/device_registry/remove_config_entry", device_id: d.id, config_entry_id: d.entry })
          .then(() => true)
          .catch(() => false);
        // Abgelehnt: Gerät ist bei der Integration noch aktiv – Entitäten würden zurückkommen
        if (!ok) refused.push(d.name);
      } else {
        // Integration kann keine Geräte löschen (oder kein Gerät): Entitäten entfernen
        await this._removeEntities(d);
      }
    }
    return refused;
  }

  async _onClick(ev) {
    const sel = ev.target.closest("[data-sel]");
    if (sel) {
      ev.stopPropagation();
      this._toggleSelect(sel.dataset.sel, sel.dataset.g);
      return;
    }
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    ev.stopPropagation();
    const { act, g, d } = btn.dataset;
    const scope = btn.dataset.scope || "item";
    if (act === "toggle") {
      this._open.has(g) ? this._open.delete(g) : this._open.add(g);
      this._render();
      return;
    }
    if (act === "refresh") return this._load();
    if (act === "clear") {
      this._selected.clear();
      this._render();
      return;
    }
    if (act === "more") {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: btn.dataset.entity }, bubbles: true, composed: true }));
      return;
    }
    const id = `${act}:${scope}:${g ?? ""}:${d ?? "*"}`;
    // Löschen: erster Klick fragt nach (10 s), zweiter Klick führt aus
    if (act === "delete" && this._confirm !== id) {
      this._confirm = id;
      clearTimeout(this._confirmTimer);
      this._confirmTimer = setTimeout(() => {
        this._confirm = undefined;
        this._render();
      }, 10000);
      this._render();
      return;
    }
    this._confirm = undefined;
    this._busy = id;
    this._message = undefined;
    this._render();
    const targets = this._targets(scope, g, d);
    try {
      const refused = act === "ignore" ? await this._ignore(targets) : await this._delete(targets);
      if (refused.length) {
        this._message = `Nicht gelöscht – die Integration verwaltet diese Geräte noch: ${refused.join(", ")}. Gerät zuerst entfernen bzw. abmelden oder „Ignorieren“ nutzen.`;
      }
      if (scope === "selection") this._selected.clear();
    } finally {
      this._busy = undefined;
      await this._load();
    }
  }

  // Kontrollkästchen: Gerät oder ganze Integration
  _toggleSelect(kind, gKey) {
    const g = this._groups.find((x) => x.key === gKey);
    if (!g) return;
    if (kind === "group") {
      const keys = g.devices.map((d) => `${g.key}::${d.key}`);
      const all = keys.every((k) => this._selected.has(k));
      keys.forEach((k) => (all ? this._selected.delete(k) : this._selected.add(k)));
    } else {
      this._selected.has(kind) ? this._selected.delete(kind) : this._selected.add(kind);
    }
    this._render();
  }

  _buttons(scope, g, d) {
    const attrs = `data-scope="${scope}"${g !== undefined ? ` data-g="${esc(g)}"` : ""}${d !== undefined ? ` data-d="${esc(d)}"` : ""}`;
    const id = (act) => `${act}:${scope}:${g ?? ""}:${d ?? "*"}`;
    const busy = this._busy && (this._busy === id("ignore") || this._busy === id("delete"));
    const ask = this._confirm === id("delete");
    return `<span class="acts">
      <button class="b" data-act="ignore" ${attrs} title="Label „${esc(this._config.ignore_label)}“ setzen"${busy ? " disabled" : ""}>
        <ha-icon icon="mdi:eye-off-outline"></ha-icon><span>Ignorieren</span></button>
      <button class="b del${ask ? " confirm" : ""}" data-act="delete" ${attrs}${busy ? " disabled" : ""}>
        <ha-icon icon="mdi:delete-outline"></ha-icon><span>${ask ? "Wirklich löschen?" : "Löschen"}</span></button>
    </span>`;
  }

  _check(state, attrs) {
    const icon = state === "all" ? "mdi:checkbox-marked" : state === "some" ? "mdi:minus-box" : "mdi:checkbox-blank-outline";
    return `<button class="chk${state !== "none" ? " on" : ""}" ${attrs} title="Auswählen"><ha-icon icon="${icon}"></ha-icon></button>`;
  }

  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    }
    const groups = this._groups || [];
    const total = groups.reduce((a, g) => a + g.count, 0);
    const icon = (p) => `https://brands.home-assistant.io/_/${encodeURIComponent(p)}/icon.png`;
    const selCount = this._selected.size;
    const selEntities = [...this._selected].reduce((a, k) => a + (this._device(...k.split("::"))?.entities.length || 0), 0);
    this.shadowRoot.innerHTML = `<style>
      ha-card { padding: 12px 0; }
      .head { display: flex; align-items: center; gap: 10px; padding: 0 16px 8px; }
      .head .t { flex: 1; font-weight: 600; }
      .head .s { font-size: 12px; color: var(--secondary-text-color); font-weight: 400; }
      .bar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 12px 8px;
        padding: 8px 12px; border-radius: 12px; background: color-mix(in srgb, var(--primary-color) 14%, var(--card-background-color)); }
      .bar .t { flex: 1; font-weight: 500; }
      .msg { margin: 0 16px 8px; padding: 8px 12px; border-radius: 10px; font-size: 13px;
        background: color-mix(in srgb, var(--warning-color, #f59e0b) 16%, transparent); }
      .grp { border-top: 1px solid var(--divider-color); }
      .row { display: flex; align-items: center; gap: 10px; padding: 8px 16px 8px 8px; flex-wrap: wrap; }
      .row.g { cursor: pointer; }
      .row.g:hover { background: var(--secondary-background-color); }
      .row img { width: 24px; height: 24px; border-radius: 6px; flex: none; }
      .txt { flex: 1; min-width: 140px; }
      .n { font-weight: 500; }
      .sub { font-size: 12px; color: var(--secondary-text-color); }
      .cnt { min-width: 28px; text-align: center; font-weight: 600; border-radius: 10px; padding: 1px 8px;
        background: color-mix(in srgb, var(--warning-color, #f59e0b) 18%, transparent); color: var(--warning-color, #f59e0b); }
      .dev { padding-left: 40px; }
      .dev.sel { background: color-mix(in srgb, var(--primary-color) 8%, transparent); }
      .ents { padding: 0 16px 6px 82px; font-size: 12px; color: var(--secondary-text-color); display: flex; flex-wrap: wrap; gap: 4px 10px; }
      .ents a { cursor: pointer; color: inherit; text-decoration: underline dotted; }
      .acts { display: inline-flex; gap: 6px; }
      .b { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border-radius: 14px; cursor: pointer; font-size: 12px;
        border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); }
      .b ha-icon { --mdc-icon-size: 16px; }
      .b.del { border-color: var(--error-color, #db4437); color: var(--error-color, #db4437); }
      .b.del.confirm { background: var(--error-color, #db4437); color: #fff; }
      .b[disabled] { opacity: .5; cursor: progress; }
      .chk { border: none; background: transparent; cursor: pointer; padding: 4px; color: var(--secondary-text-color); display: inline-flex; }
      .chk.on { color: var(--primary-color); }
      .chk ha-icon { --mdc-icon-size: 22px; }
      .chev { --mdc-icon-size: 20px; color: var(--secondary-text-color); transition: transform .2s; }
      .open .chev { transform: rotate(90deg); }
      .empty { padding: 8px 16px; color: var(--secondary-text-color); }
    </style>
    <ha-card>
      <div class="head">
        <div class="t">${total} ${total === 1 ? "Zombie" : "Zombies"} <div class="s">nicht verfügbar oder unbekannt seit mehr als 5 Minuten · Kästchen anklicken, um mehrere auf einmal zu bearbeiten</div></div>
        <button class="b" data-act="refresh" title="Neu laden"><ha-icon icon="mdi:refresh"></ha-icon></button>
      </div>
      ${selCount
        ? `<div class="bar"><span class="t">${selCount} ${selCount === 1 ? "Gerät" : "Geräte"} ausgewählt · ${selEntities} Entitäten</span>
            ${this._buttons("selection")}
            <button class="b" data-act="clear">Auswahl aufheben</button></div>`
        : ""}
      ${this._message ? `<div class="msg">${esc(this._message)}</div>` : ""}
      ${this._error ? `<div class="empty">${esc(this._error)}</div>` : ""}
      ${!this._error && !this._groups ? `<div class="empty">Wird geladen …</div>` : ""}
      ${!this._error && this._groups && !groups.length ? `<div class="empty">Keine Zombies – alles erreichbar. 🎉</div>` : ""}
      ${groups
        .map((g) => {
          const open = this._open.has(g.key);
          const keys = g.devices.map((d) => `${g.key}::${d.key}`);
          const n = keys.filter((k) => this._selected.has(k)).length;
          const state = n === 0 ? "none" : n === keys.length ? "all" : "some";
          return `<div class="grp${open ? " open" : ""}">
            <div class="row g" data-act="toggle" data-g="${esc(g.key)}">
              ${this._check(state, `data-sel="group" data-g="${esc(g.key)}"`)}
              <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
              <img src="${icon(g.platform)}" alt="" onerror="this.style.visibility='hidden'">
              <div class="txt"><div class="n">${esc(g.platform)}</div><div class="sub">${esc(g.title)}${g.entryState ? ` · ${esc(g.entryState)}` : ""} · ${g.devices.length} ${g.devices.length === 1 ? "Gerät" : "Geräte"}</div></div>
              <span class="cnt">${g.count}</span>
              ${this._buttons("item", g.key)}
            </div>
            ${open
              ? g.devices
                  .map((d) => {
                    const k = `${g.key}::${d.key}`;
                    const on = this._selected.has(k);
                    return `
                <div class="row dev${on ? " sel" : ""}">
                  ${this._check(on ? "all" : "none", `data-sel="${esc(k)}" data-g="${esc(g.key)}"`)}
                  <div class="txt"><div class="n">${esc(d.name)}</div></div>
                  <span class="cnt">${d.entities.length}</span>
                  ${this._buttons("item", g.key, d.key)}
                </div>
                <div class="ents">${d.entities
                  .slice(0, 12)
                  .map((e) => `<a data-act="more" data-entity="${esc(e.entity_id)}" title="${esc(e.entity_id)}">${esc(e.name)}</a>`)
                  .join("")}${d.entities.length > 12 ? `<span>… +${d.entities.length - 12}</span>` : ""}</div>`;
                  })
                  .join("")
              : ""}
          </div>`;
        })
        .join("")}
    </ha-card>`;
  }
}

if (!customElements.get("uz-zombie-card")) {
  customElements.define("uz-zombie-card", UzZombieCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "uz-zombie-card",
    name: "UZ Zombies",
    description: "Nicht verfügbare Entitäten nach Integration und Gerät – ignorieren oder löschen.",
  });
}

// ---------- Karte: uz-collapsible-card ----------
// Einklappbarer Abschnitt: Kopfzeile (Titel, Icon, optional Wert) + Unterkarten.
// Zustand je Gerät in localStorage; ohne gespeicherten Zustand auf dem Handy zugeklappt.
// config: { key, title, icon, state_entity, collapse_on_mobile, cards: [...] }

class UzCollapsibleCard extends HTMLElement {
  setConfig(config) {
    if (!Array.isArray(config.cards)) throw new Error("cards fehlt");
    this._config = config;
    this._storageKey = `uz-collapse-${config.key || config.title}`;
    let stored = null;
    try {
      stored = localStorage.getItem(this._storageKey);
    } catch (e) {
      stored = null;
    }
    const mobile = window.matchMedia?.("(max-width: 767px)").matches;
    this._open = stored != null ? stored === "1" : !(config.collapse_on_mobile !== false && mobile);
    this._build();
  }

  async _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        .head {
          display: flex; align-items: center; gap: 8px; padding: 6px 4px; cursor: pointer;
          font-size: 16px; font-weight: 500; color: var(--primary-text-color); user-select: none;
        }
        .head ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
        .title { flex: 1; }
        .state { font-size: 14px; font-weight: 400; color: var(--secondary-text-color); }
        .chev { transition: transform .2s; }
        :host([open]) .chev { transform: rotate(180deg); }
        .body { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
        :host(:not([open])) .body { display: none; }
      </style>
      <div class="head">
        ${this._config.icon ? `<ha-icon icon="${esc(this._config.icon)}"></ha-icon>` : ""}
        <span class="title">${esc(this._config.title)}</span>
        <span class="state"></span>
        <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
      </div>
      <div class="body"></div>`;
    this.toggleAttribute("open", this._open);
    this.shadowRoot.querySelector(".head").addEventListener("click", () => {
      this._open = !this._open;
      this.toggleAttribute("open", this._open);
      try {
        localStorage.setItem(this._storageKey, this._open ? "1" : "0");
      } catch (e) {
        // Speicher nicht verfügbar: Zustand gilt nur bis zum Neuladen
      }
    });
    const helpers = await window.loadCardHelpers();
    const body = this.shadowRoot.querySelector(".body");
    this._cards = this._config.cards.map((cfg) => {
      const el = helpers.createCardElement(cfg);
      if (this._hass) el.hass = this._hass;
      body.appendChild(el);
      return el;
    });
  }

  set hass(hass) {
    this._hass = hass;
    (this._cards || []).forEach((el) => (el.hass = hass));
    const id = this._config?.state_entity;
    const stateEl = this.shadowRoot?.querySelector(".state");
    if (id && stateEl && hass.states[id]) stateEl.textContent = hass.formatEntityState?.(hass.states[id]) ?? hass.states[id].state;
  }

  getCardSize() {
    return this._open ? 6 : 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }
}

if (!customElements.get("uz-collapsible-card")) {
  customElements.define("uz-collapsible-card", UzCollapsibleCard);
}

// ---------- Karte: uz-badge-row ----------
// Zentrierte Badge-Leiste im HA-Badge-Stil (Header Reihe 2).
// config: { entities: [...], actions: { "<entity_id>": <tap_action> }, names: { "<entity_id>": "Name" } }
// ohne Aktion: Details anzeigen; ohne eigenen Namen: Name der Entität

class UzBadgeRow extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._sig = "";
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => {
        const el = ev.composedPath().find((n) => n.dataset?.entity);
        if (!el) return;
        const id = el.dataset.entity;
        const action = this._config.actions?.[id] || { action: "more-info" };
        // HA führt die Aktion aus (toggle, navigate, perform-action, more-info, url …)
        this.dispatchEvent(
          new CustomEvent("hass-action", {
            detail: { config: { entity: id, tap_action: action }, action: "tap" },
            bubbles: true,
            composed: true,
          })
        );
      });
    }
  }

  set hass(hass) {
    this._hass = hass;
    const ids = this._config?.entities || [];
    // Nur neu zeichnen, wenn sich einer der Zustände geändert hat
    const names = this._config?.names || {};
    const sig = ids.map((id) => hass.states[id]?.last_updated).join("|") + JSON.stringify(names);
    if (sig === this._sig) return;
    this._sig = sig;
    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding: 4px 0; }
        .badge {
          display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 10px; box-sizing: border-box;
          border-radius: 18px; cursor: pointer; background: var(--ha-card-background, var(--card-background-color));
          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color));
          box-shadow: var(--ha-card-box-shadow, none);
        }
        .badge ha-state-icon { --mdc-icon-size: 18px; color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .txt { display: flex; flex-direction: column; line-height: 1.1; }
        .name { font-size: 10px; color: var(--secondary-text-color); }
        .state { font-size: 12px; font-weight: 500; color: var(--primary-text-color); }
      </style>
      <div class="row"></div>`;
    const row = this.shadowRoot.querySelector(".row");
    ids.forEach((id) => {
      const st = hass.states[id];
      if (!st) return;
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.dataset.entity = id;
      const icon = document.createElement("ha-state-icon");
      icon.hass = hass;
      icon.stateObj = st;
      const txt = document.createElement("div");
      txt.className = "txt";
      txt.innerHTML = `<span class="name">${esc(String(names[id] || "").trim() || st.attributes.friendly_name || id)}</span>
        <span class="state">${esc(hass.formatEntityState?.(st) ?? st.state)}</span>`;
      badge.append(icon, txt);
      row.appendChild(badge);
    });
  }

  getCardSize() {
    return 1;
  }
}

if (!customElements.get("uz-badge-row")) {
  customElements.define("uz-badge-row", UzBadgeRow);
}

// ---------- Karte: uz-spacer-card ----------
// Leere Zelle im Raster (Platzhalter), damit die Zeilen ausgerichtet bleiben

class UzSpacerCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this.style.display = "block";
    this.style.minHeight = `${config.height || 0}px`;
  }

  set hass(hass) {}

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }
}

if (!customElements.get("uz-spacer-card")) {
  customElements.define("uz-spacer-card", UzSpacerCard);
}

// ---------- Karte: uz-camera-grid-card (Videoüberwachung) ----------
// Je Kamera: Name oben, darunter das Live-Bild (HA-eigene picture-entity, Stream wie im Dashboard).
// config: { title, cameras: ["camera.x" | { entity, name, wide }], columns, live, aspect_ratio }
// Ohne Auswahl werden alle Kameras gezeigt. Anordnung im Editor per Ziehen oder Antippen.

const cameraItems = (config, hass) => {
  const list = Array.isArray(config.cameras) && config.cameras.length
    ? config.cameras
    : Object.keys(hass?.states || {}).filter((id) => id.startsWith("camera.") && !hass.entities?.[id]?.hidden).sort();
  return list.map((c) => (typeof c === "string" ? { entity: c } : { ...c })).filter((c) => c.entity);
};

// Bewegungs- und Personenmelder am selben Gerät wie die Kamera
const MOTION_CLASSES = ["motion", "occupancy", "presence", "moving"];
function cameraSensors(hass, camera) {
  const dev = hass?.entities?.[camera]?.device_id;
  if (!dev) return [];
  return Object.values(hass.entities)
    .filter((e) => e.device_id === dev && e.entity_id.startsWith("binary_sensor.") && !e.hidden)
    .map((e) => e.entity_id)
    .filter((id) => MOTION_CLASSES.includes(hass.states[id]?.attributes?.device_class) || /_(motion|person|bewegung)(_\d+)?$/.test(id));
}

// "person", "motion" oder undefined (nichts erkannt)
function cameraActivity(hass, camera) {
  const on = cameraSensors(hass, camera).filter((id) => hass.states[id]?.state === "on");
  if (!on.length) return undefined;
  return on.some((id) => /person/.test(id) || hass.states[id]?.attributes?.device_class === "presence") ? "person" : "motion";
}
const ACTIVITY = {
  person: { label: "Person", color: "#ef4444", icon: "mdi:account-alert" },
  motion: { label: "Bewegung", color: "#f59e0b", icon: "mdi:motion-sensor" },
};

class UzCameraGridCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("uz-camera-grid-card-editor");
  }

  static getStubConfig(hass) {
    return { cameras: Object.keys(hass?.states || {}).filter((id) => id.startsWith("camera.")).slice(0, 4), columns: 2, live: true };
  }

  setConfig(config) {
    this._config = { columns: 2, live: true, aspect_ratio: "16:9", ...config };
    this._sig = undefined;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    for (const t of Object.values(this._tiles || {})) {
      if (t.card) t.card.hass = hass;
      this._updateHead(t);
    }
  }

  getCardSize() {
    return Math.ceil(cameraItems(this._config || {}, this._hass).length / (this._config?.columns || 2)) * 4 + 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  _updateHead(t) {
    const st = this._hass?.states?.[t.entity];
    const name = t.item.name || st?.attributes?.friendly_name || t.entity;
    const on = st && !["unavailable", "unknown"].includes(st.state);
    if (t.nameEl.textContent !== name) t.nameEl.textContent = name;
    t.dot.classList.toggle("off", !on);
    t.dot.title = on ? (st.state === "recording" ? "Aufnahme" : st.state === "streaming" ? "Live" : "Bereit") : "Nicht erreichbar";
    // Bewegung/Person hervorheben (abschaltbar mit highlight_motion: false)
    const act = this._config.highlight_motion === false ? undefined : cameraActivity(this._hass, t.entity);
    if (t.act !== act) {
      t.act = act;
      t.el.classList.toggle("active", !!act);
      t.el.style.setProperty("--act", act ? ACTIVITY[act].color : "transparent");
      t.badge.hidden = !act;
      t.badge.innerHTML = act ? `<ha-icon icon="${ACTIVITY[act].icon}"></ha-icon>${ACTIVITY[act].label}` : "";
    }
  }

  async _render() {
    if (!this._config || !this._hass) return;
    const items = cameraItems(this._config, this._hass);
    // Nur bei geänderter Auswahl/Anordnung neu aufbauen – sonst würden laufende Streams neu starten
    const sig = JSON.stringify([items, this._config.columns, this._config.live, this._config.aspect_ratio, this._config.title]);
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const cols = Math.min(4, Math.max(1, Number(this._config.columns) || 2));
    this.shadowRoot.innerHTML = `<style>
      ha-card { padding: 12px; }
      .title { font-size: 18px; font-weight: 600; margin: 0 4px 10px; }
      .grid { display: grid; gap: 12px; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); }
      @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } .tile.wide { grid-column: auto; } }
      .tile { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .tile.wide { grid-column: span 2; }
      .head { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-weight: 500; }
      .head ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
      .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; flex: none; }
      .dot.off { background: var(--disabled-text-color, #9e9e9e); }
      .img { border-radius: 12px; overflow: hidden; background: #000; outline: 3px solid transparent; outline-offset: 2px; transition: outline-color .3s; }
      .tile.active .img { outline-color: var(--act); animation: uz-act 1.6s ease-in-out infinite; }
      @keyframes uz-act { 50% { outline-color: color-mix(in srgb, var(--act) 35%, transparent); } }
      .act { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600;
        color: #fff; background: var(--act); }
      .act[hidden] { display: none; }
      .act ha-icon { --mdc-icon-size: 14px; color: #fff; }
      .empty { color: var(--secondary-text-color); padding: 8px 4px; }
    </style>
    <ha-card>
      ${this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : ""}
      ${items.length ? `<div class="grid"></div>` : `<div class="empty">Keine Kameras gefunden. Im Editor Kameras auswählen.</div>`}
    </ha-card>`;
    const grid = this.shadowRoot.querySelector(".grid");
    if (!grid) return;
    const helpers = await window.loadCardHelpers?.();
    const old = this._tiles || {};
    this._tiles = {};
    for (const item of items) {
      const tile = document.createElement("div");
      tile.className = `tile${item.wide && cols > 1 ? " wide" : ""}`;
      tile.innerHTML = `<div class="head"><ha-icon icon="mdi:cctv"></ha-icon><span class="name"></span><span class="act" hidden></span><span class="dot"></span></div><div class="img"></div>`;
      const conf = {
        type: "picture-entity",
        entity: item.entity,
        camera_view: this._config.live ? "live" : "auto",
        show_name: false,
        show_state: false,
        aspect_ratio: this._config.aspect_ratio,
        tap_action: { action: "more-info" },
      };
      // Bestehende Bildkarte weiterverwenden, wenn sich nichts geändert hat (Stream läuft weiter)
      const prev = old[item.entity];
      const card = prev && JSON.stringify(prev.conf) === JSON.stringify(conf) ? prev.card : helpers?.createCardElement?.(conf);
      if (card) {
        card.hass = this._hass;
        tile.querySelector(".img").append(card);
      }
      grid.append(tile);
      const t = { entity: item.entity, item, conf, card, el: tile, nameEl: tile.querySelector(".name"), dot: tile.querySelector(".dot"), badge: tile.querySelector(".act") };
      this._tiles[item.entity] = t;
      this._updateHead(t);
    }
  }
}

// ---------- Editor der Kamera-Karte: Auswahl, Spalten und Anordnung per Ziehen/Antippen ----------

const CAMERA_EDITOR_STYLE = `
  .cam-grid { display: grid; gap: 8px; margin-top: 8px; }
  .cam { position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: 6px; min-height: 64px;
    padding: 8px 10px; border-radius: 12px; cursor: grab; user-select: none;
    background: var(--secondary-background-color); border: 2px solid transparent; }
  .cam.wide { grid-column: span 2; }
  .cam.over { border-color: var(--primary-color); }
  .cam.picked { border-color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 12%, var(--secondary-background-color)); }
  .cam .n { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cam .acts { display: flex; gap: 4px; justify-content: flex-end; }
  .cam button { border: none; border-radius: 6px; cursor: pointer; padding: 2px 6px; font-size: 12px;
    background: var(--card-background-color); color: var(--primary-text-color); }
  .cam-hint { font-size: 12px; color: var(--secondary-text-color); margin: 6px 0 2px; line-height: 1.4; }
`;

class UzCameraGridCardEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (!this._built) this._build();
  }

  setConfig(config) {
    this._config = { columns: 2, live: true, aspect_ratio: "16:9", ...config };
    this._build();
  }

  _items() {
    return (Array.isArray(this._config.cameras) ? this._config.cameras : []).map((c) => (typeof c === "string" ? { entity: c } : { ...c }));
  }

  // Einfache Einträge bleiben Texte; nur breite/umbenannte Kameras werden Objekte
  _store(items) {
    return items.map((i) => (i.wide || i.name ? i : i.entity));
  }

  _emit(patch) {
    this._config = { ...this._config, ...patch };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
    this._sync();
  }

  _build() {
    if (!this._hass || !this._config) return;
    if (!this._built) {
      this._built = true;
      this.innerHTML = `<style>${CAMERA_EDITOR_STYLE}</style>`;
      this._form = document.createElement("ha-form");
      this._form.hass = this._hass;
      this._form.schema = [
        { name: "title", selector: { text: {} } },
        { name: "cameras", selector: { entity: { multiple: true, reorder: true, filter: { domain: "camera" } } } },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "columns", selector: { number: { min: 1, max: 4, step: 1, mode: "slider" } } },
            { name: "aspect_ratio", selector: { select: { mode: "dropdown", options: [
              { value: "16:9", label: "16:9" }, { value: "4:3", label: "4:3" }, { value: "1:1", label: "1:1" },
            ] } } },
          ],
        },
        { name: "live", selector: { boolean: {} } },
        { name: "highlight_motion", selector: { boolean: {} } },
      ];
      this._form.computeLabel = (s) => ({
        title: "Titel (optional)",
        cameras: "Kameras (leer = alle)",
        columns: "Spalten",
        aspect_ratio: "Bildformat",
        live: "Live-Bild (sonst Standbild, alle 10 s aktualisiert)",
        highlight_motion: "Bewegung und Personen hervorheben",
      })[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = ev.detail.value;
        // Auswahl aus dem Feld übernehmen, Zusatzangaben (breit, Name) behalten
        const old = Object.fromEntries(this._items().map((i) => [i.entity, i]));
        const cameras = (v.cameras || []).map((e) => old[e] || { entity: e });
        this._emit({ title: v.title || undefined, columns: v.columns, aspect_ratio: v.aspect_ratio, live: v.live,
          highlight_motion: v.highlight_motion, cameras: this._store(cameras) });
      });
      const hint = document.createElement("div");
      hint.className = "cam-hint";
      hint.textContent = "Anordnung: Kameras ziehen oder antippen und dann das Ziel antippen. ⇔ macht eine Kamera doppelt breit.";
      this._gridEl = document.createElement("div");
      this._gridEl.className = "cam-grid";
      this._gridEl.addEventListener("click", (ev) => this._onGridClick(ev));
      this.append(this._form, hint, this._gridEl);
    }
    this._sync();
  }

  _sync() {
    if (!this._form) return;
    this._form.data = { highlight_motion: true, ...this._config, cameras: this._items().map((i) => i.entity) };
    this._renderGrid();
  }

  _renderGrid() {
    const items = this._items();
    const cols = Math.min(4, Math.max(1, Number(this._config.columns) || 2));
    const sig = JSON.stringify([items, cols, this._pick]);
    if (sig === this._gridSig) return;
    this._gridSig = sig;
    this._gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    this._gridEl.innerHTML = items
      .map((i, idx) => {
        const name = i.name || this._hass?.states?.[i.entity]?.attributes?.friendly_name || i.entity;
        return `<div class="cam${i.wide && cols > 1 ? " wide" : ""}${this._pick === idx ? " picked" : ""}" draggable="true" data-idx="${idx}">
          <span class="n">${esc(name)}</span>
          <span class="acts">
            <button data-act="wide" data-idx="${idx}" title="Breite umschalten">⇔</button>
            <button data-act="remove" data-idx="${idx}" title="Entfernen">✕</button>
          </span>
        </div>`;
      })
      .join("");
    this._gridEl.querySelectorAll(".cam").forEach((el) => {
      el.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", el.dataset.idx));
      el.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        el.classList.add("over");
      });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", (ev) => {
        ev.preventDefault();
        this._move(Number(ev.dataTransfer.getData("text/plain")), Number(el.dataset.idx));
      });
    });
  }

  // Kamera an die Stelle einer anderen setzen (die übrigen rücken nach)
  _move(from, to) {
    const items = this._items();
    if (Number.isNaN(from) || from === to || !items[from]) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    this._pick = undefined;
    this._emit({ cameras: this._store(items) });
  }

  _onGridClick(ev) {
    const btn = ev.target.closest("button[data-act]");
    const items = this._items();
    if (btn) {
      ev.stopPropagation();
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.act === "remove") items.splice(idx, 1);
      if (btn.dataset.act === "wide") items[idx] = { ...items[idx], wide: !items[idx].wide };
      this._pick = undefined;
      this._emit({ cameras: this._store(items) });
      return;
    }
    const cam = ev.target.closest(".cam");
    if (!cam) return;
    const idx = Number(cam.dataset.idx);
    // Antippen (Handy): erste Kamera wählen, zweite = Ziel
    if (this._pick === undefined || this._pick === idx) {
      this._pick = this._pick === idx ? undefined : idx;
      this._gridSig = undefined;
      this._renderGrid();
    } else {
      this._move(this._pick, idx);
    }
  }
}

// ---------- Karte: uz-link-tile (Kachel, die eine Unterseite des Dashboards öffnet) ----------
// config: { title, subtitle, icon, color, path, entity, cameras }
// path relativ zum Dashboard (z. B. "kameras") oder "/dashboard-x"; entity = Zustand rechts;
// cameras = Kameras, deren Bewegung/Person die Kachel meldet

class UzLinkTile extends HTMLElement {
  setConfig(config) {
    this._config = { icon: "mdi:arrow-right", color: "var(--primary-color)", ...config };
    this._sig = undefined;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: "full", rows: 1 };
  }

  // Kameras mit Bewegung/Person (Personen zuerst)
  _activity() {
    const cams = Array.isArray(this._config.cameras) ? this._config.cameras : [];
    if (!this._hass || !cams.length) return [];
    return cams
      .map((c) => (typeof c === "string" ? c : c?.entity))
      .filter(Boolean)
      .map((id) => ({ id, act: cameraActivity(this._hass, id) }))
      .filter((x) => x.act)
      .sort((a, b) => (b.act === "person") - (a.act === "person"));
  }

  _render() {
    if (!this._config) return;
    const c = this._config;
    const active = this._activity();
    const st = c.entity ? this._hass?.states?.[c.entity] : undefined;
    const value = st && this._hass?.formatEntityState ? this._hass.formatEntityState(st) : st?.state;
    // batteries: Schwelle → Untertitel „X wechseln“ (orange) bzw. „Alle in Ordnung“
    const batt = c.batteries !== undefined && this._hass ? batteryDevices(this._hass, Number(c.batteries)) : undefined;
    const battLow = batt ? batt.filter((b) => b.low).length : 0;
    const sig = JSON.stringify([c, active, value, batt && [batt.length, battLow]]);
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const act = active.length
      ? ACTIVITY[active[0].act]
      : battLow ? { icon: "mdi:battery-alert-variant-outline", color: "#f59e0b", label: "" } : undefined;
    // "Hamm - Garten" → "Garten"
    const camName = (id) => String(this._hass?.states?.[id]?.attributes?.friendly_name || id).replace(/^[^-]+ - /, "");
    const sub = active.length
      ? `${act.label}: ${active.map((x) => camName(x.id)).join(", ")}`
      : battLow ? `${battLow} ${battLow === 1 ? "Batterie" : "Batterien"} wechseln`
      : batt ? `${batt.length} ${batt.length === 1 ? "Gerät" : "Geräte"} · alle in Ordnung` : c.subtitle;
    const color = act ? act.color : c.color;
    this.shadowRoot.innerHTML = `<style>
      ha-card { overflow: hidden; }
      .tile { display: flex; align-items: center; gap: 12px; padding: 0 12px; cursor: pointer; height: 54px; box-sizing: border-box; }
      .tile:hover { background: color-mix(in srgb, var(--c) 8%, transparent); }
      .tile.alert { background: color-mix(in srgb, var(--c) 10%, transparent); }
      .bubble { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none;
        background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); }
      .alert .bubble { animation: uz-pulse 1.6s ease-in-out infinite; }
      @keyframes uz-pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--c) 25%, transparent); } }
      .bubble ha-icon { --mdc-icon-size: 22px; }
      .txt { flex: 1; min-width: 0; }
      .t { font-weight: 500; font-size: 14px; }
      .s { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .alert .s { color: var(--c); font-weight: 500; }
      .v { font-weight: 600; font-size: 14px; white-space: nowrap; }
      .chev { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
    </style>
    <ha-card style="--c:${esc(color)}">
      <div class="tile${act ? " alert" : ""}" id="go">
        <div class="bubble"><ha-icon icon="${esc(act ? act.icon : c.icon)}"></ha-icon></div>
        <div class="txt"><div class="t">${esc(c.title || "")}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>
        ${value !== undefined ? `<div class="v">${esc(value)}</div>` : ""}
        <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
      </div>
    </ha-card>`;
    this.shadowRoot.getElementById("go").onclick = () => {
      const first = window.location.pathname.split("/").filter(Boolean)[0] || "lovelace";
      // "/dashboard-x/..." = anderes Dashboard, sonst Unterseite des aktuellen
      uzNavigate(String(c.path || "").startsWith("/") ? c.path : `/${first}/${c.path || ""}`);
    };
  }
}

if (!customElements.get("uz-camera-grid-card")) {
  customElements.define("uz-camera-grid-card", UzCameraGridCard);
  customElements.define("uz-camera-grid-card-editor", UzCameraGridCardEditor);
  customElements.define("uz-link-tile", UzLinkTile);
  window.customCards = window.customCards || [];
  window.customCards.push(
    { type: "uz-camera-grid-card", name: "UZ Videoüberwachung", description: "Kameras mit Name und Live-Bild, Anordnung per Drag & Drop.", preview: false },
    { type: "uz-link-tile", name: "UZ Link-Kachel", description: "Kachel, die eine Unterseite des Dashboards öffnet." },
  );
}


console.info(`%c UNSER-ZUHAUSE-KARTEN %c v${UZ_CARDS_VERSION} `, "background:#8b5cf6;color:#fff", "");

// ======================================================================
// Startseite: Begrüßung, „Was ist los?“, „Läuft gerade“, Szenen, Personen, Kamera-Vorschau
// ======================================================================

const DE_WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DE_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

// "seit 5 Min." / "seit 3 Std." / "seit 2 Tagen"
function sinceText(iso, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(min)) return "";
  if (min < 1) return "gerade eben";
  if (min < 60) return `seit ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `seit ${h} Std.`;
  const d = Math.round(h / 24);
  return `seit ${d} ${d === 1 ? "Tag" : "Tagen"}`;
}

// Hilfsfunktion: Karte samt HA-Hülle (hui-card) aus- oder einblenden
function setCardHidden(el, hidden) {
  el.style.display = hidden ? "none" : "";
  const host = el.parentElement;
  if (host && /^HUI-CARD$/i.test(host.tagName)) host.style.display = hidden ? "none" : "";
}

// Weiterleitung von Aktionen an HA (more-info usw.)
function fireMoreInfo(el, entityId) {
  el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
}

// ---------- uz-greeting-card ----------
// config: { weather, sun, lights, windows, windows_count, trash_calendar,
//           energy: { solar, grid_in, grid_out, battery_in, battery_out }, weekly_review: "sunday" | "always" | "off" }
// Hintergrund je Tageszeit (Sonnenstand) und Wetter, Begrüßung mit Vornamen, Kurzinfo als Chips.

const WEATHER_DE = {
  "clear-night": ["Klar", "mdi:weather-night", "spin"], cloudy: ["Bewölkt", "mdi:weather-cloudy", "drift"],
  fog: ["Nebel", "mdi:weather-fog", "drift"], hail: ["Hagel", "mdi:weather-hail", "bob"],
  lightning: ["Gewitter", "mdi:weather-lightning", "flash"], "lightning-rainy": ["Gewitter", "mdi:weather-lightning-rainy", "flash"],
  partlycloudy: ["Teilweise bewölkt", "mdi:weather-partly-cloudy", "drift"], pouring: ["Starkregen", "mdi:weather-pouring", "bob"],
  rainy: ["Regen", "mdi:weather-rainy", "bob"], snowy: ["Schnee", "mdi:weather-snowy", "bob"],
  "snowy-rainy": ["Schneeregen", "mdi:weather-snowy-rainy", "bob"], sunny: ["Sonnig", "mdi:weather-sunny", "spin"],
  windy: ["Windig", "mdi:weather-windy", "drift"], "windy-variant": ["Windig", "mdi:weather-windy-variant", "drift"],
  exceptional: ["Unwetter", "mdi:alert", "flash"],
};

// Tageszeit: night | dawn | day | dusk (aus sun.sun, sonst Uhrzeit)
function dayPhase(hass, sunId = "sun.sun", date = new Date()) {
  const sun = hass?.states?.[sunId];
  const elev = parseFloat(sun?.attributes?.elevation);
  if (Number.isFinite(elev)) {
    if (elev < -6) return "night";
    if (elev < 8) return sun.attributes.rising ? "dawn" : "dusk";
    return "day";
  }
  const h = date.getHours();
  return h < 6 || h >= 22 ? "night" : h < 9 ? "dawn" : h < 18 ? "day" : "dusk";
}

const AMBIENT = {
  night: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)",
  dawn: "linear-gradient(135deg, #fb923c 0%, #f472b6 50%, #818cf8 100%)",
  day: "linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%)",
  dusk: "linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #6d28d9 100%)",
  cloudy: "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)",
  rain: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
  snow: "linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%)",
};

function ambientFor(phase, condition) {
  if (phase === "night") return { bg: AMBIENT.night, fx: /rain|pouring|lightning/.test(condition || "") ? "rain" : "stars" };
  if (/rain|pouring|lightning|hail/.test(condition || "")) return { bg: AMBIENT.rain, fx: "rain" };
  if (/snow/.test(condition || "")) return { bg: AMBIENT.snow, fx: "snow" };
  if (phase === "day" && /cloudy|fog/.test(condition || "") && condition !== "partlycloudy") return { bg: AMBIENT.cloudy, fx: "" };
  return { bg: AMBIENT[phase], fx: "" };
}

// Wochenrückblick: sonntags „Diese Woche“, montags bis 12 Uhr „Letzte Woche“ (mit "always" immer)
function weekReviewPeriod(mode, date = new Date()) {
  if (!mode || mode === "off") return undefined;
  const day = date.getDay();
  if (day === 1 && date.getHours() < 12) return { offset: -1, label: "Letzte Woche" };
  if (day === 0 || mode === "always") return { offset: 0, label: "Diese Woche" };
  return undefined;
}

// Kennzahlen aus den Energie-Summen (kWh) der Woche
function weekReviewStats(sum) {
  const v = (k) => (Number.isFinite(sum[k]) ? sum[k] : 0);
  const use = v("solar") + v("grid_in") + v("battery_out") - v("grid_out") - v("battery_in");
  const stats = [];
  if (Number.isFinite(sum.solar)) stats.push({ icon: "mdi:solar-power-variant", value: v("solar"), unit: "kWh", label: "PV" });
  if (use > 0) stats.push({ icon: "mdi:home-lightning-bolt-outline", value: use, unit: "kWh", label: "Verbrauch" });
  if (use > 0 && Number.isFinite(sum.grid_in)) {
    stats.push({ icon: "mdi:shield-sun-outline", value: Math.max(0, Math.min(100, (1 - v("grid_in") / use) * 100)), unit: "%", label: "Autarkie" });
  }
  if (Number.isFinite(sum.grid_out) && v("grid_out") > 0) stats.push({ icon: "mdi:transmission-tower-export", value: v("grid_out"), unit: "kWh", label: "Eingespeist" });
  return stats;
}

const fmtNum = (n, unit) =>
  `${unit === "%" || n >= 100 ? Math.round(n) : (Math.round(n * 10) / 10).toString().replace(".", ",")} ${unit}`;

function greetingWord(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 17 ? "Guten Tag" : h < 22 ? "Guten Abend" : "Gute Nacht";
}

const ANIM_CSS = `
  @keyframes uz-spin { to { transform: rotate(360deg); } }
  @keyframes uz-drift { 0%, 100% { transform: translateX(-3px); } 50% { transform: translateX(3px); } }
  @keyframes uz-bob { 0%, 100% { transform: translateY(-2px); } 50% { transform: translateY(2px); } }
  @keyframes uz-flash { 0%, 90%, 100% { opacity: 1; } 93% { opacity: .3; } 96% { opacity: 1; } 98% { opacity: .5; } }
  @keyframes uz-shake { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-6deg); } 75% { transform: rotate(6deg); } }
  @keyframes uz-pulse-o { 50% { transform: scale(1.12); opacity: .75; } }
  .a-spin { animation: uz-spin 12s linear infinite; }
  .a-spinfast { animation: uz-spin 1.6s linear infinite; }
  .a-drift { animation: uz-drift 4s ease-in-out infinite; }
  .a-bob { animation: uz-bob 1.4s ease-in-out infinite; }
  .a-flash { animation: uz-flash 4s linear infinite; }
  .a-shake { animation: uz-shake .5s ease-in-out infinite; }
  .a-pulse { animation: uz-pulse-o 1.6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { [class^="a-"], [class*=" a-"] { animation: none !important; } }
`;

class UzGreetingCard extends HTMLElement {
  setConfig(config) {
    this._config = { sun: "sun.sun", weekly_review: "sunday", ...config };
    this._sig = undefined;
    this._weekAt = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.trash_calendar && (!this._trashAt || Date.now() - this._trashAt > 30 * 60000)) this._loadTrash();
    const period = weekReviewPeriod(this._config?.weekly_review);
    if (period && this._config?.energy && (!this._weekAt || Date.now() - this._weekAt > 30 * 60000 || this._week?.label !== period.label)) {
      this._loadWeek(period);
    }
    if (!period && this._week) this._week = undefined;
    this._render();
  }

  // Energie-Summen der Kalenderwoche aus der Statistik
  async _loadWeek(period) {
    this._weekAt = Date.now();
    const ids = Object.entries(this._config.energy || {}).filter(([, id]) => id);
    const pairs = await Promise.all(
      ids.map(([key, id]) =>
        this._hass
          .callWS({ type: "recorder/statistic_during_period", statistic_id: id, calendar: { period: "week", offset: period.offset }, types: ["change"] })
          .then((r) => [key, typeof r?.change === "number" ? r.change : NaN])
          .catch(() => [key, NaN]),
      ),
    );
    const stats = weekReviewStats(Object.fromEntries(pairs));
    this._week = stats.length ? { label: period.label, stats } : undefined;
    this._sig = undefined;
    this._render();
  }

  connectedCallback() {
    // Begrüßung und Tageszeit auch ohne Zustandsänderung aktuell halten
    this._timer = setInterval(() => this._render(), 60000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  // Müll heute/morgen aus dem Kalender
  async _loadTrash() {
    this._trashAt = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 86400000);
    try {
      const events = await this._hass.callApi(
        "GET",
        `calendars/${this._config.trash_calendar}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
      );
      const day = (e) => {
        const d = new Date(e.start?.dateTime || `${e.start?.date}T00:00:00`);
        return Math.floor((d - start) / 86400000);
      };
      this._trash = {
        today: events.filter((e) => day(e) === 0).map((e) => e.summary),
        tomorrow: events.filter((e) => day(e) === 1).map((e) => e.summary),
      };
    } catch (e) {
      this._trash = undefined;
    }
    this._sig = undefined;
    this._render();
  }

  _chips() {
    const h = this._hass;
    const c = this._config;
    const chips = [];
    const w = h.states[c.weather];
    if (w && Number.isFinite(parseFloat(w.attributes?.temperature))) {
      const unit = w.attributes.temperature_unit || "°C";
      chips.push({ icon: "mdi:thermometer", text: `${String(Math.round(w.attributes.temperature * 10) / 10).replace(".", ",")} ${unit}` });
    }
    const lights = h.states[c.lights];
    if (lights && Number.isFinite(parseFloat(lights.state))) {
      const n = parseInt(lights.state, 10);
      chips.push({ icon: n ? "mdi:lightbulb-on" : "mdi:lightbulb-off-outline", text: n ? `${n} ${n === 1 ? "Licht" : "Lichter"} an` : "Alle Lichter aus" });
    }
    const win = h.states[c.windows];
    if (win) {
      const count = parseInt(h.states[c.windows_count]?.state, 10);
      chips.push(
        win.state === "on"
          ? { icon: "mdi:window-open-variant", text: Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? "Fenster" : "Fenster"} offen` : "Fenster offen", warn: true }
          : { icon: "mdi:window-closed-variant", text: "Alles geschlossen" },
      );
    }
    if (this._trash?.today?.length) chips.push({ icon: "mdi:trash-can-outline", text: `Heute: ${this._trash.today.join(", ")}`, warn: true });
    else if (this._trash?.tomorrow?.length) chips.push({ icon: "mdi:trash-can-outline", text: `Morgen: ${this._trash.tomorrow.join(", ")}` });
    return chips;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const now = new Date();
    const w = this._hass.states[this._config.weather];
    const cond = w?.state;
    const phase = dayPhase(this._hass, this._config.sun, now);
    const amb = ambientFor(phase, cond);
    const first = String(this._hass.user?.name || "").split(" ")[0];
    const hello = `${greetingWord(now)}${first ? `, ${first}` : ""}`;
    const date = `${DE_WEEKDAYS[now.getDay()]}, ${now.getDate()}. ${DE_MONTHS[now.getMonth()]}`;
    let [condText, condIcon, condAnim] = WEATHER_DE[cond] || ["", "", ""];
    if (cond === "partlycloudy" && phase === "night") condIcon = "mdi:weather-night-partly-cloudy";
    const chips = this._chips();
    const week = this._week;
    const sig = JSON.stringify([hello, date, phase, cond, chips, week]);
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      ${ANIM_CSS}
      ha-card { position: relative; overflow: hidden; color: #fff; border: none; background: ${amb.bg}; }
      .fx { position: absolute; inset: 0; pointer-events: none; }
      .fx.stars { background-image: radial-gradient(1px 1px at 20% 30%, #fff9, transparent), radial-gradient(1px 1px at 70% 20%, #fff8, transparent),
        radial-gradient(1.5px 1.5px at 85% 60%, #fffa, transparent), radial-gradient(1px 1px at 40% 75%, #fff7, transparent),
        radial-gradient(1px 1px at 60% 45%, #fff6, transparent), radial-gradient(1.5px 1.5px at 10% 80%, #fff8, transparent); }
      .fx.rain { background: repeating-linear-gradient(105deg, transparent 0 14px, #ffffff1f 14px 15px); background-size: 200% 200%;
        animation: uz-rain .8s linear infinite; }
      .fx.snow { background-image: radial-gradient(2px 2px at 15% 20%, #fff, transparent), radial-gradient(2px 2px at 55% 10%, #fff, transparent),
        radial-gradient(2px 2px at 80% 40%, #fff, transparent), radial-gradient(2px 2px at 35% 60%, #fff, transparent);
        background-size: 100% 100%; animation: uz-snow 6s linear infinite; }
      @keyframes uz-rain { to { background-position: -30px 60px; } }
      @keyframes uz-snow { from { background-position: 0 -60px; } to { background-position: 0 120px; } }
      .wrap { position: relative; display: flex; align-items: center; gap: 14px; padding: 16px; }
      .txt { flex: 1; min-width: 0; }
      .hello { font-size: 22px; font-weight: 700; line-height: 1.2; text-shadow: 0 1px 6px #0004; }
      .date { font-size: 13px; opacity: .9; margin-top: 2px; }
      .wx { display: flex; flex-direction: column; align-items: center; flex: none; font-size: 12px; opacity: .95; }
      .wx ha-icon { --mdc-icon-size: 44px; filter: drop-shadow(0 2px 6px #0003); }
      .chips { position: relative; display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 14px; }
      .chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 14px; font-size: 12px; font-weight: 500;
        background: #ffffff2e; backdrop-filter: blur(6px); }
      .chip.warn { background: #f59e0bd9; }
      .chip ha-icon { --mdc-icon-size: 15px; }
      .week { position: relative; margin: 0 16px 14px; padding: 10px 12px; border-radius: 14px; background: #ffffff26; backdrop-filter: blur(6px); }
      .wt { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .9; }
      .wt ha-icon { --mdc-icon-size: 15px; }
      .ws { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px; margin-top: 8px; }
      .ws b { overflow: hidden; text-overflow: ellipsis; }
      .ws div { display: flex; flex-direction: column; gap: 2px; }
      .ws b { font-size: 16px; font-weight: 700; white-space: nowrap; }
      .ws span { font-size: 11px; opacity: .85; display: flex; align-items: center; gap: 3px; }
      .ws span ha-icon { --mdc-icon-size: 13px; }
    </style>
    <ha-card>
      <div class="fx ${amb.fx}"></div>
      <div class="wrap">
        <div class="txt"><div class="hello">${esc(hello)}</div><div class="date">${esc(date)}</div></div>
        ${condIcon ? `<div class="wx" id="wx"><ha-icon class="a-${condAnim}" icon="${condIcon}"></ha-icon><span>${esc(condText)}</span></div>` : ""}
      </div>
      ${chips.length ? `<div class="chips">${chips.map((x) => `<span class="chip${x.warn ? " warn" : ""}"><ha-icon icon="${x.icon}"></ha-icon>${esc(x.text)}</span>`).join("")}</div>` : ""}
      ${week ? `<div class="week">
        <div class="wt"><ha-icon icon="mdi:calendar-week"></ha-icon>Wochenrückblick · ${esc(week.label)}</div>
        <div class="ws">${week.stats.map((x) => `<div><b>${esc(fmtNum(x.value, x.unit))}</b><span><ha-icon icon="${x.icon}"></ha-icon>${esc(x.label)}</span></div>`).join("")}</div>
      </div>` : ""}
    </ha-card>`;
    const wx = this.shadowRoot.getElementById("wx");
    if (wx) wx.onclick = () => fireMoreInfo(this, this._config.weather);
  }
}

// ---------- uz-alerts-card („Was ist los?“) ----------
// Erscheint nur, wenn etwas zu tun ist.
// config: { windows, house_mode, away_states, cameras, camera_path, battery_threshold, battery_path, show_updates }

const AWAY_STATES = ["abwesend", "away", "urlaub", "vacation", "not_home"];

function homeAlerts(hass, config) {
  const st = hass?.states || {};
  const alerts = [];
  // 1. Fenster offen, obwohl niemand da ist bzw. Hausmodus „abwesend“
  const win = st[config.windows];
  const mode = String(st[config.house_mode]?.state || "").toLowerCase();
  const persons = Object.values(st).filter((s) => s.entity_id.startsWith("person."));
  const nobodyHome = persons.length > 0 && !persons.some((p) => p.state === "home");
  const away = (config.away_states || AWAY_STATES).includes(mode) || nobodyHome;
  if (win?.state === "on" && away) {
    alerts.push({ key: "windows", level: "bad", icon: "mdi:window-open-variant", text: "Fenster offen, obwohl niemand zu Hause ist", go: "#uz-fenster" });
  }
  // 2. Kameras: Person / Bewegung
  const cams = (config.cameras || []).map((c) => (typeof c === "string" ? c : c?.entity)).filter(Boolean);
  const active = cams.map((id) => ({ id, act: cameraActivity(hass, id) })).filter((x) => x.act);
  if (active.length) {
    const person = active.filter((x) => x.act === "person");
    const list = (person.length ? person : active).map((x) => String(st[x.id]?.attributes?.friendly_name || x.id).replace(/^[^-]+ - /, ""));
    alerts.push({
      key: "camera", level: person.length ? "bad" : "warn", icon: person.length ? "mdi:account-alert" : "mdi:motion-sensor",
      text: `${person.length ? "Person erkannt" : "Bewegung"}: ${list.join(", ")}`, go: config.camera_path || "kameras",
    });
  }
  // 3. Batterien fast leer (je Gerät nur einmal, ohne Einstellwerte wie min. SoC und ohne Handys)
  const limit = Number(config.battery_threshold ?? 15);
  if (limit > 0) {
    const low = batteryDevices(hass, limit).filter((b) => b.low);
    if (low.length) {
      alerts.push({
        key: "battery", level: "warn", icon: "mdi:battery-alert-variant-outline",
        text: `${low.length} ${low.length === 1 ? "Batterie" : "Batterien"} fast leer`,
        detail: low.map((b) => [b.name, b.level !== null ? `${Math.round(b.level)} %` : "", uzBatteryNeed(b) && `(${uzBatteryNeed(b)})`].filter(Boolean).join(" ")).join(" · "),
        // mit Batterie-Seite: dorthin, sonst Details des Geräts
        ...(config.battery_path ? { go: config.battery_path } : { more: low.length === 1 ? low[0].entity : undefined }),
      });
    }
  }
  // 4. Updates (nur Administratoren)
  if (config.show_updates !== false && hass?.user?.is_admin !== false) {
    const ups = Object.values(st).filter((s) => s.entity_id.startsWith("update.") && s.state === "on" && !hass.entities?.[s.entity_id]?.hidden);
    if (ups.length) {
      alerts.push({
        key: "updates", level: "info", icon: "mdi:package-up", text: `${ups.length} ${ups.length === 1 ? "Update" : "Updates"} verfügbar`,
        detail: ups.map((u) => u.attributes?.title || u.attributes?.friendly_name).slice(0, 4).join(", "), go: "/config/updates",
      });
    }
  }
  return alerts;
}

const ALERT_COLORS = { bad: "#ef4444", warn: "#f59e0b", info: "#3b82f6" };

class UzAlertsCard extends HTMLElement {
  setConfig(config) {
    this._config = { battery_threshold: 15, show_updates: true, ...config };
    this._sig = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  connectedCallback() {
    if (this._hidden !== undefined) setCardHidden(this, this._hidden);
  }

  _render() {
    if (!this._config || !this._hass) return;
    const alerts = homeAlerts(this._hass, this._config);
    const sig = JSON.stringify(alerts);
    if (sig === this._sig) return;
    this._sig = sig;
    this._hidden = !alerts.length;
    setCardHidden(this, this._hidden);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      ha-card { overflow: hidden; }
      .head { display: flex; align-items: center; gap: 8px; padding: 10px 14px 4px; font-weight: 600; font-size: 14px; }
      .head ha-icon { --mdc-icon-size: 18px; color: var(--primary-color); }
      .row { display: flex; align-items: center; gap: 12px; padding: 8px 14px; cursor: pointer; }
      .row:last-child { padding-bottom: 12px; }
      .row:hover { background: var(--secondary-background-color); }
      .ic { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none;
        background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); }
      .ic ha-icon { --mdc-icon-size: 18px; }
      .bad .ic { animation: uz-pulse-a 1.6s ease-in-out infinite; }
      @keyframes uz-pulse-a { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--c) 25%, transparent); } }
      .t { font-size: 14px; font-weight: 500; }
      .d { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .txt { flex: 1; min-width: 0; }
    </style>
    <ha-card>
      <div class="head"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>Was ist los?</div>
      ${alerts.map((a, i) => `
        <div class="row ${a.level}" data-i="${i}" style="--c:${ALERT_COLORS[a.level]}">
          <span class="ic"><ha-icon icon="${a.icon}"></ha-icon></span>
          <span class="txt"><div class="t">${esc(a.text)}</div>${a.detail ? `<div class="d">${esc(a.detail)}</div>` : ""}</span>
        </div>`).join("")}
    </ha-card>`;
    this.shadowRoot.querySelectorAll(".row").forEach((row) => {
      row.onclick = () => {
        const a = alerts[Number(row.dataset.i)];
        if (a.more) return fireMoreInfo(this, a.more);
        if (!a.go) return;
        if (a.go.startsWith("#")) {
          window.history.pushState(null, "", `${window.location.pathname}${a.go}`);
          window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
          return;
        }
        const first = window.location.pathname.split("/").filter(Boolean)[0] || "lovelace";
        uzNavigate(a.go.startsWith("/") ? a.go : `/${first}/${a.go}`);
      };
    });
  }
}

// ---------- uz-running-card („Läuft gerade“) ----------
// config: { devices: ["binary_sensor.x" | { entity, name, icon, animation, detail, threshold }], battery, battery_power }
// Zeigt nur, was gerade läuft – mit bewegtem Symbol. Ohne Aktivität unsichtbar.

const ACTIVE_STATES = ["on", "run", "running", "active", "läuft", "in_progress", "washing", "drying", "heating", "charging", "cooling", "cleaning"];
const RUNNING_KINDS = [
  { re: /trockner|dryer|tumble/i, icon: "mdi:tumble-dryer", anim: "spinfast", name: "Trockner" },
  { re: /sp[uü]l|dishwasher/i, icon: "mdi:dishwasher", anim: "shake", name: "Spülmaschine" }, // vor „washer“ prüfen
  { re: /wasch|washer|washing/i, icon: "mdi:washing-machine", anim: "spinfast", name: "Waschmaschine" },
  { re: /kompressor|compressor|w[aä]rmepumpe|heat.?pump/i, icon: "mdi:fan", anim: "spinfast", name: "Wärmepumpe" },
  { re: /wallbox|charg|l[aä]dt|evcc/i, icon: "mdi:ev-station", anim: "pulse", name: "Wallbox" },
  { re: /robot|vacuum|sauger|roomba/i, icon: "mdi:robot-vacuum", anim: "shake", name: "Saugroboter" },
];

function runningItem(hass, item) {
  const conf = typeof item === "string" ? { entity: item } : { ...item };
  const s = hass?.states?.[conf.entity];
  if (!s) return undefined;
  const state = String(s.state).toLowerCase();
  const unit = s.attributes?.unit_of_measurement;
  let active;
  if (unit === "W" || unit === "kW") {
    const w = parseFloat(s.state) * (unit === "kW" ? 1000 : 1);
    active = Number.isFinite(w) && w > Number(conf.threshold ?? 5);
  } else {
    active = ACTIVE_STATES.includes(state);
  }
  const reg = hass.entities?.[conf.entity];
  const dev = reg?.device_id ? hass.devices?.[reg.device_id] : undefined;
  const hay = `${conf.entity} ${s.attributes?.friendly_name || ""} ${dev?.name || ""}`;
  const kind = RUNNING_KINDS.find((k) => k.re.test(hay));
  const detailState = conf.detail ? hass.states[conf.detail] : undefined;
  const detail = detailState && !["unknown", "unavailable", "off"].includes(detailState.state)
    ? (hass.formatEntityState ? hass.formatEntityState(detailState) : detailState.state)
    : unit === "W" || unit === "kW" ? (hass.formatEntityState ? hass.formatEntityState(s) : `${s.state} ${unit}`) : "";
  return {
    entity: conf.entity,
    active,
    name: conf.name || kind?.name || dev?.name_by_user || dev?.name || s.attributes?.friendly_name || conf.entity,
    icon: conf.icon || kind?.icon || s.attributes?.icon || "mdi:power",
    anim: conf.animation || kind?.anim || "pulse",
    detail,
  };
}

// Akku: Füllstand-Symbol, lädt/entlädt (Leistung mit Vorzeichen: + entladen, − laden)
function batteryItem(hass, socId, powerId) {
  const soc = parseFloat(hass?.states?.[socId]?.state);
  const p = parseFloat(hass?.states?.[powerId]?.state);
  if (!Number.isFinite(soc) || !Number.isFinite(p) || Math.abs(p) < 50) return undefined;
  const unit = hass.states[powerId].attributes?.unit_of_measurement;
  const watt = Math.abs(p) * (unit === "kW" ? 1000 : 1);
  const step = Math.max(1, Math.min(10, Math.round(soc / 10))) * 10;
  const charging = p < 0;
  return {
    entity: socId,
    active: true,
    name: charging ? "Akku lädt" : "Akku entlädt",
    icon: charging ? `mdi:battery-charging-${step === 100 ? 100 : step}` : step === 100 ? "mdi:battery" : `mdi:battery-${step}`,
    anim: charging ? "pulse" : "",
    detail: `${Math.round(soc)} % · ${watt >= 1000 ? `${(watt / 1000).toFixed(1).replace(".", ",")} kW` : `${Math.round(watt)} W`}`,
  };
}

class UzRunningCard extends HTMLElement {
  setConfig(config) {
    this._config = { devices: [], ...config };
    this._sig = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  connectedCallback() {
    if (this._hidden !== undefined) setCardHidden(this, this._hidden);
  }

  _render() {
    if (!this._config || !this._hass) return;
    const items = [
      ...(this._config.devices || []).map((d) => runningItem(this._hass, d)),
      this._config.battery && this._config.battery_power ? batteryItem(this._hass, this._config.battery, this._config.battery_power) : undefined,
    ].filter((x) => x?.active);
    const sig = JSON.stringify(items);
    if (sig === this._sig) return;
    this._sig = sig;
    this._hidden = !items.length;
    setCardHidden(this, this._hidden);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      ${ANIM_CSS}
      ha-card { padding: 10px 12px 12px; }
      .head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; margin: 0 2px 8px; }
      .head ha-icon { --mdc-icon-size: 18px; color: var(--primary-color); }
      .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
      .it { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; cursor: pointer;
        background: var(--secondary-background-color); }
      .ic { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none;
        background: color-mix(in srgb, var(--primary-color) 18%, transparent); color: var(--primary-color); }
      .ic ha-icon { --mdc-icon-size: 20px; }
      .n { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .d { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
      .txt { min-width: 0; }
    </style>
    <ha-card>
      <div class="head"><ha-icon icon="mdi:play-circle-outline"></ha-icon>Läuft gerade</div>
      <div class="list">
        ${items.map((x, i) => `
          <div class="it" data-i="${i}">
            <span class="ic"><ha-icon class="${x.anim ? `a-${x.anim}` : ""}" icon="${esc(x.icon)}"></ha-icon></span>
            <span class="txt"><div class="n">${esc(x.name)}</div>${x.detail ? `<div class="d">${esc(x.detail)}</div>` : ""}</span>
          </div>`).join("")}
      </div>
    </ha-card>`;
    this.shadowRoot.querySelectorAll(".it").forEach((el) => (el.onclick = () => fireMoreInfo(this, items[Number(el.dataset.i)].entity)));
  }
}

// ---------- uz-scene-bar (Szenen-Leiste) ----------
// config: { items: ["scene.x" | { entity, name, icon }], all_off: true }
// Antippen: Szene/Skript starten, Automation auslösen, sonst umschalten. „Alles aus“ schaltet alle Lichter aus.

class UzSceneBar extends HTMLElement {
  setConfig(config) {
    this._config = { items: [], all_off: true, ...config };
    this._sig = undefined;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  _items() {
    const list = (this._config.items || []).map((i) => (typeof i === "string" ? { entity: i } : { ...i })).filter((i) => i.entity);
    const out = list.map((i) => {
      const s = this._hass?.states?.[i.entity];
      return {
        ...i,
        name: i.name || s?.attributes?.friendly_name || i.entity,
        icon: i.icon || s?.attributes?.icon || (i.entity.startsWith("script.") ? "mdi:script-text-play" : "mdi:palette"),
      };
    });
    if (this._config.all_off) out.push({ entity: "__all_off__", name: "Alles aus", icon: "mdi:power" });
    return out;
  }

  async _run(item, el) {
    const domain = item.entity.split(".")[0];
    const call = item.entity === "__all_off__"
      ? ["light", "turn_off", { entity_id: "all" }]
      : domain === "scene" || domain === "script"
        ? [domain, "turn_on", { entity_id: item.entity }]
        : domain === "automation"
          ? ["automation", "trigger", { entity_id: item.entity }]
          : domain === "button" || domain === "input_button"
            ? [domain, "press", { entity_id: item.entity }]
            : ["homeassistant", "toggle", { entity_id: item.entity }];
    el.classList.add("busy");
    try {
      await this._hass.callService(...call);
      el.classList.add("done");
      setTimeout(() => el.classList.remove("done"), 1200);
    } finally {
      el.classList.remove("busy");
    }
  }

  _render() {
    if (!this._config || !this._hass) return;
    const items = this._items();
    const sig = JSON.stringify(items);
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; }
      .bar { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px; }
      .bar::-webkit-scrollbar { display: none; }
      button { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 40px; padding: 0 14px; border-radius: 20px; cursor: pointer;
        border: 1px solid var(--divider-color); background: var(--card-background-color, var(--ha-card-background)); color: var(--primary-text-color);
        font: inherit; font-size: 13px; font-weight: 500; transition: transform .15s, background .3s; box-shadow: var(--ha-card-box-shadow, none); }
      button:active { transform: scale(.95); }
      button ha-icon { --mdc-icon-size: 18px; color: var(--primary-color); }
      button.busy { opacity: .6; }
      button.done { background: color-mix(in srgb, var(--primary-color) 22%, var(--card-background-color)); }
      button.off ha-icon { color: var(--error-color, #ef4444); }
    </style>
    <div class="bar">
      ${items.map((x, i) => `<button data-i="${i}" class="${x.entity === "__all_off__" ? "off" : ""}" title="${esc(x.name)}"><ha-icon icon="${esc(x.icon)}"></ha-icon>${esc(x.name)}</button>`).join("")}
    </div>`;
    this.shadowRoot.querySelectorAll("button").forEach((b) => (b.onclick = () => this._run(items[Number(b.dataset.i)], b)));
  }
}

// ---------- uz-person-card (Personen mit „seit …“) ----------
// config: { entities: ["person.x"] }

class UzPersonCard extends HTMLElement {
  setConfig(config) {
    this._config = { entities: [], ...config };
    this._sig = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    this._timer = setInterval(() => {
      this._sig = undefined;
      this._render();
    }, 60000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  _render() {
    if (!this._config || !this._hass) return;
    const people = (this._config.entities || [])
      .map((id) => this._hass.states[id])
      .filter(Boolean)
      .map((s) => {
        const home = s.state === "home";
        const away = s.state === "not_home";
        const zone = !home && !away && !["unknown", "unavailable"].includes(s.state)
          ? (this._hass.formatEntityState ? this._hass.formatEntityState(s) : s.state) : "";
        const where = home ? "Zuhause" : away ? "Unterwegs" : zone || "Unbekannt";
        const name = String(s.attributes.friendly_name || s.entity_id);
        return {
          id: s.entity_id, name, home, pic: s.attributes.entity_picture,
          initials: name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
          text: `${where} ${["unknown", "unavailable"].includes(s.state) ? "" : sinceText(s.last_changed)}`.trim(),
        };
      });
    const sig = JSON.stringify(people);
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
      ha-card { display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; }
      .av { position: relative; width: 38px; height: 38px; flex: none; }
      .av img, .av .ini { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; }
      .av .ini { display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px;
        background: color-mix(in srgb, var(--primary-color) 20%, transparent); color: var(--primary-color); }
      .av .st { position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid var(--card-background-color, #fff); background: var(--disabled-text-color, #9e9e9e); }
      .home .av .st { background: #22c55e; }
      .away { opacity: .8; }
      .n { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .s { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .txt { min-width: 0; }
    </style>
    <div class="grid">
      ${people.map((p, i) => `
        <ha-card class="${p.home ? "home" : "away"}" data-i="${i}">
          <span class="av">${p.pic ? `<img src="${esc(p.pic)}" alt="">` : `<span class="ini">${esc(p.initials)}</span>`}<span class="st"></span></span>
          <span class="txt"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.text)}</div></span>
        </ha-card>`).join("")}
    </div>`;
    this.shadowRoot.querySelectorAll("ha-card").forEach((c) => (c.onclick = () => fireMoreInfo(this, people[Number(c.dataset.i)].id)));
  }
}

// ---------- uz-camera-preview (Live-Bild auf der Startseite) ----------
// config: { camera, cameras: [...], path, hold }
// Zeigt die Hauptkamera live; erkennt eine andere Kamera eine Person oder Bewegung, wechselt das Bild dorthin
// und nach „hold“ Sekunden ohne Aktivität zurück.

class UzCameraPreview extends HTMLElement {
  setConfig(config) {
    this._config = { hold: 30, path: "kameras", ...config };
    this._shown = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  disconnectedCallback() {
    clearTimeout(this._back);
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  _pick() {
    const watch = (this._config.cameras || []).map((c) => (typeof c === "string" ? c : c?.entity)).filter(Boolean);
    const active = watch.map((id) => ({ id, act: cameraActivity(this._hass, id) })).filter((x) => x.act);
    const best = active.find((x) => x.act === "person") || active[0];
    if (best) {
      this._lastActive = best;
      clearTimeout(this._back);
      this._back = undefined;
      return best;
    }
    // Nach der Aktivität noch eine Weile beim auslösenden Bild bleiben
    if (this._lastActive && !this._back) {
      this._back = setTimeout(() => {
        this._lastActive = undefined;
        this._back = undefined;
        this._update();
      }, Number(this._config.hold) * 1000);
    }
    return this._lastActive ? { ...this._lastActive, act: undefined, hold: true } : { id: this._config.camera };
  }

  async _update() {
    if (!this._config || !this._hass) return;
    const cur = this._pick();
    if (!cur.id) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>
        ha-card { overflow: hidden; position: relative; cursor: pointer; }
        .img { background: #000; min-height: 60px; }
        .bar { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px;
          background: linear-gradient(#000a, transparent); color: #fff; font-weight: 500; font-size: 13px; z-index: 1; pointer-events: none; }
        .bar ha-icon { --mdc-icon-size: 16px; }
        .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .act { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; background: var(--act); }
        .act[hidden] { display: none; }
        .live { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; animation: uz-blink 1.4s ease-in-out infinite; }
        @keyframes uz-blink { 50% { opacity: .3; } }
        ha-card.active { outline: 3px solid var(--act); outline-offset: -3px; }
      </style>
      <ha-card><div class="bar"><span class="live"></span><span class="n"></span><span class="act" hidden></span><ha-icon icon="mdi:chevron-right"></ha-icon></div><div class="img"></div></ha-card>`;
      this.shadowRoot.querySelector("ha-card").onclick = () => {
        const first = window.location.pathname.split("/").filter(Boolean)[0] || "lovelace";
        const p = String(this._config.path || "");
        uzNavigate(p.startsWith("/") ? p : `/${first}/${p}`);
      };
    }
    const card = this.shadowRoot.querySelector("ha-card");
    const act = cur.act ? ACTIVITY[cur.act] : undefined;
    card.classList.toggle("active", !!act);
    card.style.setProperty("--act", act ? act.color : "transparent");
    const badge = this.shadowRoot.querySelector(".act");
    badge.hidden = !act;
    badge.textContent = act ? act.label : "";
    this.shadowRoot.querySelector(".n").textContent = String(this._hass.states[cur.id]?.attributes?.friendly_name || cur.id);
    if (this._shown !== cur.id) {
      // Nur beim Kamerawechsel neu aufbauen (Stream läuft sonst weiter)
      this._shown = cur.id;
      const helpers = await window.loadCardHelpers?.();
      const el = helpers?.createCardElement?.({
        type: "picture-entity", entity: cur.id, camera_view: "live", show_name: false, show_state: false, aspect_ratio: "16:9",
        tap_action: { action: "none" },
      });
      if (el && this._shown === cur.id) {
        el.hass = this._hass;
        this._img = el;
        this.shadowRoot.querySelector(".img").replaceChildren(el);
      }
    } else if (this._img) {
      this._img.hass = this._hass;
    }
  }
}

if (!customElements.get("uz-greeting-card")) {
  customElements.define("uz-greeting-card", UzGreetingCard);
  customElements.define("uz-alerts-card", UzAlertsCard);
  customElements.define("uz-running-card", UzRunningCard);
  customElements.define("uz-scene-bar", UzSceneBar);
  customElements.define("uz-person-card", UzPersonCard);
  customElements.define("uz-camera-preview", UzCameraPreview);
  window.customCards = window.customCards || [];
  window.customCards.push(
    { type: "uz-greeting-card", name: "UZ Begrüßung", description: "Begrüßung mit Hintergrund nach Tageszeit und Wetter, Kurzinfo als Chips." },
    { type: "uz-alerts-card", name: "UZ Was ist los?", description: "Hinweise, nur wenn etwas zu tun ist: Fenster offen bei Abwesenheit, Kameras, Batterien, Updates." },
    { type: "uz-running-card", name: "UZ Läuft gerade", description: "Laufende Geräte mit bewegtem Symbol (Trockner, Wärmepumpe, Wallbox, Akku …)." },
    { type: "uz-scene-bar", name: "UZ Szenen-Leiste", description: "Szenen und Skripte mit einem Tipp, dazu „Alles aus“." },
    { type: "uz-person-card", name: "UZ Personen", description: "Personen mit Bild und „Zuhause seit …“ / „Unterwegs seit …“." },
    { type: "uz-camera-preview", name: "UZ Kamera-Vorschau", description: "Live-Bild der Hauptkamera; wechselt bei Bewegung zur auslösenden Kamera." },
  );
}

// ---------- Energie pro Woche ----------

// Kalenderwoche nach ISO 8601
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

// Montag 0 Uhr (Ortszeit) vor n Wochen
function weekStart(weeksAgo, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * weeksAgo);
  return d;
}

// Wochensummen aus den Statistiken: Verbrauch = PV + Kauf + Akku raus − Verkauf − Akku rein
function energyWeeks(stats, energy, weeks, now = new Date()) {
  const rows = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = weekStart(i, now);
    let has = false;
    const sum = (key) => {
      const id = energy[key];
      if (!id) return undefined;
      const r = (stats[id] || []).find((x) => Math.abs(Number(x.start) - start.getTime()) < 3 * 3600000);
      if (r && Number.isFinite(r.change)) has = true;
      return r && Number.isFinite(r.change) ? r.change : 0;
    };
    const v = { solar: sum("solar"), grid_in: sum("grid_in"), grid_out: sum("grid_out"), battery_in: sum("battery_in"), battery_out: sum("battery_out") };
    const z = (x) => x || 0;
    rows.push({
      start,
      week: isoWeek(start),
      current: i === 0,
      use: Math.max(0, z(v.solar) + z(v.grid_in) + z(v.battery_out) - z(v.grid_out) - z(v.battery_in)),
      solar: v.solar,
      grid_in: v.grid_in,
      grid_out: v.grid_out,
      has,
    });
  }
  // Wochen vor Beginn der Aufzeichnung weglassen
  const first = rows.findIndex((r) => r.has);
  return first < 0 ? rows.slice(-1) : rows.slice(first);
}

const WEEK_SERIES = [
  { key: "use", label: "Verbrauch", color: "var(--uz-week-use, #14b8a6)" },
  { key: "solar", label: "PV", color: "var(--energy-solar-color, #ff9800)" },
  { key: "grid_in", label: "Kauf", color: "var(--energy-grid-consumption-color, #488fc2)" },
  { key: "grid_out", label: "Verkauf", color: "var(--energy-grid-return-color, #8353d1)" },
];

class UzEnergyWeeksCard extends HTMLElement {
  setConfig(config) {
    if (!config.energy || typeof config.energy !== "object") throw new Error("energy (Statistik-IDs) fehlt");
    this._config = { title: "Energie pro Woche", weeks: 12, ...config };
    this._loadedAt = 0;
  }

  set hass(hass) {
    this._hass = hass;
    // Statistiken ändern sich langsam: höchstens alle 15 Minuten neu laden
    if (Date.now() - this._loadedAt > 15 * 60000) this._load();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  async _load() {
    if (!this._hass || !this._config) return;
    this._loadedAt = Date.now();
    const weeks = Math.max(2, Math.min(52, Number(this._config.weeks) || 12));
    const ids = [...new Set(Object.values(this._config.energy).filter(Boolean))];
    let stats = {};
    try {
      stats = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: weekStart(weeks - 1).toISOString(),
        statistic_ids: ids,
        period: "week",
        types: ["change"],
      });
    } catch (e) {
      this._error = e.message || String(e);
    }
    this._rows = energyWeeks(stats || {}, this._config.energy, weeks);
    this._render();
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const rows = this._rows || [];
    const series = WEEK_SERIES.filter((s) => s.key === "use" || rows.some((r) => r[s.key] !== undefined));
    const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0)));
    const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((x) => max / x <= 5) || Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step;
    const W = 1000, H = 300, L = 46, B = 28, T = 10;
    const gw = (W - L - 6) / Math.max(1, rows.length);
    const bw = Math.min(16, (gw - 10) / series.length);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const kwh = (v) => `${(Math.round(v * 10) / 10).toString().replace(".", ",")} kWh`;
    let svg = "";
    for (let v = 0; v <= top; v += step) {
      svg += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
    }
    rows.forEach((r, i) => {
      const x0 = L + i * gw + (gw - bw * series.length) / 2;
      series.forEach((s, j) => {
        const v = r[s.key] || 0;
        const h = Math.max(0, y(0) - y(v));
        svg += `<rect x="${x0 + j * bw}" y="${y(0) - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" fill="${s.color}"${r.current ? ' opacity="0.55"' : ""}><title>KW ${r.week}${r.current ? " (läuft noch)" : ""} · ${s.label}: ${kwh(v)}</title></rect>`;
      });
      svg += `<text x="${L + i * gw + gw / 2}" y="${H - 8}" class="ax" text-anchor="middle">${r.current ? "jetzt" : `KW ${r.week}`}</text>`;
    });
    const done = rows.filter((r) => !r.current && r.has);
    const avg = (k) => (done.length ? done.reduce((a, r) => a + (r[k] || 0), 0) / done.length : 0);
    const legend = series
      .map((s) => `<span class="lg"><i style="background:${s.color}"></i>${s.label}<b>⌀ ${kwh(avg(s.key))}</b></span>`)
      .join("");
    this.shadowRoot.innerHTML = `<style>
        ha-card { padding: 12px 16px 10px; }
        .h { font-size: 16px; font-weight: 500; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .h small { color: var(--secondary-text-color); font-weight: 400; font-size: 12px; }
        svg { width: 100%; height: auto; display: block; }
        .grid { stroke: var(--divider-color, #8884); stroke-width: 1; }
        .ax { fill: var(--secondary-text-color); font-size: 13px; }
        .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; font-size: 13px; }
        .lg { display: inline-flex; align-items: center; gap: 6px; }
        .lg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
        .lg b { font-weight: 500; color: var(--secondary-text-color); }
        .err { color: var(--error-color); font-size: 13px; }
      </style>
      <ha-card>
        <div class="h">${this._config.title}<small>letzte ${rows.length} Wochen · ⌀ ohne laufende Woche</small></div>
        ${this._error ? `<div class="err">Statistiken nicht lesbar: ${this._error}</div>` : ""}
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${this._config.title}">${svg}</svg>
        <div class="legend">${legend}</div>
      </ha-card>`;
  }
}

if (!customElements.get("uz-energy-weeks-card")) {
  customElements.define("uz-energy-weeks-card", UzEnergyWeeksCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "uz-energy-weeks-card",
    name: "UZ Energie pro Woche",
    description: "Verbrauch, PV, Kauf und Verkauf pro Kalenderwoche als Balken (aus dem Energie-Dashboard).",
  });
}

// ---------- Batterien ----------
// Alle batteriebetriebenen Geräte, je Gerät ein Eintrag. Nutzt Battery Notes (Typ, Anzahl, eigene
// Schwelle, zuletzt gewechselt, Knopf „Batterie gewechselt“), sonst den Batterie-Sensor des Geräts.
// Handys (mobile_app) und Einstellwerte wie min. SoC zählen nicht.
function batteryDevices(hass, threshold = 15) {
  const st = hass?.states || {};
  const byDev = {};
  Object.values(st).forEach((s) => {
    if (s.attributes?.device_class !== "battery") return;
    const domain = s.entity_id.split(".")[0];
    if (domain !== "sensor" && domain !== "binary_sensor") return;
    const reg = hass.entities?.[s.entity_id];
    if (!reg?.device_id || reg.hidden || reg.platform === "mobile_app" || /soc/.test(s.entity_id)) return;
    const d = (byDev[reg.device_id] ||= { device_id: reg.device_id });
    if (domain === "binary_sensor") d.flag = s;
    else if (reg.platform === "battery_notes" || "battery_type_and_quantity" in s.attributes) d.plus = s;
    else d.native = s;
  });
  // Weitere Entitäten von Battery Notes am Gerät: Knopf „Batterie gewechselt“, Sensor Batterietyp
  Object.values(hass.entities || {}).forEach((e) => {
    const d = e.device_id && byDev[e.device_id];
    if (!d) return;
    if (e.entity_id.startsWith("button.") && /battery_replaced$/.test(e.entity_id)) d.button = e.entity_id;
    if (e.entity_id.startsWith("sensor.") && /battery_type$/.test(e.entity_id)) d.typeSensor = e.entity_id;
  });
  const bad = (v) => !v || ["unknown", "unavailable"].includes(v);
  return Object.values(byDev)
    .filter((d) => d.plus || d.native || d.flag)
    .map((d) => {
      const level = parseFloat((d.plus || d.native)?.state);
      const a = d.plus?.attributes || {};
      const device = hass.devices?.[d.device_id];
      const src = d.plus || d.native || d.flag;
      const areaId = hass.entities?.[src.entity_id]?.area_id || device?.area_id;
      // Ist der Batterie-Sensor nicht erreichbar, fehlen seine Attribute → Typ-Sensor von Battery Notes ("2× AAA")
      const ts = st[d.typeSensor];
      const m = /^(\d+)\s*[×x]\s*(.+)$/.exec(String(ts?.state || ""));
      const type = a.battery_type || ts?.attributes?.battery_type || (m ? m[2] : ts?.state);
      const qty = Number(a.battery_quantity || ts?.attributes?.battery_quantity || (m ? m[1] : 1)) || 1;
      const known = Number.isFinite(level);
      return {
        id: d.device_id,
        entity: src.entity_id,
        name: device?.name_by_user || device?.name || src.attributes?.friendly_name || src.entity_id,
        area: hass.areas?.[areaId]?.name || "",
        level: known ? level : null,
        unavailable: !known && !(d.flag && ["on", "off"].includes(d.flag.state)),
        low: a.battery_low === true || d.flag?.state === "on" || (known && threshold > 0 && level < threshold),
        type: bad(type) ? "" : String(type),
        quantity: qty,
        replaced: a.battery_last_replaced ? String(a.battery_last_replaced) : "",
        button: d.button,
      };
    })
    .sort((x, y) => (y.low - x.low) || ((x.level ?? -1) - (y.level ?? -1)) || x.name.localeCompare(y.name, "de"));
}

// "vor 3 Monaten"
function uzAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = (t - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  for (const [u, s] of units) if (Math.abs(sec) >= s) return rtf.format(Math.round(sec / s), u);
  return "gerade eben";
}

function uzBatteryIcon(b) {
  if (b.level === null) return b.low ? "mdi:battery-alert-variant-outline" : b.unavailable ? "mdi:battery-unknown" : "mdi:battery";
  const step = Math.round(b.level / 10) * 10;
  if (b.type === "Rechargeable") return `mdi:battery-charging-${Math.min(100, Math.max(10, step))}`;
  return step >= 100 ? "mdi:battery" : step <= 0 ? "mdi:battery-outline" : `mdi:battery-${step}`;
}

// Benötigte Batterien als Text: "2× AAA", "Akku"
const uzBatteryNeed = (b) => (b.type === "Rechargeable" ? "Akku" : b.type ? `${b.quantity}× ${b.type}` : "");

// ---------- uz-battery-card (Batterien: was muss gewechselt werden?) ----------
// config: { title, threshold: 15, soon: 30, show_ok: true }
class UzBatteryCard extends HTMLElement {
  setConfig(config) {
    this._config = { title: "Batterien", threshold: 15, soon: 30, show_ok: true, ...config };
    this._sig = undefined;
    this._open = false;
    this._confirm = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  _render() {
    if (!this._config || !this._hass) return;
    const c = this._config;
    const all = batteryDevices(this._hass, Number(c.threshold));
    const soonLimit = Number(c.soon) || 0;
    const low = all.filter((b) => b.low);
    const soon = all.filter((b) => !b.low && b.level !== null && b.level < soonLimit);
    const off = all.filter((b) => !b.low && b.unavailable);
    const ok = all.filter((b) => !low.includes(b) && !soon.includes(b) && !off.includes(b));
    const sig = JSON.stringify([all, this._open, this._confirm]);
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    // Einkaufsliste: Typen der leeren Batterien zusammengezählt
    const shop = {};
    low.forEach((b) => b.type && b.type !== "Rechargeable" && (shop[b.type] = (shop[b.type] || 0) + b.quantity));
    const shopText = Object.entries(shop).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${n}× ${t}`).join(" · ");
    const charge = low.filter((b) => b.type === "Rechargeable").length;

    const row = (b, color) => {
      const sub = [b.area, b.replaced && `gewechselt ${uzAgo(b.replaced)}`].filter(Boolean).join(" · ");
      const value = b.level !== null ? `${Math.round(b.level)} %` : b.unavailable ? "?" : b.low ? "leer" : "ok";
      const need = uzBatteryNeed(b);
      const sure = this._confirm === b.button;
      const btn = b.button && (b.low || sure)
        ? `<button class="rep${sure ? " sure" : ""}" data-btn="${esc(b.button)}">${sure ? "Wirklich?" : "Gewechselt"}</button>`
        : "";
      return `<div class="row" data-entity="${esc(b.entity)}" style="--c:${color}">
          <span class="ic"><ha-icon icon="${uzBatteryIcon(b)}"></ha-icon></span>
          <span class="txt"><div class="t">${esc(b.name)}</div>${sub ? `<div class="d">${esc(sub)}</div>` : ""}</span>
          <span class="type${need ? "" : " none"}" title="Benötigte Batterien">${need ? esc(need) : "Typ fehlt"}</span>
          ${btn}<span class="v">${value}</span>
        </div>`;
    };
    const group = (title, list, color, icon) => list.length
      ? `<div class="gh" style="--c:${color}"><ha-icon icon="${icon}"></ha-icon>${title}<span class="n">${list.length}</span></div>${list.map((b) => row(b, color)).join("")}`
      : "";

    this.shadowRoot.innerHTML = `<style>
      ha-card { overflow: hidden; padding-bottom: 6px; }
      .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 6px; }
      .head ha-icon { --mdc-icon-size: 22px; color: var(--primary-color); }
      .head .h { font-size: 16px; font-weight: 500; flex: 1; }
      .head small { color: var(--secondary-text-color); font-size: 12px; }
      .shop { margin: 4px 16px 6px; padding: 10px 12px; border-radius: 12px; font-size: 13px;
        background: color-mix(in srgb, #f59e0b 12%, transparent); display: flex; gap: 10px; align-items: center; }
      .shop ha-icon { --mdc-icon-size: 20px; color: #f59e0b; flex: none; }
      .shop b { font-weight: 600; }
      .gh { display: flex; align-items: center; gap: 8px; padding: 12px 16px 4px; font-size: 13px; font-weight: 600; color: var(--c); }
      .gh ha-icon { --mdc-icon-size: 18px; }
      .gh .n { margin-left: auto; font-weight: 500; color: var(--secondary-text-color); }
      .row { display: flex; align-items: center; gap: 10px; padding: 7px 16px; cursor: pointer; }
      .row:hover { background: var(--secondary-background-color); }
      .ic { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none;
        background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c); }
      .ic ha-icon { --mdc-icon-size: 20px; }
      .txt { flex: 1; min-width: 0; }
      .t { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .d { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .type { flex: none; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 8px; white-space: nowrap;
        background: var(--secondary-background-color); color: var(--primary-text-color); }
      .type.none { font-weight: 400; color: var(--secondary-text-color); background: none; border: 1px dashed var(--divider-color); }
      .v { font-size: 14px; font-weight: 600; min-width: 42px; text-align: right; color: var(--c); }
      .rep { flex: none; border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); border-radius: 14px;
        padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
      .rep.sure { background: var(--c); border-color: var(--c); color: #fff; }
      .more { display: block; width: calc(100% - 32px); margin: 6px 16px 4px; padding: 8px; border: none; border-radius: 10px; cursor: pointer;
        background: var(--secondary-background-color); color: var(--primary-text-color); font: inherit; font-size: 13px; }
      .empty { padding: 8px 16px 12px; color: var(--secondary-text-color); font-size: 14px; }
      @media (max-width: 450px) { .row { flex-wrap: wrap; } .type { order: 5; margin-left: 44px; } }
    </style>
    <ha-card>
      <div class="head"><ha-icon icon="mdi:battery-heart-variant"></ha-icon><span class="h">${esc(c.title)}</span>
        <small>${all.length} ${all.length === 1 ? "Gerät" : "Geräte"}</small></div>
      ${shopText || charge ? `<div class="shop"><ha-icon icon="mdi:cart-outline"></ha-icon><span>${shopText ? `Einkaufsliste: <b>${esc(shopText)}</b>` : ""}${shopText && charge ? " · " : ""}${charge ? `${charge} ${charge === 1 ? "Akku" : "Akkus"} laden` : ""}</span></div>` : ""}
      ${!all.length ? `<div class="empty">Keine batteriebetriebenen Geräte gefunden.</div>` : ""}
      ${all.length && !low.length ? `<div class="empty">Alles gut – keine Batterie muss gewechselt werden.</div>` : ""}
      ${group("Jetzt wechseln", low, "#ef4444", "mdi:battery-alert-variant-outline")}
      ${group(`Bald (unter ${soonLimit} %)`, soon, "#f59e0b", "mdi:battery-low")}
      ${group("Nicht erreichbar", off, "#9ca3af", "mdi:battery-unknown")}
      ${c.show_ok && ok.length
        ? this._open
          ? group("In Ordnung", ok, "#22c55e", "mdi:battery-check-outline") + `<button class="more" id="toggle">Weniger anzeigen</button>`
          : `<button class="more" id="toggle">Alle anzeigen (${ok.length} in Ordnung)</button>`
        : ""}
    </ha-card>`;
    const toggle = this.shadowRoot.getElementById("toggle");
    if (toggle) toggle.onclick = () => { this._open = !this._open; this._render(); };
    this.shadowRoot.querySelectorAll(".row").forEach((r) => {
      r.onclick = (ev) => {
        const btn = ev.composedPath().find((n) => n.dataset?.btn);
        if (!btn) return fireMoreInfo(this, r.dataset.entity);
        ev.stopPropagation();
        const id = btn.dataset.btn;
        // Zwei Klicks: erst „Wirklich?“, dann den Knopf von Battery Notes drücken
        if (this._confirm !== id) {
          this._confirm = id;
          clearTimeout(this._confirmTimer);
          this._confirmTimer = setTimeout(() => { this._confirm = null; this._render(); }, 4000);
        } else {
          this._confirm = null;
          this._hass.callService("button", "press", { entity_id: id });
        }
        this._render();
      };
    });
  }
}

if (!customElements.get("uz-battery-card")) {
  customElements.define("uz-battery-card", UzBatteryCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "uz-battery-card",
    name: "UZ Batterien",
    description: "Alle Batterie-Geräte mit benötigtem Batterietyp: was jetzt gewechselt werden muss (mit Einkaufsliste), was bald dran ist, Knopf „Gewechselt“ (Battery Notes).",
  });
}
