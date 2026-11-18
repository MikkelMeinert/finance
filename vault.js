/* finance: where the app keeps things. Today that is this device only (localStorage);
   encryption and sync with the private data repository are added here next.
   Storage names live here. The future token and key get their own names, outside state,
   so they can never end up in an export or in the repository. */
"use strict";
const KEY_STATE = "finance-state-v1", KEY_MODE = "finance-mode";
function readJSON(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function readMode() { try { return localStorage.getItem(KEY_MODE) || "example"; } catch (e) { return "example"; } }
function writeMode(m) { try { localStorage.setItem(KEY_MODE, m); } catch (e) {} }
function loadState() {
  if (MODE === "yours") { const s = readJSON(KEY_STATE); if (s && s.v === 1) return normalise(s); MODE = "example"; }
  const s = readJSON("finance-example-v1");
  return s && s.v === 1 && s.example === VERSION ? normalise(s) : Object.assign(exampleState(TODAY, window.FIN_SEED), { example: VERSION });
}
function loadData() {
  if (window.FIN_DATA) return window.FIN_DATA;              // tests inject data here
  if (MODE === "example") return exampleData(state, TODAY);
  return { tx: [], balances: null, consentUntil: null };    // the bank feed fills this once sync is built
}
function save() { writeJSON(MODE === "yours" ? KEY_STATE : "finance-example-v1", state); }
