/* Bank consent callback for finance.
   The bank sends the browser here with ?code=...&state=... after access is approved.
   This page only shows those two values so they can be pasted into the Reconsent script on the Mac.
   It stores nothing, sends nothing anywhere, and the code is useless without the private key on the Mac. */
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  var SAFE = /^[A-Za-z0-9._~+\/=-]{1,512}$/;
  var raw = { code: q.get("code"), state: q.get("state"), error: q.get("error") };
  var pick = function (v) { return typeof v === "string" && SAFE.test(v) ? v : ""; };
  var code = pick(raw.code), state = pick(raw.state), error = pick(raw.error);

  // Take the code out of the address bar and the history entry straight away.
  try { history.replaceState(null, "", location.pathname); } catch (e) { /* not fatal */ }

  var $ = function (id) { return document.getElementById(id); };
  var say = function (title, text) { $("title").textContent = title; $("status").textContent = text; };

  if (error) {
    say("Bank access was not approved", "The bank answered: " + error + ". Nothing was changed. Run Reconsent again when you are ready.");
    return;
  }
  if (raw.code !== null && !code) {
    say("Unexpected answer from the bank", "The code had an unexpected format, so it is not shown. Run Reconsent again.");
    return;
  }
  if (!code) return;

  say("Code received", "Paste this code into the Reconsent window in Terminal. It expires within minutes, so do it now. You can close this page afterwards.");
  $("code").textContent = code;
  $("codeBox").hidden = false;
  if (state) { $("state").textContent = state; $("stateBox").hidden = false; }
  var b = $("copy");
  b.hidden = false;
  b.addEventListener("click", function () {
    var done = function () { b.textContent = "Copied"; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { b.textContent = "Select the code and copy it by hand"; });
    else b.textContent = "Select the code and copy it by hand";
  });
})();
