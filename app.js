'use strict';
/* WatchSync - tiny Web Bluetooth companion.
 * Standard GATT features work out of the box. Watch-specific protocols live in
 * profiles/*.json (see profiles/README.md), so supporting a new watch means adding a file. */

const $ = (s) => document.querySelector(s);
const BASE = (n) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const BASE_RE = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/;

const NAMES = {
  0x1800: 'Generic Access', 0x1801: 'Generic Attribute', 0x180a: 'Device Information',
  0x180d: 'Heart Rate', 0x180f: 'Battery', 0x1805: 'Current Time', 0x1809: 'Health Thermometer',
  0x1822: 'Pulse Oximeter', 0x2a19: 'Battery Level', 0x2a37: 'Heart Rate Measurement',
  0x2a2b: 'Current Time', 0x2a29: 'Manufacturer', 0x2a24: 'Model', 0x2a26: 'Firmware rev',
  0x2a27: 'Hardware rev', 0x2a28: 'Software rev', 0x2a00: 'Device Name',
};

// Standard services plus common vendor UUIDs used by budget wearables.
const STANDARD_SERVICES = [0x1800, 0x1801, 0x180a, 0x180d, 0x180f, 0x1805, 0x1809, 0x1822].map(BASE);
const VENDOR_SERVICES = [
  BASE(0xfee7), BASE(0xfff0), BASE(0xffe0), BASE(0xfd00),
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
];

let dev = null, server = null, manualDisconnect = false, hrChar = null, pollTimer = null;
let profiles = [], active = null;
const chars = new Map();   // "svc/char" -> BluetoothRemoteGATTCharacteristic
const logLines = [];

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => b.toString(16).padStart(2, '0');
const toHex = (dv) => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)].map(hex2).join(' ');
function fromHex(s) {
  const h = s.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (!h.length || h.length % 2) throw new Error('Need an even number of hex digits');
  return Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
}
function niceName(uuid) {
  const m = BASE_RE.exec(uuid);
  return m ? (NAMES[parseInt(m[1], 16)] || '0x' + m[1]) : 'Custom';
}
function normUuid(s) {
  s = String(s).trim().toLowerCase();
  if (/^(0x)?[0-9a-f]{4}$/.test(s)) return BASE(parseInt(s.replace('0x', ''), 16));
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;
  throw new Error('Not a valid UUID: ' + s);
}
const asUuid = (x) => (typeof x === 'number' ? BASE(x) : normUuid(x));
function getCustom() {
  try { return JSON.parse(localStorage.getItem('customUuids') || '[]'); } catch { return []; }
}
function saveCustom(list) {
  try { localStorage.setItem('customUuids', JSON.stringify(list)); } catch { /* ignore */ }
}
function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  logLines.push(line);
  const el = $('#log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function setStatus(state, text) {
  $('#dot').className = 'dot' + (state === 'on' ? ' on' : state === 'busy' ? ' busy' : '');
  $('#status').textContent = text;
  const on = state === 'on';
  ['#btnTime', '#btnBatt', '#btnHR', '#btnWrite'].forEach((id) => { $(id).disabled = !on; });
  $('#btnDisconnect').disabled = !(on || state === 'busy');
  $('#btnConnect').disabled = state === 'busy';
}
// find(0x180f, 0x2a19) or find('fee7', 'fec7') or find(fullUuid, fullUuid)
function find(svc, ch) {
  try { return chars.get(`${asUuid(svc)}/${asUuid(ch)}`) || null; } catch { return null; }
}

/* ---------- profiles ---------- */
async function loadProfiles() {
  try {
    const idx = await (await fetch('profiles/index.json', { cache: 'no-cache' })).json();
    const out = [];
    for (const f of idx) {
      try {
        const p = await (await fetch('profiles/' + f, { cache: 'no-cache' })).json();
        p.services = (p.services || []).map(normUuid);
        out.push(p);
      } catch (e) { log(`Profile ${f} skipped: ${e.message}`); }
    }
    profiles = out;
    log(`Loaded ${out.length} watch profile(s).`);
  } catch (e) { log('No profiles loaded: ' + e.message); }
}
const profilesReady = loadProfiles();

const serviceList = () => [...new Set([
  ...STANDARD_SERVICES, ...VENDOR_SERVICES, ...getCustom(), ...profiles.flatMap((p) => p.services),
])];

function matchProfile() {
  const name = (dev && dev.name) || '';
  const have = new Set([...chars.keys()].map((k) => k.split('/')[0]));
  return profiles.find((p) => (p.namePrefixes || []).some((x) => name.startsWith(x)))
    || profiles.find((p) => p.services.length && p.services.every((s) => have.has(s)))
    || null;
}
function showProfile() {
  $('#profile').textContent = active
    ? `Profile: ${active.name}${active.verified ? '' : ' (unverified)'}`
    : 'No profile for this watch: explorer mode (standard features only)';
}

/* Build a command packet from a profile template, e.g.
 * "01 {year2:bcd} {month:bcd} {day:bcd} {hour:bcd} {minute:bcd} {second:bcd}" + checksum "sum8".
 * Tokens: year, year2, month, day, hour, minute, second, weekday (1=Mon..7=Sun), weekday0 (0=Sun).
 * Formats: u8 (default), bcd, le16, be16. Literal bytes are hex pairs. */
function buildPacket(spec, d = new Date()) {
  const T = {
    year: d.getFullYear(), year2: d.getFullYear() % 100, month: d.getMonth() + 1, day: d.getDate(),
    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
    weekday: d.getDay() || 7, weekday0: d.getDay(),
  };
  const out = [];
  for (const part of String(spec.template).trim().split(/\s+/)) {
    const m = /^\{(\w+)(?::(\w+))?\}$/.exec(part);
    if (m) {
      if (!(m[1] in T)) throw new Error('Unknown token ' + m[1]);
      const v = T[m[1]], f = m[2] || 'u8';
      if (f === 'u8') out.push(v & 255);
      else if (f === 'bcd') out.push(((Math.floor(v / 10) % 10) << 4) | (v % 10));
      else if (f === 'le16') out.push(v & 255, (v >> 8) & 255);
      else if (f === 'be16') out.push((v >> 8) & 255, v & 255);
      else throw new Error('Unknown format ' + f);
    } else if (/^[0-9a-f]{2}$/i.test(part)) {
      out.push(parseInt(part, 16));
    } else throw new Error('Bad template part: ' + part);
  }
  if (spec.checksum === 'sum8') out.push(out.reduce((a, b) => a + b, 0) & 255);
  else if (spec.checksum === 'xor8') out.push(out.reduce((a, b) => a ^ b, 0));
  else if (spec.checksum) throw new Error('Unknown checksum ' + spec.checksum);
  return Uint8Array.from(out);
}

/* ---------- connection ---------- */
async function connect() {
  if (!navigator.bluetooth) { $('#unsupported').hidden = false; return; }
  await profilesReady;
  try {
    dev = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: serviceList(),
    });
  } catch (e) { log('Device chooser: ' + e.message); return; }
  manualDisconnect = false;
  dev.addEventListener('gattserverdisconnected', onDisconnected);
  await open();
}

async function open(attempt = 1) {
  try {
    setStatus('busy', `Connecting to ${dev.name || 'device'}…`);
    server = await dev.gatt.connect();
    await explore();
    active = matchProfile();
    showProfile();
    setStatus('on', `Connected: ${dev.name || dev.id}`);
    log('Connected.' + (active ? ` Using profile "${active.name}".` : ''));
    await readInfo();
    await readBattery().catch((e) => log('Battery: ' + e.message));
    clearInterval(pollTimer);
    pollTimer = setInterval(() => readBattery().catch(() => {}), 60000);
    if (!active && !find(0x1805, 0x2a2b)) log('Note: no standard Current Time characteristic and no profile; use "Save profile draft" to capture this watch.');
  } catch (e) {
    log(`Connect attempt ${attempt} failed: ${e.message}`);
    if (attempt < 3 && !manualDisconnect) { await sleep(1500 * attempt); return open(attempt + 1); }
    setStatus('off', 'Not connected');
  }
}

function onDisconnected() {
  clearInterval(pollTimer);
  hrChar = null;
  $('#btnHR').textContent = 'Start heart rate';
  setStatus('off', 'Disconnected');
  log('Disconnected.');
  if ($('#auto').checked && !manualDisconnect && dev) {
    setTimeout(() => { if (!manualDisconnect) open(); }, 2000);
  }
}

function disconnect() {
  manualDisconnect = true;
  if (dev && dev.gatt.connected) dev.gatt.disconnect();
  else setStatus('off', 'Not connected');
}

/* ---------- explorer ---------- */
async function explore() {
  chars.clear();
  const tree = $('#tree');
  tree.textContent = '';
  const writable = [];
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    const d = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = `${niceName(svc.uuid)} `;
    const sc = document.createElement('span'); sc.className = 'mute'; sc.textContent = svc.uuid;
    s.append(sc); d.append(s);
    let list = [];
    try { list = await svc.getCharacteristics(); } catch (e) { log(`${svc.uuid}: ${e.message}`); }
    for (const ch of list) {
      chars.set(`${svc.uuid}/${ch.uuid}`, ch);
      const p = ch.properties;
      const row = document.createElement('div'); row.className = 'ch';
      const nm = document.createElement('strong'); nm.textContent = niceName(ch.uuid);
      row.append(nm);
      ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((k) => p[k]).forEach((k) => {
        const t = document.createElement('span'); t.className = 'tag'; t.textContent = k; row.append(t);
      });
      if (p.read) row.append(btn('Read', async () => { const v = await ch.readValue(); log(`READ ${ch.uuid}: ${toHex(v)}`); }));
      if (p.notify || p.indicate) row.append(btn('Listen', async () => {
        ch.addEventListener('characteristicvaluechanged', (e) => log(`NOTIFY ${ch.uuid}: ${toHex(e.target.value)}`));
        await ch.startNotifications(); log(`Listening on ${ch.uuid}`);
      }));
      const code = document.createElement('code'); code.textContent = ch.uuid; row.append(code);
      d.append(row);
      if (p.write || p.writeWithoutResponse) writable.push([`${svc.uuid}/${ch.uuid}`, `${niceName(ch.uuid)}  ${ch.uuid}`]);
    }
    tree.append(d);
  }
  if (!services.length) tree.textContent = 'No accessible services. Add the right service UUIDs below and reconnect.';
  const sel = $('#wrChar');
  sel.textContent = '';
  if (!writable.length) sel.append(new Option('No writable characteristics', ''));
  writable.forEach(([k, label]) => sel.append(new Option(label, k)));
  log(`Found ${services.length} service(s), ${chars.size} characteristic(s).`);
}

function btn(label, fn) {
  const b = document.createElement('button');
  b.className = 'sec'; b.textContent = label;
  b.onclick = async () => { try { await fn(); } catch (e) { log(`${label} failed: ${e.message}`); } };
  return b;
}

// Skeleton of a profile for this watch, ready to fill in and contribute.
function saveDraft() {
  if (!dev || !chars.size) { log('Connect to a watch first.'); return; }
  const svcs = new Map();
  for (const [k, ch] of chars) {
    const [s, c] = k.split('/');
    if (!svcs.has(s)) svcs.set(s, []);
    svcs.get(s).push({ characteristic: c, properties: Object.keys(ch.properties).filter((x) => ch.properties[x]) });
  }
  const custom = [...svcs.keys()].filter((s) => !BASE_RE.test(s));
  const prefix = (dev.name || 'watch').replace(/[_\- ]?[0-9a-f]{4}$/i, '');
  const draft = {
    id: prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: prefix,
    namePrefixes: [prefix],
    verified: false,
    services: custom,
    notes: 'Fill in battery and syncTime once the byte formats are known.',
    battery: null,
    syncTime: null,
    discovered: [...svcs].map(([service, list]) => ({ service, characteristics: list })),
  };
  download(draft.id + '.json', JSON.stringify(draft, null, 2), 'application/json');
  log('Saved profile draft: ' + draft.id + '.json');
}

/* ---------- features ---------- */
async function readInfo() {
  const parts = [];
  for (const [id, label] of [[0x2a29, 'Maker'], [0x2a24, 'Model'], [0x2a26, 'FW'], [0x2a27, 'HW']]) {
    const c = find(0x180a, id);
    if (!c || !c.properties.read) continue;
    try { parts.push(`${label}: ${new TextDecoder().decode(await c.readValue())}`); } catch { /* skip */ }
  }
  $('#info').textContent = parts.join('  |  ');
  if (parts.length) log(parts.join(' | '));
}

async function readBattery() {
  const spec = active && active.battery;
  const c = spec ? find(spec.service, spec.characteristic) : find(0x180f, 0x2a19);
  if (!c) { $('#batt').textContent = 'n/a'; return; }
  const v = (await c.readValue()).getUint8((spec && spec.offset) || 0);
  $('#batt').textContent = v + '%';
  log(`Battery ${v}%`);
}

async function toggleHR() {
  const c = find(0x180d, 0x2a37);
  if (!c) { log('No standard Heart Rate service on this watch.'); return; }
  if (hrChar) {
    await c.stopNotifications(); hrChar = null;
    $('#btnHR').textContent = 'Start heart rate'; return;
  }
  c.addEventListener('characteristicvaluechanged', (e) => {
    const dv = e.target.value;
    const bpm = (dv.getUint8(0) & 1) ? dv.getUint16(1, true) : dv.getUint8(1);
    $('#hr').textContent = bpm + ' bpm';
  });
  await c.startNotifications();
  hrChar = c;
  $('#btnHR').textContent = 'Stop heart rate';
}

async function syncTime() {
  const spec = active && active.syncTime;
  if (spec) {
    const c = find(spec.service, spec.characteristic);
    if (!c) throw new Error('Profile characteristic not found on this watch');
    const pkt = buildPacket(spec);
    const text = [...pkt].map(hex2).join(' ');
    if (!active.verified && !confirm(`Profile "${active.name}" is unverified.\nSend these bytes to the watch?\n${text}`)) return;
    await writeChar(c, pkt);
    log(`Time command sent: ${text}`);
    return stamp();
  }
  if (active) log(`Profile "${active.name}" has no syncTime command yet; trying the standard Current Time service.`);
  const c = find(0x1805, 0x2a2b);
  if (!c) { log('No time command available for this watch yet (see profiles/README.md).'); return; }
  const d = new Date(), b = new DataView(new ArrayBuffer(10));
  b.setUint16(0, d.getFullYear(), true);
  b.setUint8(2, d.getMonth() + 1); b.setUint8(3, d.getDate());
  b.setUint8(4, d.getHours()); b.setUint8(5, d.getMinutes()); b.setUint8(6, d.getSeconds());
  b.setUint8(7, d.getDay() || 7);                       // 1=Mon..7=Sun
  b.setUint8(8, Math.floor(d.getMilliseconds() / 1000 * 256));
  b.setUint8(9, 1);                                     // adjust reason: manual update
  await writeChar(c, b);
  log('Time written: ' + d.toString());
  stamp();
}
function stamp() { $('#lastSync').textContent = new Date().toLocaleTimeString(); }

async function writeChar(c, data) {
  if (c.properties.write && c.writeValueWithResponse) return c.writeValueWithResponse(data);
  if (c.properties.write) return c.writeValue(data);
  if (c.properties.writeWithoutResponse) return c.writeValueWithoutResponse(data);
  throw new Error('Characteristic is not writable');
}

async function rawWrite() {
  const key = $('#wrChar').value;
  const c = chars.get(key);
  if (!c) { log('Pick a writable characteristic first.'); return; }
  const bytes = fromHex($('#wrHex').value);
  await writeChar(c, bytes);
  log(`WRITE ${c.uuid}: ${[...bytes].map(hex2).join(' ')}`);
}

/* ---------- wiring ---------- */
const guard = (fn) => async () => { try { await fn(); } catch (e) { log(`Error: ${e.message}`); } };
$('#btnConnect').onclick = connect;
$('#btnDisconnect').onclick = disconnect;
$('#btnTime').onclick = guard(syncTime);
$('#btnBatt').onclick = guard(readBattery);
$('#btnHR').onclick = guard(toggleHR);
$('#btnWrite').onclick = guard(rawWrite);
$('#btnDraft').onclick = guard(saveDraft);
$('#btnClear').onclick = () => { logLines.length = 0; $('#log').textContent = ''; };
$('#btnExport').onclick = () => download('watchsync-log.txt', logLines.join('\n'));
$('#btnAddUuid').onclick = () => {
  try {
    const u = normUuid($('#customUuid').value);
    const list = getCustom(); if (!list.includes(u)) list.push(u);
    saveCustom(list); $('#customUuid').value = '';
    log(`Added ${u}. Press Connect again to use it.`);
  } catch (e) { log(e.message); }
};

showProfile();
if (!navigator.bluetooth) { $('#unsupported').hidden = false; $('#btnConnect').disabled = true; }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
