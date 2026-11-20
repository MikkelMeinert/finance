/* finance: where the app keeps things, and how they travel.
   - On this device: localStorage. State, the device's token and its key each have their own name, so the token
     and the key can never be part of state, an export or a report.
   - In the private data repository: only encrypted files. The app reads the bank feed's files and reads and
     writes its own state file (state.json.enc) through GitHub's API, with this device's token.
   The local write always happens first; sync carries it when it can. Being offline is never an error.
   The only address this file talks to is api.github.com (the page's content security policy enforces it). */
"use strict";
// >>> envelope: a verbatim copy of scripts/lib/envelope.js. `node scripts/feed-seal.js` refreshes it; a test compares. >>>
/* finance: encryption envelope (v1). One copy of the format for the app, the bank feed and the Mac scripts.
   Runs unchanged in Node 20+ and in the browser: WebCrypto only, no dependencies.

   Data file:    a fresh AES-256-GCM key per file, wrapped with the RSA-OAEP 3072 (SHA-256) public key.
                 { v:1, alg:"RSA-OAEP-256+A256GCM", wk, iv, ct }   (base64 fields)
   Private key:  PKCS8 bytes encrypted with AES-256-GCM under a key from PBKDF2-SHA256, 600.000 rounds.
                 { v:1, kdf:"PBKDF2-SHA256", iterations, salt, iv, ct, fingerprint }
   Whoever holds only the public key can write new files and read none of them. */
(function (root) {
  "use strict";
  const subtle = root.crypto.subtle;
  const ALG = "RSA-OAEP-256+A256GCM", KDF = "PBKDF2-SHA256", MIN_ITER = 600000;
  const AAD = new TextEncoder().encode("finance-envelope-v1"), AAD_KEY = new TextEncoder().encode("finance-private-key-v1");
  const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

  const toB64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (s) => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const rand = (n) => root.crypto.getRandomValues(new Uint8Array(n));

  /* Passphrases are shown as XXXXX-XXXXX-...; typing them with or without dashes, spaces or capitals must all work. */
  const normalisePassphrase = (p) => String(p).replace(/[\s-]/g, "").toUpperCase();
  const PASS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 symbols, none that look alike
  function generatePassphrase(groups = 6) {
    const out = [];
    while (out.length < groups * 5) { const b = rand(1)[0]; if (b < 248) out.push(PASS_ALPHABET[b % 31]); }   // 248 = 8 * 31: no modulo bias
    return out.join("").replace(/(.{5})(?=.)/g, "$1-");
  }

  async function generateKeyPair() {
    const kp = await subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    return { spki: new Uint8Array(await subtle.exportKey("spki", kp.publicKey)), pkcs8: new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey)) };
  }
  const importPublic = (spki) => subtle.importKey("spki", spki, RSA, false, ["encrypt"]);
  const importPrivate = (pkcs8) => subtle.importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
  async function fingerprint(spki) {
    const h = new Uint8Array(await subtle.digest("SHA-256", spki));
    return Array.from(h.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("").replace(/(.{4})(?=.)/g, "$1-");
  }
  /* The public key from a private key, so a device that holds the private key needs nothing else to write. */
  async function publicFromPrivate(pkcs8) {
    const jwk = await subtle.exportKey("jwk", await subtle.importKey("pkcs8", pkcs8, RSA, true, ["decrypt"]));
    const pub = await subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RSA-OAEP-256", ext: true }, RSA, true, ["encrypt"]);
    return new Uint8Array(await subtle.exportKey("spki", pub));
  }

  async function encrypt(spki, plaintext) {
    const raw = rand(32), iv = rand(12);
    const key = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plaintext);
    const wk = await subtle.encrypt({ name: "RSA-OAEP" }, await importPublic(spki), raw);
    raw.fill(0);
    return { v: 1, alg: ALG, wk: toB64(wk), iv: toB64(iv), ct: toB64(ct) };
  }
  async function decrypt(pkcs8, env) {
    if (!env || env.v !== 1 || env.alg !== ALG) throw new Error("not a finance envelope (v1)");
    const raw = await subtle.decrypt({ name: "RSA-OAEP" }, await importPrivate(pkcs8), fromB64(env.wk));
    const key = await subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv), additionalData: AAD }, key, fromB64(env.ct)));
  }
  const encryptJson = (spki, value) => encrypt(spki, new TextEncoder().encode(JSON.stringify(value)));
  const decryptJson = async (pkcs8, env) => JSON.parse(new TextDecoder().decode(await decrypt(pkcs8, env)));

  async function passKey(passphrase, salt, iterations, usage) {
    const base = await subtle.importKey("raw", new TextEncoder().encode(normalisePassphrase(passphrase)), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  async function wrapPrivateKey(pkcs8, passphrase, iterations = MIN_ITER) {
    if (iterations < MIN_ITER) throw new Error("PBKDF2 rounds below 600.000");
    const salt = rand(16), iv = rand(12);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD_KEY }, await passKey(passphrase, salt, iterations, "encrypt"), pkcs8);
    return { v: 1, kdf: KDF, iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), fingerprint: await fingerprint(await publicFromPrivate(pkcs8)) };
  }
  async function unwrapPrivateKey(wrapped, passphrase) {
    if (!wrapped || wrapped.v !== 1 || wrapped.kdf !== KDF) throw new Error("not a finance key file (v1)");
    if (!(wrapped.iterations >= MIN_ITER)) throw new Error("key file uses fewer than 600.000 PBKDF2 rounds; refusing");
    let pkcs8;
    try {
      pkcs8 = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: fromB64(wrapped.iv), additionalData: AAD_KEY }, await passKey(passphrase, fromB64(wrapped.salt), wrapped.iterations, "decrypt"), fromB64(wrapped.ct)));
    } catch (e) { throw new Error("wrong passphrase, or the key file is damaged"); }
    return pkcs8;
  }

  const api = { ALG, KDF, MIN_ITER, toB64, fromB64, normalisePassphrase, generatePassphrase, generateKeyPair, fingerprint, publicFromPrivate,
    encrypt, decrypt, encryptJson, decryptJson, wrapPrivateKey, unwrapPrivateKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FinEnvelope = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
// <<< envelope <<<

const KEY_STATE = "finance-state-v1", KEY_MODE = "finance-mode";
const KEY_TOKEN = "finance-token-v1", KEY_KEY = "finance-key-v1", KEY_REPO = "finance-repo-v1";   // this device only, never synced
const KEY_FEED = "finance-feed-v1", KEY_SYNC = "finance-sync-v1";
const GITHUB = "https://api.github.com", STATE_FILE = "state.json.enc", KEY_FILE = "keys/private.wrapped.json";
function readJSON(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function readRaw(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
function writeRaw(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }
function readMode() { return readRaw(KEY_MODE) || "example"; }
function writeMode(m) { writeRaw(KEY_MODE, m); }
function loadState() {
  if (MODE === "yours") { const s = readJSON(KEY_STATE); if (s && s.v === 1) return normalise(s); if (!connected()) MODE = "example"; else return baseState(); }
  const s = readJSON("finance-example-v1");
  return s && s.v === 1 && s.example === VERSION ? normalise(s) : Object.assign(exampleState(TODAY, window.FIN_SEED), { example: VERSION });
}
function loadData() {
  if (window.FIN_DATA) return window.FIN_DATA;              // tests inject data here
  if (MODE === "example") return exampleData(state, TODAY);
  const cache = readJSON(KEY_FEED);
  return cache && cache.v === 1 ? feedToData(feedDocs(cache)) : { tx: [], balances: null, consentUntil: null };
}
/* Example data is never synced. Your own state is saved here first and marked for the next sync. */
function save() {
  if (MODE !== "yours") { writeJSON("finance-example-v1", state); return; }
  writeJSON(KEY_STATE, state);
  if (connected()) { const m = syncMeta(); m.dirty = true; writeJSON(KEY_SYNC, m); scheduleSync(2500); }
}
/* A sync shortly after a change, and the screen is told when it is done. Tests switch the timer off and sync by hand. */
let _syncTimer = null;
function scheduleSync(ms) {
  if (window.FIN_NO_AUTOSYNC || !connected()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => { syncAll().then((r) => window.dispatchEvent(new CustomEvent("finance-sync", { detail: r }))); }, ms);
}

/* ---------- this device's link to the data repository ---------- */
class SyncError extends Error { constructor(code) { super(code); this.code = code; } }
const SYNC_TEXT = { offline: "Offline. Changes are kept here and sent later.", token: "GitHub did not accept this device's token. It may have expired; make a new one and connect again.",
  missing: "The data repository or a file in it was not found. Check the repository name and the token's access.", stale: "Another device saved at the same moment. It will sort itself out at the next sync.",
  passphrase: "Wrong passphrase, or the key file is damaged.", key: "The key on this device cannot read the data. Disconnect and connect again with the passphrase.",
  input: "Fill in the repository as owner/name, the token and the passphrase.", storage: "This device's storage is full." };
const syncText = (e) => SYNC_TEXT[e && e.code] || "Sync failed (" + String((e && e.code) || "unknown").replace(/[^a-z0-9_]/gi, "").slice(0, 24) + ").";
const connected = () => !!(readRaw(KEY_TOKEN) && readRaw(KEY_KEY) && readRaw(KEY_REPO));
const syncMeta = () => readJSON(KEY_SYNC) || {};
/* The data repository belongs to whoever hosts the app: <owner>.github.io/<app> pairs with <owner>/<app>-data. */
function defaultRepo() { const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i), app = location.pathname.split("/").filter(Boolean)[0]; return m && app && !/\./.test(app) ? m[1] + "/" + app + "-data" : ""; }

async function gh(path, opts) {
  const o = opts || {}, token = o.token || readRaw(KEY_TOKEN), repo = o.repo || readRaw(KEY_REPO);
  let res;
  try {
    res = await fetch(GITHUB + "/repos/" + repo + path, { method: o.method || "GET", cache: "no-store", body: o.body ? JSON.stringify(o.body) : undefined,
      headers: Object.assign({ Authorization: "Bearer " + token, Accept: o.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, o.body ? { "Content-Type": "application/json" } : {}) });
  } catch (e) { throw new SyncError("offline"); }
  const exp = res.headers && res.headers.get && res.headers.get("github-authentication-token-expiration");
  if (exp && !o.token) { const m = syncMeta(), t = Date.parse(exp.trim().replace(/^(\S+) (\S+?)(?: ?(UTC|[+-]\d{4}))?$/, (all, d, h, z) => d + "T" + h + (!z || z === "UTC" ? "Z" : z.slice(0, 3) + ":" + z.slice(3)))); if (!Number.isNaN(t)) { m.tokenUntil = new Date(t).toISOString().slice(0, 10); writeJSON(KEY_SYNC, m); } }
  if (res.status === 401 || res.status === 403) throw new SyncError("token");
  if (res.status === 404) throw new SyncError("missing");
  if (res.status === 409 || res.status === 422) throw new SyncError("stale");
  if (!res.ok) throw new SyncError("github_" + res.status);
  try { return o.raw ? await res.text() : await res.json(); } catch (e) { throw new SyncError("answer"); }
}
const deviceKey = () => FinEnvelope.fromB64(readRaw(KEY_KEY));

/* Connect: fetch the passphrase-locked key from the repository, open it, keep the open key and the token here. */
async function connectDevice(repo, token, passphrase) {
  repo = String(repo || "").trim(); token = String(token || "").trim();
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo) || !/^[A-Za-z0-9_]{20,255}$/.test(token) || !String(passphrase || "").trim()) throw new SyncError("input");
  const text = await gh("/contents/" + KEY_FILE, { repo, token, raw: true });
  let pkcs8, wrapped;
  try { wrapped = JSON.parse(text); pkcs8 = await FinEnvelope.unwrapPrivateKey(wrapped, passphrase); } catch (e) { throw new SyncError("passphrase"); }
  const print = await FinEnvelope.fingerprint(await FinEnvelope.publicFromPrivate(pkcs8));
  writeRaw(KEY_REPO, repo); writeRaw(KEY_TOKEN, token); writeRaw(KEY_KEY, FinEnvelope.toB64(pkcs8));
  writeJSON(KEY_SYNC, { fingerprint: print });
  if (!connected()) throw new SyncError("storage");
  return print;
}
/* Disconnect: forget the token, the key and everything decrypted from the repository. Your state stays on the device. */
function disconnectDevice() { [KEY_TOKEN, KEY_KEY, KEY_REPO, KEY_FEED, KEY_SYNC].forEach(drop); }

/* ---------- the bank feed: read-only, new files only ---------- */
const FEED_PATH = /^(tx|balances)\/\d{4}-\d{2}\/[0-9TZ]{8,20}\.enc$/, FEED_ONE = { "pending.json.enc": "pending", "feed/status.enc": "status" };
function feedDocs(cache) {
  const f = cache.files || {}, of = (dir) => Object.keys(f).filter((p) => p.startsWith(dir + "/")).sort().map((p) => f[p].doc);
  const one = (p) => (f[p] ? f[p].doc : null);
  return { tx: of("tx"), balances: of("balances"), pending: one("pending.json.enc"), status: one("feed/status.enc") };
}
async function pullFeed() {
  const tree = await gh("/git/trees/main?recursive=1");
  const want = (Array.isArray(tree.tree) ? tree.tree : []).filter((e) => e && e.type === "blob" && typeof e.sha === "string" && (FEED_PATH.test(e.path) || FEED_ONE[e.path]));
  const old = readJSON(KEY_FEED), cache = { v: 1, files: {} }, key = deviceKey();
  let fetched = 0, unreadable = 0;
  const todo = [];
  for (const e of want) { const had = old && old.v === 1 && old.files && old.files[e.path]; if (had && had.sha === e.sha) cache.files[e.path] = had; else todo.push(e); }
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async (e) => {
      const text = await gh("/contents/" + e.path.split("/").map(encodeURIComponent).join("/"), { raw: true });
      try { cache.files[e.path] = { sha: e.sha, doc: await FinEnvelope.decryptJson(key, JSON.parse(text)) }; fetched++; } catch (err) { unreadable++; }   // not written with our key, or damaged: ignored
    }));
  }
  if (!writeJSON(KEY_FEED, cache)) throw new SyncError("storage");
  return { fetched, unreadable, files: Object.keys(cache.files).length };
}

/* ---------- your state: encrypted, one file, merged when two devices both changed it ---------- */
const b64Text = (s) => FinEnvelope.toB64(new TextEncoder().encode(s)), textB64 = (s) => new TextDecoder().decode(FinEnvelope.fromB64(String(s).replace(/\s/g, "")));
const syncable = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.example; return c; };
async function syncState() {
  const key = deviceKey(), meta = syncMeta();
  for (let attempt = 0; ; attempt++) {
    let remote = null, sha = null;
    try {
      const r = await gh("/contents/" + STATE_FILE);
      sha = r.sha;
      try { remote = await FinEnvelope.decryptJson(key, JSON.parse(textB64(r.content))); } catch (e) { throw new SyncError("key"); }
      if (!remote || remote.v !== 1 || validateState(remote)) throw new SyncError("key");
    } catch (e) { if (!(e instanceof SyncError) || e.code !== "missing") throw e; }
    const localRaw = readRaw(KEY_STATE), local = localRaw ? readJSON(KEY_STATE) : null, hasLocal = !!(local && local.v === 1);
    let next, how;
    if (!remote && !hasLocal) return "empty";                                                    // nothing anywhere yet: load a state file on one device
    else if (!remote) { next = syncable(local); how = "sent"; }
    else if (!hasLocal || !meta.base) { next = remote; how = "received"; }                         // a device with no history of its own takes the repository's state
    else if (sha === meta.sha && !meta.dirty) return "same";
    else if (sha === meta.sha) { next = syncable(local); how = "sent"; }
    else { next = mergeState(meta.base, syncable(local), remote); how = meta.dirty ? "merged" : "received"; }
    let newSha = sha;
    if (!remote || JSON.stringify(next) !== JSON.stringify(remote)) {
      const env = await FinEnvelope.encryptJson(await FinEnvelope.publicFromPrivate(key), next);
      try { newSha = (await gh("/contents/" + STATE_FILE, { method: "PUT", body: Object.assign({ message: "state", content: b64Text(JSON.stringify(env) + "\n") }, sha ? { sha } : {}) })).content.sha; }
      catch (e) { if (e instanceof SyncError && e.code === "stale" && attempt === 0) continue; throw e; }                                        // someone else saved in between: read again, merge again, once
    }
    /* If something was changed on this device while the sync was under way, that change is kept and goes out next time. */
    const untouched = readRaw(KEY_STATE) === localRaw;
    const m = Object.assign(syncMeta(), { sha: newSha, base: next, dirty: !untouched, at: new Date().toISOString(), error: null });
    if ((untouched && !writeJSON(KEY_STATE, next)) || !writeJSON(KEY_SYNC, m)) throw new SyncError("storage");
    return how;
  }
}

/* One sync: bank feed down, state both ways, then the app's state and data are loaded again from this device.
   Never throws: the outcome is kept for the screen to show. Two syncs never run at once. */
let _syncing = null;
function syncAll() {
  if (!connected()) return Promise.resolve({ ok: false, code: "not_connected" });
  if (_syncing) return _syncing;
  _syncing = (async () => {
    let out;
    try {
      const feed = await pullFeed(), how = await syncState();
      out = { ok: true, feed, state: how };
    } catch (e) {
      const code = e instanceof SyncError ? e.code : "unexpected", m = syncMeta();
      m.error = code; writeJSON(KEY_SYNC, m); out = { ok: false, code, text: syncText({ code }) };
    }
    if (readRaw(KEY_MODE) !== "yours" && (readJSON(KEY_STATE) || readJSON(KEY_FEED))) writeMode("yours");
    MODE = readMode(); state = loadState(); DATA = loadData();
    return out;
  })().finally(() => { _syncing = null; });
  return _syncing;
}
