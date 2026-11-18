/*
 * protect-camera-card
 * Camera overview for UniFi Protect in Home Assistant.
 *
 * Overview: regularly refreshed snapshots, event count for the last 24 hours per camera
 * and a strip of the most recent events across cameras.
 * Tap a camera: high-resolution live view (WebRTC, with HA's player as fallback),
 * control buttons and the camera's events. Tap an event to play the clip in place.
 *
 * Events come from the UniFi Protect integration's media source (the same source as the
 * Media panel in HA). No extra integrations are required.
 *
 * Note: events are read by interpreting media source IDs and titles produced by the
 * UniFi Protect integration. These are not a public API and may change between HA releases.
 */

const CARD_VERSION = "0.4.1";

const DEFAULTS = {
  title: null, // null: translated default
  columns: 4,
  refresh_seconds: 10,
  events_refresh_seconds: 90,
  event_type: "all", // all | smart | motion | ring | audio
  exclude: ["audio"], // hidden kinds: person, vehicle, animal, package, ring, motion, audio, other
  snapshot_width: 640,
  strip_limit: 16,
  list_limit: 40,
};

const I18N = {
  en: {
    title: "Cameras",
    need_camera: "Add at least one camera under cameras:",
    bad_start_view: (v) => `start_view must be overview or live, not "${v}".`,
    bad_start_camera: (e) => `start_camera "${e}" is not in the cameras list.`,
    refresh: "Refresh",
    back: "Back to all cameras",
    mute: "Sound on/off",
    fullscreen: "Fullscreen",
    unavailable: "Unavailable",
    recent: "Recent events",
    live: "Live",
    events_24h: "Events, last 24 hours",
    missing: "missing",
    on: "on",
    off: "off",
    live_failed: "Live view could not be started:",
    loading_clip: "Loading recording …",
    recording: "Recording",
    back_live: "Back to live",
    clip_failed: "The recording could not be played:",
    no_console: "No UniFi Protect console found in media source.",
    n_events: (n) => `${n} events in the last 24 hours`,
    events_sub: "events in the last 24 hours",
    at: "at",
    no_events: "No events in the last 24 hours.",
    protect_error: "Could not load events from UniFi Protect:",
    unmatched: (cams, names) =>
      `No Protect camera found for ${cams}. Set <code>protect_name</code> to one of: ${names}.`,
    not_linked:
      "This camera is not linked to a Protect source. Set <code>protect_name</code> or <code>protect_id</code>.",
    loading_events: "Loading events …",
    yesterday: "yesterday",
    parse_none:
      "Events were returned but none could be interpreted. The UniFi Protect integration may have changed its format.",
    kinds: {
      person: "Person",
      vehicle: "Vehicle",
      animal: "Animal",
      package: "Package",
      ring: "Doorbell",
      motion: "Motion",
      audio: "Sound",
      other: "Event",
    },
    objects: {},
    sounds: {},
  },
  nb: {
    title: "Kameraer",
    need_camera: "Legg inn minst ett kamera under cameras:",
    bad_start_view: (v) => `start_view må være overview eller live, ikke «${v}».`,
    bad_start_camera: (e) => `start_camera «${e}» finnes ikke i cameras-listen.`,
    refresh: "Oppdater",
    back: "Tilbake til alle kameraer",
    mute: "Lyd av/på",
    fullscreen: "Fullskjerm",
    unavailable: "Utilgjengelig",
    recent: "Siste hendelser",
    live: "Direkte",
    events_24h: "Hendelser siste døgn",
    missing: "mangler",
    on: "på",
    off: "av",
    live_failed: "Direktevisning kunne ikke startes:",
    loading_clip: "Henter opptak …",
    recording: "Opptak",
    back_live: "Tilbake til direkte",
    clip_failed: "Opptaket kunne ikke spilles av:",
    no_console: "Fant ingen UniFi Protect-konsoll i media source.",
    n_events: (n) => `${n} hendelser siste døgn`,
    events_sub: "hendelser siste døgn",
    at: "kl.",
    no_events: "Ingen hendelser siste døgn.",
    protect_error: "Fant ikke hendelser fra UniFi Protect:",
    unmatched: (cams, names) =>
      `Fant ikke Protect-kamera for ${cams}. Sett <code>protect_name</code> til ett av disse: ${names}.`,
    not_linked:
      "Kameraet er ikke koblet til en Protect-kilde. Sett <code>protect_name</code> eller <code>protect_id</code>.",
    loading_events: "Henter hendelser …",
    yesterday: "i går",
    parse_none:
      "Det kom hendelser, men ingen kunne tolkes. UniFi Protect-integrasjonen kan ha endret format.",
    kinds: {
      person: "Person",
      vehicle: "Kjøretøy",
      animal: "Dyr",
      package: "Pakke",
      ring: "Ringeklokke",
      motion: "Bevegelse",
      audio: "Lyd",
      other: "Hendelse",
    },
    objects: {
      person: "Person",
      vehicle: "Kjøretøy",
      animal: "Dyr",
      package: "Pakke",
      face: "Ansikt",
      "license plate": "Skilt",
    },
    sounds: {
      speak: "Tale",
      bark: "Hundebjeff",
      smoke: "Røykvarsler",
      "smoke cmonx": "Røyk/CO-varsler",
      cmonx: "CO-varsler",
      "baby cry": "Babygråt",
      "car horn": "Bilhorn",
      siren: "Sirene",
      "glass break": "Glassknusing",
      "burglar alarm": "Innbruddsalarm",
    },
  },
};

/** Picks a dictionary: explicit `language` config, then HA's UI language. Norwegian variants map to nb. */
function pickLang(config, hass) {
  const raw = String(config?.language || hass?.locale?.language || hass?.language || "en").toLowerCase();
  return /^(nb|nn|no)\b/.test(raw) ? "nb" : I18N[raw.split("-")[0]] ? raw.split("-")[0] : "en";
}

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

function kindOf(text) {
  const t = String(text).toLowerCase();
  if (/person|face/.test(t)) return "person";
  if (/vehicle|car|truck|van|suv|license|motorcycle|bicycle/.test(t)) return "vehicle";
  if (/animal/.test(t)) return "animal";
  if (/package/.test(t)) return "package";
  return "other";
}

const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);

/** One icon per event kind, so kinds can be told apart without relying on color. */
const KIND_ICONS = {
  person: "mdi:account",
  vehicle: "mdi:car",
  animal: "mdi:paw",
  package: "mdi:package-variant-closed",
  ring: "mdi:doorbell",
  motion: "mdi:motion-sensor",
  audio: "mdi:waveform",
  other: "mdi:record-circle-outline",
};

const kindIcon = (kind) =>
  `<ha-icon class="kind k-${kind}" icon="${KIND_ICONS[kind] || KIND_ICONS.other}" aria-hidden="true"></ha-icon>`;

/**
 * The view the card opens in. `start_camera` matches a camera's `entity` or `live_entity`.
 * `start_view` is `overview` or `live`; it defaults to `live` when `start_camera` is set.
 */
function startView(config, cams, L = I18N.en) {
  const want = config.start_view ?? (config.start_camera ? "live" : "overview");
  if (want === "overview") return { name: "overview" };
  if (want !== "live") throw new Error(L.bad_start_view(want));
  const cam = config.start_camera
    ? cams.find((c) => c.entity === config.start_camera || c.live_entity === config.start_camera)
    : cams[0];
  if (!cam) throw new Error(L.bad_start_camera(config.start_camera));
  return { name: "camera", key: cam.key, clip: null };
}

/**
 * Interprets one event item from the UniFi Protect media source.
 * `L` is a dictionary from I18N. `recognized` is false when the title matched no known pattern,
 * which usually means the integration changed its title format.
 */
function parseEvent(item, L = I18N.en) {
  const mid = item.media_content_id || "";
  const id = mid.split(":").pop();
  const title = item.title || "";
  // UniFi event IDs are ObjectIds: the first 8 hex characters are a unix timestamp in seconds.
  const ts = /^[0-9a-f]{24}$/i.test(id) ? parseInt(id.slice(0, 8), 16) * 1000 : null;

  let kind = "other";
  let label = L.kinds.other;
  let recognized = true;
  const obj = title.match(/Object Detection - (.+)$/);
  const aud = title.match(/Audio Detection - (.+)$/);
  if (/Ring Event/.test(title)) {
    kind = "ring";
    label = L.kinds.ring;
  } else if (/Motion Event/.test(title)) {
    kind = "motion";
    label = L.kinds.motion;
  } else if (obj) {
    const parts = obj[1].split(", ").map((x) => x.trim());
    kind = kindOf(parts[0]);
    label = parts.map((x) => L.objects[x.toLowerCase()] ?? cap(x)).join(", ");
  } else if (aud) {
    kind = "audio";
    const sounds = aud[1].split(", ").map((x) => L.sounds[x.trim().toLowerCase()] ?? cap(x.trim()));
    label = `${L.kinds.audio}: ${sounds.join(", ")}`;
  } else {
    recognized = false;
  }

  const dur = title.match(/\s((?:\d+h\s)?(?:\d+m\s)?\d+s)\s/);
  const hm = title.match(/(\d{1,2})[:.](\d{2})[:.]\d{2}/);
  return {
    id,
    mid,
    ts,
    kind,
    label,
    recognized,
    duration: dur ? dur[1] : "",
    clock: hm ? `${hm[1].padStart(2, "0")}:${hm[2]}` : "",
    thumb: item.thumbnail || null,
  };
}

/**
 * Protect camera ID from a resolved event clip URL
 * (/api/unifiprotect/video/{nvr}/{camera}/{start}/{end}). Events under "All cameras"
 * carry no camera in their ID or title, so this is how the strip finds the camera.
 */
function cameraFromVideoUrl(url) {
  const m = String(url ?? "").match(/\/api\/unifiprotect\/video\/[^/?]+\/([^/?]+)\/[^/?]+\/[^/?]+/);
  return m ? m[1] : null;
}

/** Time of an event: "14:05" today, "yesterday 14:05", otherwise a short date. */
function fmtTime(ev, L = I18N.en, locale = "en", now = new Date()) {
  if (!ev.ts) return ev.clock;
  const d = new Date(ev.ts);
  const t = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return t;
  if (diff === 1) return `${L.yesterday} ${t}`;
  return `${d.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${t}`;
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 16px; overflow: hidden; }
  .wrap { container-type: inline-size; color: var(--primary-text-color); }
  button { font: inherit; color: inherit; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  .bar { display: flex; align-items: center; gap: 12px; min-height: 40px; margin-bottom: 12px; }
  .bar h2 { margin: 0; font-size: 1.35rem; font-weight: 600; letter-spacing: -0.01em; }
  .bar .meta { color: var(--secondary-text-color); font-size: 0.9rem; }
  .bar .spacer { flex: 1; }
  .icon { all: unset; cursor: pointer; display: grid; place-items: center; width: 40px; height: 40px;
    border-radius: 50%; color: var(--primary-text-color); }
  .icon:hover { background: rgba(127,127,127,.15); }
  .icon[hidden] { display: none; }
  .icon:focus-visible { outline: 2px solid var(--primary-color); }

  /* Oversikt */
  .grid { display: grid; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); gap: 10px; }
  .tile { all: unset; cursor: pointer; position: relative; aspect-ratio: 16 / 9; overflow: hidden;
    border-radius: var(--ha-card-border-radius, 12px); background: #000; }
  .tile:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .tile img.snap { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .tile .shade { position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,0) 45%); }
  .tile .cap { position: absolute; left: 12px; right: 12px; bottom: 10px; color: #fff;
    display: flex; flex-direction: column; gap: 2px; }
  .tile .name { font-size: 1rem; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
  .tile .last { font-size: 0.8rem; opacity: .85; display: flex; align-items: center; gap: 6px; }
  .tile .badge { position: absolute; top: 8px; right: 8px; min-width: 22px; padding: 2px 8px; border-radius: 11px;
    background: rgba(0,0,0,.6); color: #fff; font-size: 0.8rem; font-weight: 600; text-align: center;
    font-variant-numeric: tabular-nums; }
  .tile .badge:empty { display: none; }
  .tile .off { position: absolute; inset: 0; display: grid; place-items: center; color: #fff;
    background: rgba(0,0,0,.6); font-size: 0.9rem; }
  .tile .off[hidden] { display: none; }

  .summary { cursor: default; background: var(--secondary-background-color, rgba(127,127,127,.12));
    color: var(--primary-text-color); padding: 14px 16px; box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: center; gap: 8px; }
  .summary .big { font-size: 2rem; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
  .summary .sub { color: var(--secondary-text-color); font-size: 0.85rem; }
  .summary ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.85rem; }
  .summary li { display: flex; align-items: center; gap: 6px; }

  /* Event kinds: an icon per kind in a muted color. Themes can set --protect-event-color
     for all kinds, or --protect-event-<kind>-color for one kind. */
  .kind { --mdc-icon-size: 16px; display: inline-flex; flex: none;
    color: var(--k, var(--protect-event-color, var(--secondary-text-color))); }
  .tile .kind { color: var(--k, currentColor); }
  .k-person { --k: var(--protect-event-person-color); }
  .k-vehicle { --k: var(--protect-event-vehicle-color); }
  .k-animal { --k: var(--protect-event-animal-color); }
  .k-package { --k: var(--protect-event-package-color); }
  .k-ring { --k: var(--protect-event-ring-color); }
  .k-motion { --k: var(--protect-event-motion-color); }
  .k-audio { --k: var(--protect-event-audio-color); }
  .k-other { --k: var(--protect-event-other-color); }

  .strip { margin-top: 18px; }
  .strip h3, .side h3 { margin: 0 0 10px; font-size: 1rem; font-weight: 600; }
  .strip-row { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 6px; }
  .sitem { all: unset; cursor: pointer; flex: none; width: 168px; scroll-snap-align: start; }
  .sitem.static { cursor: default; }
  .sitem:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 8px; }
  .thumb { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px;
    background: rgba(127,127,127,.18); }
  .sitem .l1 { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 0.85rem; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sitem .l2 { color: var(--secondary-text-color); font-size: 0.8rem; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .note { color: var(--secondary-text-color); font-size: 0.9rem; padding: 6px 0; }

  /* Kameravisning */
  .cam-body { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
  .stage { position: relative; aspect-ratio: 16 / 9; background: #000; overflow: hidden;
    border-radius: var(--ha-card-border-radius, 12px); }
  .stage > .media { position: absolute; inset: 0; }
  .stage > .media > * { display: block; width: 100%; height: 100%; }
  .stage video { width: 100%; height: 100%; object-fit: contain; background: #000; }
  .stage .poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 1;
    pointer-events: none; transition: opacity .25s ease; }
  .stage .poster.gone { opacity: 0; }
  @media (prefers-reduced-motion: reduce) { .stage .poster { transition: none; } }
  .stage .tools { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; z-index: 2; }
  .stage .tools .icon { background: rgba(0,0,0,.55); color: #fff; }
  .stage .golive { all: unset; cursor: pointer; position: absolute; left: 12px; bottom: 12px; z-index: 2;
    padding: 8px 14px; border-radius: 18px; background: rgba(0,0,0,.65); color: #fff; font-size: 0.9rem; }
  .stage .golive:focus-visible { outline: 2px solid #fff; }
  .stage .msg { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; padding: 16px;
    text-align: center; }
  .mode { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--secondary-text-color); }
  .mode.live::before { content: ""; width: 8px; height: 8px; border-radius: 50%;
    background: var(--protect-live-color, currentColor); }

  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .controls:empty { display: none; }
  .pill { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px;
    border-radius: 20px; background: var(--secondary-background-color, rgba(127,127,127,.12)); font-size: 0.9rem; }
  .pill.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .pill:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .pill .st { opacity: .75; font-size: 0.8rem; }

  .events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px;
    max-height: 62vh; overflow-y: auto; }
  .ev { all: unset; cursor: pointer; box-sizing: border-box; width: 100%; display: grid;
    grid-template-columns: 96px 1fr; gap: 12px; align-items: center; padding: 6px; border-radius: 10px; }
  .ev:hover { background: rgba(127,127,127,.1); }
  .ev[aria-current="true"] { background: rgba(127,127,127,.2); }
  .ev:focus-visible { outline: 2px solid var(--primary-color); }
  .ev .t { font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ev .l { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
  .ev .d { color: var(--secondary-text-color); font-size: 0.8rem; }

  @container (max-width: 1000px) { .cam-body { grid-template-columns: 1fr; } .events { max-height: none; } }
  @container (max-width: 760px) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .summary { display: none; }
  }
`;

class ProtectCameraCard extends HTMLElement {
  // Exposed for tests.
  static _internals = { parseEvent, fmtTime, pickLang, startView, cameraFromVideoUrl, KIND_ICONS, I18N };

  constructor() {
    super();
    this._view = { name: "overview" };
    this._events = new Map(); // key -> { items, truncated, error }
    this._recent = null; // "All cameras" events for the strip: { items, error }
    this._eventCam = new Map(); // event id -> Protect camera id (null when unknown)
    this._resolving = new Set(); // event ids being looked up
    this._signed = new Map(); // path -> { url, at }
    this._protect = null; // { nvr, ids: Map(key -> cameraId), titles: [] }
    this._protectError = null;
    this._loading = false;
    this._onVis = () => {
      if (!document.hidden) {
        this._refreshSnaps();
        this._loadEvents();
      }
    };
    this._onKey = (e) => {
      if (e.key === "Escape" && this._view.name === "camera") this._go({ name: "overview" });
    };
  }

  static getStubConfig() {
    return { cameras: [{ entity: "camera.example" }] };
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.cameras) || !config.cameras.length) {
      throw new Error(I18N[pickLang(config, this._hass)].need_camera);
    }
    const L = I18N[pickLang(config, this._hass)];
    const cams = config.cameras.map((c, i) => ({
      ...c,
      key: `c${i}`,
      live_entity: c.live_entity || c.entity,
      controls: c.controls || [],
    }));
    const start = startView(config, cams, L); // throws on an invalid start_camera/start_view
    this._config = { ...DEFAULTS, ...config };
    this._cams = cams;
    this._start = start;
    this._protect = null;
    if (this._root) {
      this._go({ ...start });
      this._startTimers();
      this._loadEvents();
    } else {
      this._view = { ...start };
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._root) this._init();
    if (first) {
      this._render();
      this._loadEvents();
    }
    this._update();
  }

  getCardSize() {
    return 10;
  }

  get _L() {
    return I18N[pickLang(this._config, this._hass)];
  }

  get _locale() {
    return this._config?.language || this._hass?.locale?.language || this._hass?.language || "en";
  }

  _time(ev) {
    return fmtTime(ev, this._L, this._locale);
  }

  getGridOptions() {
    return { columns: "full" };
  }

  connectedCallback() {
    // Reattached (a reopened popup, or returning to the dashboard view): the stage was torn
    // down on disconnect, so start over from the configured start view.
    if (this._detached && this._root && this._hass && this._start) {
      this._go({ ...this._start });
      this._loadEvents();
    }
    this._detached = false;
    this._startTimers();
    document.addEventListener("visibilitychange", this._onVis);
    window.addEventListener("keydown", this._onKey);
  }

  disconnectedCallback() {
    this._detached = true;
    clearInterval(this._snapTimer);
    clearInterval(this._evTimer);
    document.removeEventListener("visibilitychange", this._onVis);
    window.removeEventListener("keydown", this._onKey);
    this._teardownStage();
  }

  /* ---------- setup ---------- */

  _init() {
    const sr = this.attachShadow({ mode: "open" });
    sr.innerHTML = `<style>${STYLE}</style><ha-card><div class="wrap"></div></ha-card>`;
    this._root = sr.querySelector(".wrap");
    this._root.addEventListener("click", (e) => this._onClick(e));
  }

  _startTimers() {
    clearInterval(this._snapTimer);
    clearInterval(this._evTimer);
    if (!this._config) return;
    this._snapTimer = setInterval(() => {
      if (!document.hidden && this._view.name === "overview") this._refreshSnaps();
    }, Math.max(2, this._config.refresh_seconds) * 1000);
    this._evTimer = setInterval(() => {
      if (!document.hidden) this._loadEvents();
    }, Math.max(20, this._config.events_refresh_seconds) * 1000);
  }

  _cam(key) {
    return this._cams.find((c) => c.key === key);
  }

  _camName(cam) {
    return cam.name || this._hass?.states[cam.entity]?.attributes.friendly_name || cam.entity;
  }

  _go(view) {
    this._teardownStage();
    this._view = view;
    this._render();
    this._update();
    if (view.name === "overview") this._refreshSnaps();
  }

  /* ---------- rendering ---------- */

  _render() {
    if (!this._root || !this._hass) return;
    if (this._view.name === "camera") this._renderCamera();
    else this._renderOverview();
  }

  _renderOverview() {
    const L = this._L;
    const cols = Math.max(1, Number(this._config.columns) || 4);
    const rest = this._cams.length % cols ? cols - (this._cams.length % cols) : 0;
    const tiles = this._cams
      .map(
        (c) => `
      <button class="tile" data-act="open" data-key="${c.key}" aria-label="${esc(this._camName(c))}">
        <img class="snap" data-snap="${c.key}" alt="">
        <div class="shade"></div>
        <div class="badge" data-badge="${c.key}"></div>
        <div class="cap">
          <span class="name">${esc(this._camName(c))}</span>
          <span class="last" data-last="${c.key}"></span>
        </div>
        <div class="off" data-off="${c.key}" hidden>${esc(L.unavailable)}</div>
      </button>`
      )
      .join("");
    const summary = rest
      ? `<div class="tile summary" style="grid-column: span ${rest}" data-summary></div>`
      : "";

    this._root.innerHTML = `
      <div class="bar">
        <h2>${esc(this._config.title ?? L.title)}</h2>
        <span class="meta" data-meta></span>
        <span class="spacer"></span>
        <button class="icon" data-act="refresh" aria-label="${esc(L.refresh)}"><ha-icon icon="mdi:refresh"></ha-icon></button>
      </div>
      <div class="grid" style="--cols:${cols}">${tiles}${summary}</div>
      <section class="strip">
        <h3>${esc(L.recent)}</h3>
        <div class="strip-row" data-strip></div>
      </section>`;
    this._refreshSnaps(true);
    this._renderEventParts();
  }

  _renderCamera() {
    const L = this._L;
    const cam = this._cam(this._view.key);
    this._root.innerHTML = `
      <div class="bar">
        <button class="icon" data-act="back" aria-label="${esc(L.back)}"><ha-icon icon="mdi:arrow-left"></ha-icon></button>
        <h2>${esc(this._camName(cam))}</h2>
        <span class="mode live" data-mode>${esc(L.live)}</span>
      </div>
      <div class="cam-body">
        <div class="stage" data-stage>
          <div class="media" data-media></div>
          <div class="tools">
            <button class="icon" data-act="mute" aria-label="${esc(L.mute)}" hidden><ha-icon icon="mdi:volume-off"></ha-icon></button>
            <button class="icon" data-act="full" aria-label="${esc(L.fullscreen)}"><ha-icon icon="mdi:fullscreen"></ha-icon></button>
          </div>
        </div>
        <aside class="side">
          <div class="controls" data-controls>${cam.controls
            .map(
              (id) => `<button class="pill" data-act="ctl" data-entity="${esc(id)}">
                <ha-icon data-icon></ha-icon><span data-name></span><span class="st" data-st></span></button>`
            )
            .join("")}</div>
          <h3>${esc(L.events_24h)}</h3>
          <ol class="events" data-events></ol>
        </aside>
      </div>`;
    this._mountLive();
    this._renderEventParts();
  }

  /* ---------- snapshots ---------- */

  _snapUrl(cam) {
    const st = this._hass?.states[cam.entity];
    const pic = st?.attributes.entity_picture;
    if (!pic) return null;
    const sep = pic.includes("?") ? "&" : "?";
    return `${pic}${sep}width=${this._config.snapshot_width}&_t=${Date.now()}`;
  }

  _refreshSnaps(immediate = false) {
    if (!this._root || this._view.name !== "overview") return;
    for (const cam of this._cams) {
      const img = this._root.querySelector(`[data-snap="${cam.key}"]`);
      const url = this._snapUrl(cam);
      if (!img || !url) continue;
      if (immediate || !img.src) {
        img.src = url;
        continue;
      }
      // Preload in the background and swap only when ready, so the tile never flashes.
      const pre = new Image();
      pre.onload = () => {
        if (img.isConnected) img.src = url;
      };
      pre.src = url;
    }
  }

  /* ---------- state updates from hass ---------- */

  _update() {
    if (!this._root || !this._hass) return;
    const hass = this._hass;
    if (this._view.name === "overview") {
      for (const cam of this._cams) {
        const st = hass.states[cam.entity];
        const off = this._root.querySelector(`[data-off="${cam.key}"]`);
        if (off) off.hidden = !!st && st.state !== "unavailable";
      }
    } else {
      const L = this._L;
      if (this._liveEl) this._liveEl.hass = hass;
      this._root.querySelectorAll("[data-act='ctl']").forEach((btn) => {
        const st = hass.states[btn.dataset.entity];
        const on = ["on", "open", "unlocked", "playing"].includes(st?.state);
        btn.classList.toggle("on", on);
        btn.querySelector("[data-name]").textContent =
          st?.attributes.friendly_name ?? btn.dataset.entity;
        btn.querySelector("[data-st]").textContent = !st
          ? L.missing
          : st.state === "on"
            ? L.on
            : st.state === "off"
              ? L.off
              : ["button", "input_button", "script", "scene"].includes(st.entity_id.split(".")[0])
                ? ""
                : hass.formatEntityState
                  ? hass.formatEntityState(st)
                  : st.state;
        const icon = btn.querySelector("[data-icon]");
        icon.setAttribute("icon", st?.attributes.icon || this._defaultIcon(btn.dataset.entity, on));
      });
    }
  }

  _defaultIcon(entityId, on) {
    const d = entityId.split(".")[0];
    return (
      {
        light: on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline",
        switch: on ? "mdi:toggle-switch" : "mdi:toggle-switch-off-outline",
        lock: on ? "mdi:lock-open-variant" : "mdi:lock",
        cover: "mdi:garage",
        button: "mdi:gesture-tap-button",
        input_button: "mdi:gesture-tap-button",
        script: "mdi:play",
        scene: "mdi:palette",
        siren: "mdi:alarm-light",
      }[d] || "mdi:circle-medium"
    );
  }

  /* ---------- live and recordings ---------- */

  /** Collects <video> elements through nested shadow roots. */
  _findVideos(node, depth = 0, out = []) {
    if (!node || depth > 30) return out;
    if (node.shadowRoot) this._findVideos(node.shadowRoot, depth + 1, out);
    const all = node.querySelectorAll ? node.querySelectorAll("*") : [];
    for (const k of all) {
      if (k.tagName === "VIDEO") out.push(k);
      if (k.shadowRoot) this._findVideos(k.shadowRoot, depth + 1, out);
    }
    return out;
  }

  /** Keeps the snapshot over the live view until the video is actually playing. */
  _watchFirstFrame(el, poster, started) {
    clearInterval(this._posterTimer);
    const done = (how) => {
      clearInterval(this._posterTimer);
      if (poster.isConnected) poster.classList.add("gone");
      console.info(
        `[protect-camera-card] live: ${how} after ${Math.round(performance.now() - started)} ms`
      );
    };
    const deadline = started + 20000;
    this._posterTimer = setInterval(() => {
      if (!el.isConnected) return clearInterval(this._posterTimer);
      const v = this._findVideos(el).find((x) => x.readyState >= 2 && !x.paused);
      if (v) {
        const host = v.getRootNode()?.host?.tagName?.toLowerCase() ?? "unknown";
        const player = host.includes("web-rtc") ? "WebRTC" : host.includes("hls") ? "HLS" : host;
        return done(`first frame via ${player} (${v.videoWidth}x${v.videoHeight})`);
      }
      if (performance.now() > deadline) done("timeout, showing the stream anyway");
    }, 150);
  }

  /**
   * Direct WebRTC session against HA's go2rtc over the websocket (camera/webrtc/offer).
   * Resolves true when video plays, false on error or timeout.
   */
  _startWebRtc(cam, media, poster, started, token, useHaIce, timeoutSec) {
    return new Promise(async (resolve) => {
      let settled = false;
      let myPc = null;
      let myVideo = null;
      let statsTimer = null;
      let firstBytesAt = null;
      const finish = (ok, why) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(statsTimer);
        if (!ok) {
          if (why) console.info(`[protect-camera-card] WebRTC gave no picture (${why})`);
          // Only clean up after this attempt, not a newer one that may have taken over.
          if (myPc && this._pc === myPc) this._stopWebRtc();
          else {
            myPc?.close();
            myVideo?.remove();
          }
        }
        resolve(ok);
      };
      // Without data within webrtc_timeout we give up. If data arrives but no picture yet,
      // wait for a keyframe for up to 20 s before falling back.
      const timer = setTimeout(
        function check() {
          if (settled) return;
          if (firstBytesAt === null) return finish(false, "no data received");
          if (performance.now() - started > 20000) return finish(false, "data, but no picture");
          setTimeout(check, 1000);
        },
        timeoutSec * 1000
      );
      try {
        const hass = this._hass;
        const entity_id = cam.live_entity;
        let rtcConfig = {};
        if (useHaIce) {
          try {
            const cc = await hass.callWS({ type: "camera/webrtc/get_client_config", entity_id });
            rtcConfig = cc?.configuration || {};
          } catch (_) {
            /* use defaults */
          }
        }
        console.info(
          `[protect-camera-card] WebRTC: ${rtcConfig.iceServers?.length ? "with HA ICE servers" : "without ICE servers"}`
        );
        if (token !== this._liveToken) return finish(false);

        const pc = new RTCPeerConnection(rtcConfig);
        myPc = pc;
        this._pc = pc;
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
        pc.createDataChannel("dc");

        const stream = new MediaStream();
        const video = document.createElement("video");
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.srcObject = stream;
        myVideo = video;
        media.innerHTML = "";
        media.appendChild(video);
        this._rtcVideo = video;

        pc.ontrack = (e) => {
          stream.addTrack(e.track);
          // Reassign the source and start explicitly: autoplay alone does not start
          // reliably when tracks are added after srcObject is set.
          video.srcObject = stream;
          video.play().catch(() => {});
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") finish(false, "connection failed");
        };
        pc.oniceconnectionstatechange = async () => {
          let pair = "";
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            try {
              const stats = await pc.getStats();
              let sel = null;
              stats.forEach((s) => {
                if (s.type === "transport" && s.selectedCandidatePairId) sel = stats.get(s.selectedCandidatePairId);
              });
              if (sel) {
                const l = stats.get(sel.localCandidateId);
                const r = stats.get(sel.remoteCandidateId);
                pair = ` via ${l?.candidateType}/${l?.protocol} → ${r?.candidateType} ${r?.address ?? ""}:${r?.port ?? ""}`;
              }
            } catch (_) {
              /* no details */
            }
          }
          console.info(
            `[protect-camera-card] ICE: ${pc.iceConnectionState}${pair} (${Math.round(performance.now() - started)} ms)`
          );
        };
        const ms = () => Math.round(performance.now() - started);
        const success = (how) => {
          if (settled) return;
          if (poster?.isConnected) poster.classList.add("gone");
          video.play().catch(() => {});
          console.info(
            `[protect-camera-card] live: first frame via WebRTC (${how}, ${video.videoWidth || "?"}x${video.videoHeight || "?"}) after ${ms()} ms` +
              (firstBytesAt !== null ? `, first data after ${firstBytesAt} ms` : "")
          );
          finish(true);
        };
        video.addEventListener("playing", () => success("playing"), { once: true });
        // Measure in WebRTC stats: when does data arrive, and when is the first frame decoded?
        statsTimer = setInterval(async () => {
          if (settled || pc.connectionState === "closed") return;
          try {
            const stats = await pc.getStats();
            stats.forEach((s) => {
              if (s.type !== "inbound-rtp" || s.kind !== "video") return;
              if (firstBytesAt === null && s.bytesReceived > 0) firstBytesAt = ms();
              if (s.framesDecoded > 0) success("decoded");
            });
          } catch (_) {
            /* connection closed */
          }
        }, 150);

        let session = null;
        const pending = [];
        const send = (c) =>
          hass
            .callWS({ type: "camera/webrtc/candidate", entity_id, session_id: session, candidate: c })
            .catch(() => {});
        pc.onicecandidate = (e) => {
          if (!e.candidate) return;
          const c = e.candidate.toJSON();
          if (session) send(c);
          else pending.push(c);
        };

        await pc.setLocalDescription(await pc.createOffer());
        const unsub = await hass.connection.subscribeMessage(
          async (msg) => {
            if (msg.type === "session") {
              session = msg.session_id;
              pending.splice(0).forEach(send);
            } else if (msg.type === "answer") {
              await pc
                .setRemoteDescription({ type: "answer", sdp: msg.answer })
                .catch(() => finish(false, "invalid answer"));
            } else if (msg.type === "candidate") {
              pc.addIceCandidate(msg.candidate).catch(() => {});
            } else if (msg.type === "error") {
              console.warn("[protect-camera-card] WebRTC error from HA:", msg);
              finish(false, msg.message || msg.code);
            }
          },
          { type: "camera/webrtc/offer", entity_id, offer: pc.localDescription.sdp }
        );
        // If the session was stopped while subscribing, clean up immediately.
        if (this._pc !== pc) {
          unsub();
          return;
        }
        this._rtcUnsub = unsub;
      } catch (err) {
        finish(false, err?.message || String(err));
      }
    });
  }

  _stopWebRtc() {
    try {
      this._rtcUnsub?.();
    } catch (_) {
      /* already ended */
    }
    this._rtcUnsub = null;
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    if (this._rtcVideo) {
      this._rtcVideo.srcObject = null;
      this._rtcVideo.remove();
      this._rtcVideo = null;
    }
    const mute = this._root?.querySelector("[data-act='mute']");
    if (mute) mute.hidden = true;
  }

  async _mountLive() {
    const cam = this._cam(this._view.key);
    const media = this._root.querySelector("[data-media]");
    if (!media) return;
    const token = (this._liveToken = (this._liveToken || 0) + 1);
    const started = performance.now();
    media.innerHTML = "";
    const pic = this._hass.states[cam.live_entity]?.attributes.entity_picture
      || this._hass.states[cam.entity]?.attributes.entity_picture;
    const stage = this._root.querySelector("[data-stage]");
    stage.querySelector(".poster")?.remove();
    let poster = null;
    if (pic) {
      poster = document.createElement("img");
      poster.className = "poster";
      poster.alt = "";
      poster.src = `${pic}${pic.includes("?") ? "&" : "?"}width=1280&_t=${Date.now()}`;
      stage.appendChild(poster);
    }

    if (this._config.live_mode !== "hls" && window.RTCPeerConnection) {
      // webrtc_ice: auto (no servers first, then HA's) | none | ha
      const mode = this._config.webrtc_ice || "auto";
      const timeout = Number(this._config.webrtc_timeout) || 8;
      const attempts =
        mode === "none"
          ? [[false, timeout]]
          : mode === "ha"
            ? [[true, timeout]]
            : [
                [false, 3],
                [true, timeout],
              ];
      let ok = false;
      for (const [useHaIce, secs] of attempts) {
        ok = await this._startWebRtc(cam, media, poster, started, token, useHaIce, secs);
        if (token !== this._liveToken || this._view.clip) return;
        if (ok) break;
      }
      if (ok) {
        const mute = this._root.querySelector("[data-act='mute']");
        if (mute) {
          mute.hidden = false;
          mute.querySelector("ha-icon").setAttribute("icon", "mdi:volume-off");
        }
        return;
      }
      console.info("[protect-camera-card] falling back to HA's standard player");
    }

    try {
      const helpers = await window.loadCardHelpers();
      const el = helpers.createCardElement({
        type: "picture-entity",
        entity: cam.live_entity,
        camera_view: "live",
        show_name: false,
        show_state: false,
        tap_action: { action: "none" },
        hold_action: { action: "none" },
      });
      el.hass = this._hass;
      // The user may have navigated away while the card was created.
      if (!media.isConnected || this._view.clip || token !== this._liveToken) return;
      media.appendChild(el);
      this._liveEl = el;
      if (poster) this._watchFirstFrame(el, poster, started);
    } catch (err) {
      media.innerHTML = `<div class="msg">${esc(this._L.live_failed)} ${esc(err.message)}</div>`;
    }
  }

  _teardownStage() {
    this._liveToken = (this._liveToken || 0) + 1;
    this._stopWebRtc();
    clearInterval(this._posterTimer);
    this._root?.querySelector(".poster")?.remove();
    this._liveEl?.remove();
    this._liveEl = null;
    const v = this._root?.querySelector("video");
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
  }

  async _playClip(key, eventId) {
    const ev = this._events.get(key)?.items.find((e) => e.id === eventId);
    if (!ev) return;
    this._teardownStage();
    this._view.clip = ev.id;
    const L = this._L;
    const media = this._root.querySelector("[data-media]");
    const stage = this._root.querySelector("[data-stage]");
    const mode = this._root.querySelector("[data-mode]");
    media.innerHTML = `<div class="msg">${esc(L.loading_clip)}</div>`;
    mode.classList.remove("live");
    mode.textContent = `${L.recording} ${this._time(ev)}`;
    stage.querySelector(".golive")?.remove();
    stage.insertAdjacentHTML("beforeend", `<button class="golive" data-act="live">${esc(L.back_live)}</button>`);
    this._markSelected();
    try {
      const res = await this._hass.callWS({
        type: "media_source/resolve_media",
        media_content_id: ev.mid,
      });
      let url = res.url;
      if (url.startsWith("/") && !url.includes("authSig")) url = await this._sign(url);
      if (this._view.clip !== ev.id) return;
      media.innerHTML = `<video controls autoplay playsinline></video>`;
      media.querySelector("video").src = this._hass.hassUrl ? this._hass.hassUrl(url) : url;
    } catch (err) {
      media.innerHTML = `<div class="msg">${esc(L.clip_failed)} ${esc(err.message)}</div>`;
    }
  }

  _backToLive() {
    this._teardownStage();
    this._view.clip = null;
    this._root.querySelector(".golive")?.remove();
    const mode = this._root.querySelector("[data-mode]");
    mode.classList.add("live");
    mode.textContent = this._L.live;
    this._markSelected();
    this._mountLive();
  }

  _markSelected() {
    this._root.querySelectorAll(".ev").forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.id === this._view.clip));
    });
  }

  /* ---------- events from UniFi Protect ---------- */

  async _browse(id) {
    return this._hass.callWS({ type: "media_source/browse_media", media_content_id: id });
  }

  async _discover() {
    const root = await this._browse("media-source://unifiprotect");
    let consoles = /:browse$/.test(root.media_content_id || "") ? [root] : root.children || [];
    if (this._config.nvr_id) {
      consoles = consoles.filter((c) => (c.media_content_id || "").includes(this._config.nvr_id));
    }
    let con = consoles[0];
    if (!con) throw new Error(this._L.no_console);
    if (!con.children) con = await this._browse(con.media_content_id);
    const nvr = con.media_content_id.replace("media-source://unifiprotect/", "").split(":")[0];
    const protectCams = (con.children || [])
      .map((c) => ({ id: c.media_content_id.split(":").pop(), title: c.title }))
      .filter((c) => c.id !== "all");

    const ids = new Map();
    for (const cam of this._cams) {
      if (cam.protect_id) {
        ids.set(cam.key, cam.protect_id);
        continue;
      }
      if (cam.protect_name) {
        const hit = protectCams.find((p) => norm(p.title) === norm(cam.protect_name));
        if (hit) ids.set(cam.key, hit.id);
        continue;
      }
      // Automatic: the Protect name is usually the start of the entity name or ID.
      const st = this._hass.states[cam.entity];
      const cands = [norm(st?.attributes.friendly_name), norm(cam.entity.split(".")[1])];
      let best = null;
      for (const p of protectCams) {
        const n = norm(p.title);
        if (n && cands.some((c) => c.startsWith(n)) && (!best || n.length > norm(best.title).length)) {
          best = p;
        }
      }
      if (best) ids.set(cam.key, best.id);
    }
    const missing = this._cams.filter((c) => !ids.has(c.key));
    if (missing.length) {
      console.warn(
        "[protect-camera-card] No Protect camera found for:",
        missing.map((c) => c.entity),
        "Available names:",
        protectCams.map((p) => p.title)
      );
    }
    return {
      nvr,
      ids,
      keyById: new Map([...ids].map(([key, id]) => [id, key])),
      titleById: new Map(protectCams.map((p) => [p.id, p.title])),
      titles: protectCams.map((p) => p.title),
    };
  }

  async _loadEvents() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      if (!this._protect) {
        try {
          this._protect = await this._discover();
          this._protectError = null;
        } catch (err) {
          this._protectError = err.message || String(err);
          this._renderEventParts();
          return;
        }
      }
      const keys =
        this._view.name === "camera" ? [this._view.key] : this._cams.map((c) => c.key);
      const type = this._config.event_type;
      const L = this._L;
      const nvr = this._protect.nvr;
      const hidden = (ev) => (this._config.exclude || []).includes(ev.kind);
      let returned = 0;
      let recognized = 0;
      // The strip reads "All cameras", in the same order as the Media panel, so it also
      // covers cameras that are not in the card.
      const recent =
        this._view.name !== "overview"
          ? null
          : this._browse(`media-source://unifiprotect/${nvr}:browse:all:${type}:recent:1`).then(
              (res) => ({ items: (res.children || []).map((it) => parseEvent(it, L)).filter((ev) => !hidden(ev)), error: null }),
              (err) => ({ items: [], error: err.message || String(err) })
            );
      if (this._eventCam.size > 5000) this._eventCam.clear();
      await Promise.all(
        keys.map(async (key) => {
          const camId = this._protect.ids.get(key);
          if (!camId) return;
          try {
            const res = await this._browse(
              `media-source://unifiprotect/${nvr}:browse:${camId}:${type}:recent:1`
            );
            const parsed = (res.children || []).map((it) => parseEvent(it, L));
            parsed.forEach((ev) => this._eventCam.set(ev.id, camId));
            returned += parsed.length;
            recognized += parsed.filter((ev) => ev.recognized).length;
            this._events.set(key, {
              items: parsed.filter((ev) => !hidden(ev)),
              truncated: /TRUNCATED/.test(res.title || ""),
              error: null,
            });
          } catch (err) {
            this._events.set(key, { items: [], truncated: false, error: err.message || String(err) });
          }
        })
      );
      if (recent) this._recent = await recent;
      this._parseWarning = returned > 0 && recognized === 0;
      if (this._parseWarning && !this._parseWarned) {
        this._parseWarned = true;
        console.warn(`[protect-camera-card] ${I18N.en.parse_none}`);
      }
      this._renderEventParts();
    } finally {
      this._loading = false;
    }
  }

  /** Finds the camera of strip events that no per-camera list contained (cameras not in the card). */
  async _attribute(evs) {
    const todo = evs.filter((ev) => !this._eventCam.has(ev.id) && !this._resolving.has(ev.id));
    if (!todo.length) return;
    todo.forEach((ev) => this._resolving.add(ev.id));
    await Promise.all(
      todo.map(async (ev) => {
        try {
          const res = await this._hass.callWS({ type: "media_source/resolve_media", media_content_id: ev.mid });
          this._eventCam.set(ev.id, cameraFromVideoUrl(res.url));
        } catch (_) {
          this._eventCam.set(ev.id, null);
        } finally {
          this._resolving.delete(ev.id);
        }
      })
    );
    if (this._view.name === "overview") this._renderOverviewEvents();
  }

  async _sign(path) {
    const hit = this._signed.get(path);
    if (hit && Date.now() - hit.at < 50 * 60 * 1000) return hit.url;
    const res = await this._hass.callWS({ type: "auth/sign_path", path, expires: 3600 });
    this._signed.set(path, { url: res.path, at: Date.now() });
    return res.path;
  }

  _hydrateThumbs(scope) {
    scope.querySelectorAll("img[data-thumb]").forEach(async (img) => {
      const path = img.dataset.thumb;
      delete img.dataset.thumb;
      try {
        img.src = await this._sign(path);
      } catch (_) {
        /* thumbnail stays empty */
      }
    });
  }

  _renderEventParts() {
    if (!this._root) return;
    if (this._view.name === "overview") this._renderOverviewEvents();
    else this._renderCameraEvents();
  }

  _renderOverviewEvents() {
    const L = this._L;
    const all = [];
    let total = 0;
    const kinds = {};
    for (const cam of this._cams) {
      const data = this._events.get(cam.key);
      const badge = this._root.querySelector(`[data-badge="${cam.key}"]`);
      const last = this._root.querySelector(`[data-last="${cam.key}"]`);
      if (!data) continue;
      const n = data.items.length;
      total += n;
      if (badge) badge.textContent = n ? `${n}${data.truncated ? "+" : ""}` : "";
      if (badge) badge.title = L.n_events(n);
      const first = data.items[0];
      if (last) {
        last.innerHTML = first
          ? `${kindIcon(first.kind)}${esc(first.label)} ${esc(L.at)} ${esc(this._time(first))}`
          : esc(L.no_events);
      }
      data.items.forEach((ev) => {
        kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
        all.push({ ev, cam });
      });
    }

    const meta = this._root.querySelector("[data-meta]");
    if (meta) meta.textContent = this._events.size ? L.n_events(total) : "";

    const summary = this._root.querySelector("[data-summary]");
    if (summary) {
      const rows = Object.entries(kinds)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `<li>${kindIcon(k)}${esc(L.kinds[k])} ${n}</li>`)
        .join("");
      summary.innerHTML = `<div class="big">${total}</div><div class="sub">${esc(L.events_sub)}</div><ul>${rows}</ul>`;
    }

    const strip = this._root.querySelector("[data-strip]");
    if (!strip) return;
    if (this._protectError) {
      strip.innerHTML = `<div class="note">${esc(L.protect_error)} ${esc(this._protectError)}</div>`;
      return;
    }
    const unmatched = this._protect ? this._cams.filter((c) => !this._protect.ids.has(c.key)) : [];
    let items;
    if (this._recent && !this._recent.error) {
      // "All cameras", newest first as delivered. Events from cameras in the card open
      // that camera; events from other cameras show the Protect name and are not clickable.
      items = this._recent.items.slice(0, this._config.strip_limit).map((ev) => {
        const pid = this._eventCam.get(ev.id);
        const key = pid ? this._protect?.keyById.get(pid) : null;
        const cam = key ? this._cam(key) : null;
        const name = cam ? this._camName(cam) : (pid && this._protect?.titleById.get(pid)) || "";
        return { ev, cam: cam && this._events.get(cam.key)?.items.some((e) => e.id === ev.id) ? cam : null, name };
      });
      this._attribute(items.filter((x) => !this._eventCam.has(x.ev.id)).map((x) => x.ev));
    } else {
      // Fallback when "All cameras" failed: merge the per-camera lists.
      all.sort((a, b) => (b.ev.ts ?? 0) - (a.ev.ts ?? 0));
      items = all.slice(0, this._config.strip_limit).map(({ ev, cam }) => ({ ev, cam, name: this._camName(cam) }));
    }
    let html = items
      .map(({ ev, cam, name }) => {
        const body = `
          <img class="thumb" alt="" ${ev.thumb ? `data-thumb="${esc(ev.thumb)}"` : ""}>
          <div class="l1">${kindIcon(ev.kind)}${esc(ev.label)}</div>
          <div class="l2">${name ? `${esc(name)} ${esc(L.at)} ` : ""}${esc(this._time(ev))}</div>`;
        return cam
          ? `<button class="sitem" data-act="openplay" data-key="${cam.key}" data-id="${esc(ev.id)}">${body}</button>`
          : `<div class="sitem static">${body}</div>`;
      })
      .join("");
    if (!items.length && (this._events.size || this._recent)) html = `<div class="note">${esc(L.no_events)}</div>`;
    if (this._parseWarning) html += `<div class="note">${esc(L.parse_none)}</div>`;
    if (unmatched.length) {
      html += `<div class="note">${L.unmatched(
        esc(unmatched.map((c) => this._camName(c)).join(", ")),
        esc(this._protect.titles.join(", "))
      )}</div>`;
    }
    strip.innerHTML = html;
    this._hydrateThumbs(strip);
  }

  _renderCameraEvents() {
    const L = this._L;
    const list = this._root.querySelector("[data-events]");
    if (!list) return;
    const key = this._view.key;
    if (this._protectError) {
      list.innerHTML = `<li class="note">${esc(this._protectError)}</li>`;
      return;
    }
    if (this._protect && !this._protect.ids.has(key)) {
      list.innerHTML = `<li class="note">${L.not_linked}</li>`;
      return;
    }
    const data = this._events.get(key);
    if (!data) {
      list.innerHTML = `<li class="note">${esc(L.loading_events)}</li>`;
      return;
    }
    if (data.error) {
      list.innerHTML = `<li class="note">${esc(data.error)}</li>`;
      return;
    }
    if (!data.items.length) {
      list.innerHTML = `<li class="note">${esc(this._parseWarning ? L.parse_none : L.no_events)}</li>`;
      return;
    }
    list.innerHTML = data.items
      .slice(0, this._config.list_limit)
      .map(
        (ev) => `<li>
          <button class="ev" data-act="play" data-key="${key}" data-id="${esc(ev.id)}">
            <img class="thumb" alt="" ${ev.thumb ? `data-thumb="${esc(ev.thumb)}"` : ""}>
            <span>
              <span class="t">${esc(this._time(ev))}</span>
              <span class="l">${kindIcon(ev.kind)}${esc(ev.label)}</span>
              ${ev.duration ? `<span class="d">${esc(ev.duration)}</span>` : ""}
            </span>
          </button></li>`
      )
      .join("");
    this._markSelected();
    this._hydrateThumbs(list);
  }

  /* ---------- clicks ---------- */

  _onClick(e) {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const { act, key, id, entity } = t.dataset;
    switch (act) {
      case "open":
        this._go({ name: "camera", key, clip: null });
        this._loadEvents();
        break;
      case "openplay":
        this._go({ name: "camera", key, clip: null });
        this._playClip(key, id);
        break;
      case "back":
        this._go({ name: "overview" });
        this._loadEvents();
        break;
      case "refresh":
        this._refreshSnaps(true);
        this._loadEvents();
        break;
      case "play":
        this._playClip(key, id);
        break;
      case "live":
        this._backToLive();
        break;
      case "mute":
        if (this._rtcVideo) {
          this._rtcVideo.muted = !this._rtcVideo.muted;
          t.querySelector("ha-icon").setAttribute(
            "icon",
            this._rtcVideo.muted ? "mdi:volume-off" : "mdi:volume-high"
          );
        }
        break;
      case "full": {
        const stage = this._root.querySelector("[data-stage]");
        if (document.fullscreenElement) document.exitFullscreen();
        else if (stage?.requestFullscreen) stage.requestFullscreen();
        else {
          // iOS Safari only supports fullscreen on <video>.
          const v = this._rtcVideo || stage?.querySelector("video") || this._findVideos(stage)[0];
          v?.webkitEnterFullscreen?.();
        }
        break;
      }
      case "ctl":
        this._control(entity);
        break;
    }
  }

  _control(entityId) {
    const d = entityId.split(".")[0];
    const call = (domain, service) =>
      this._hass.callService(domain, service, { entity_id: entityId });
    if (["light", "switch", "input_boolean", "fan", "siren"].includes(d)) call("homeassistant", "toggle");
    else if (d === "button" || d === "input_button") call(d, "press");
    else if (d === "script" || d === "scene") call(d, "turn_on");
    else
      this.dispatchEvent(
        new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
      );
  }
}

if (!customElements.get("protect-camera-card")) {
  customElements.define("protect-camera-card", ProtectCameraCard);
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: "protect-camera-card",
  name: "Protect Camera Card",
  description: "Snapshot overview, live view and UniFi Protect events per camera.",
  documentationURL: "https://github.com/trikkssitt/protect-camera-card",
});
console.info(`%cprotect-camera-card ${CARD_VERSION}`, "color:#5b8def;font-weight:600");