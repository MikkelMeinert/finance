"use strict";
/* =====================================================================
   finance v0.3.0 (18 Nov 2026)
   The screens. The money logic is in core.js; storage, encryption and sync are in vault.js.
   index.html holds the markup and styling and no script of its own, so the page's content
   security policy can refuse every inline script.
   Everything personal (category plans, rules, labels,
   ratings, wishlist) lives in state, which comes from a state file now
   and from the encrypted finance-data repo once sync is built. The code
   holds no personal data: a test checks this file against the seed.
   Until data is connected the app runs on generated example data.
===================================================================== */
const APP_VERSION = "0.4.1";
VERSION = APP_VERSION;                                   // core.js and vault.js are loaded above; they hold the logic and the storage
TODAY = (() => { if (window.FIN_TODAY) return parseD(window.FIN_TODAY); const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
MODE = readMode();
state = loadState();
DATA = loadData();
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- small UI helpers ---------- */
const $ = s => document.querySelector(s);
const view = $("#view");
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2400); }
function openSheet(html, bind) {
  const sh = $("#sheet"); sh.innerHTML = '<div class="grab"></div>' + html; $("#scrim").hidden = false;
  if (bind) bind(sh);
  const f = sh.querySelector("input,button"); if (f) f.focus({ preventScroll: true });
}
function closeSheet() { $("#scrim").hidden = true; $("#sheet").innerHTML = ""; }
$("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scrim").hidden) closeSheet(); });
const sharedLabel = () => esc(state.labels.shared);
function txRow(t) {
  const c = catOf(t), pend = t.status === "PDNG", kind = c ? kindOf(c) : null, tags = [];
  if (t.acct === "shared") tags.push(`<span class="tag accent">Shared</span>`);
  if (t.acct === "budget") tags.push(`<span class="tag">${esc(state.labels.budget)}</span>`);
  if (pend) tags.push('<span class="tag">Pending</span>');
  if (!c && t.amount < 0) tags.push('<span class="tag ask">Pick a category</span>');
  if (kind === "flow") tags.push('<span class="tag">Flow</span>');
  return `<button class="row${pend ? " pending" : ""}" data-tx="${esc(t.id)}">
    <span class="main"><span class="name">${esc(nameOf(t))}</span>
    <span class="sub">${esc(fmtDay(parseD(t.date)))} ${c ? esc(catName(c)) : ""} ${tags.join("")}</span></span>
    <span class="amt${t.amount > 0 ? " in" : ""}">${kr2(t.amount)}</span></button>`;
}
function bindTxRows(root) { root.querySelectorAll("[data-tx]").forEach(b => b.onclick = () => openTx(b.dataset.tx)); }
function setDataPill() {
  const p = $("#dataPill");
  const m = connected() ? syncMeta() : {};
  p.innerHTML = MODE === "example" ? '<span class="dot muted"></span>Example data'
    : m.error && m.error !== "offline" ? '<span class="dot ochre"></span>Sync needs a look'
    : m.dirty ? '<span class="dot muted"></span>Not synced yet'
    : (TX().length ? '<span class="dot"></span>Your data' : '<span class="dot muted"></span>No bank data yet');
}

/* ---------- transaction sheet ---------- */
function openTx(id) {
  const t = TX().find(x => x.id === id); if (!t) return;
  const cur = catOf(t);
  const choices = state.categories.filter(c => t.acct === "shared" ? ["shared", "sharedin", "flow"].includes(c.kind) : [...SPEND_KINDS, "flow"].includes(c.kind));
  openSheet(`<h3>${esc(nameOf(t))}</h3>
    <div class="panel" style="padding:4px 14px;background:var(--ground)">
      <div class="kv"><span class="k">Amount</span><span class="v">${kr2(t.amount)} kr.</span></div>
      <div class="kv"><span class="k">Date</span><span class="v">${esc(fmtDay(parseD(t.date)))}${t.status === "PDNG" ? ", not booked yet" : ""}</span></div>
      <div class="kv"><span class="k">Account</span><span class="v">${esc(state.labels[t.acct] || state.labels.own)}</span></div>
      <div class="kv"><span class="k">Bank text</span><span class="v">${esc(t.text)}</span></div>
    </div>
    <div class="field"><label>Category</label><div class="catpick" id="pick">${choices.map(c => `<button data-c="${c.id}" class="${c.id === cur ? "on" : ""}">${esc(c.name)}</button>`).join("")}</div></div>
    <label class="check"><input type="checkbox" id="always"><span>Always use this category for <b>${esc(nameOf(t))}</b><br><span class="muted small">Adds a rule. Earlier and later transactions from this merchant follow it.</span></span></label>
    <div class="btns"><button class="btn" id="txSave">Save category</button><button class="btn quiet" id="txCancel">Cancel</button></div>`, sh => {
    let sel = cur;
    sh.querySelectorAll("#pick button").forEach(b => b.onclick = () => { sel = b.dataset.c; sh.querySelectorAll("#pick button").forEach(x => x.classList.toggle("on", x === b)); });
    sh.querySelector("#txCancel").onclick = closeSheet;
    sh.querySelector("#txSave").onclick = () => {
      if (!sel) { closeSheet(); return; }
      const always = sh.querySelector("#always").checked;
      if (always) {
        const p = "^" + escRe(nameOf(t));
        state.rules = state.rules.filter(r => r.pattern !== p);
        state.rules.unshift({ id: "u-" + Date.now(), pattern: p, cat: sel, created: ymd(TODAY) });
        delete state.overrides[t.id];
      } else state.overrides[t.id] = sel;
      save(); closeSheet(); render(); toast(always ? "Saved. Rule added for " + nameOf(t) : "Category saved");
    };
  });
}

/* ---------- screens ---------- */
function headerPills() {
  const p = [];
  const feed = DATA.feed, meta = MODE === "yours" && connected() ? syncMeta() : {};
  if (feed && !feed.ok) p.push(`<span class="pill ochre"><span class="dot ochre"></span>The bank feed's last run failed${feed.error ? " (" + esc(feed.error) + ")" : ""}</span>`);
  else if (feed && feed.at && daysBetween(parseD(feed.at.slice(0, 10)), TODAY) > 2) p.push(`<span class="pill ochre"><span class="dot ochre"></span>No bank feed since ${esc(fmtDay(parseD(feed.at.slice(0, 10))))}</span>`);
  if (meta.tokenUntil) { const left = daysBetween(TODAY, parseD(meta.tokenUntil)); if (left <= 14) p.push(`<span class="pill ochre"><span class="dot ochre"></span>This device's token expires in ${Math.max(0, left)} days</span>`); }
  if (DATA.consentUntil) { const left = daysBetween(TODAY, parseD(DATA.consentUntil)); if (left <= 14) p.push(`<span class="pill ochre"><span class="dot ochre"></span>Renew bank access in ${Math.max(0, left)} days</span>`); }
  const unc = TX().filter(t => t.acct === "own" && t.amount < 0 && catOf(t) === null && t.date >= ymd(addDays(TODAY, -31))).length;
  if (unc) p.push(`<a class="pill" href="#month"><span class="dot muted"></span>${unc} to categorise</a>`);
  return p.length ? `<div class="pills">${p.join("")}</div>` : "";
}
function emptyNote() { return MODE === "yours" && !TX().length ? `<p class="empty">No bank data yet. Connect this device in Settings and the bank feed fills this in; your plans and rules are already loaded.</p>` : ""; }

function renderWeek() {
  const w = weekStatus(TODAY), A = w.allowance, left = Math.max(0, w.left);
  /* One bar for the week's allowance, cut into seven day cells: carried overspending first (ochre),
     then this week's spending (grey), then what is left. Today's cell is outlined. */
  const seg = (lo, hi, i) => { const a = Math.max(lo, i / 7), b = Math.min(hi, (i + 1) / 7); return b > a ? [(a - i / 7) * 700, (b - a) * 700] : null; };
  const cf = Math.min(1, w.carried / A), sf = Math.min(1, (w.carried + w.spent) / A);
  const cells = DOW.map((_, i) => {
    const c = seg(0, cf, i), s = seg(cf, sf, i);
    return `<span class="cell${i === w.dayIdx ? " today" : ""}">${c ? `<i class="c" style="left:${c[0]}%;width:${c[1]}%"></i>` : ""}${s ? `<i class="s" style="left:${s[0]}%;width:${s[1]}%"></i>` : ""}</span>`;
  }).join("");
  let note;
  if (w.left < 0) note = `${kr(-w.left)} over. It carries into next week, and an easier week pays it back.`;
  else { const diff = w.pace - w.carried - w.spent; note = `Spent ${kr(w.spent)} since Monday, ${diff >= 0 ? kr(diff) + " under" : kr(-diff) + " ahead of"} an even pace.`; }
  if (w.carried > 0) note += ` ${kr(w.carried)} was carried in from earlier weeks.`;
  if (w.pending) note += ` Includes ${w.pending} card payment${w.pending > 1 ? "s" : ""} the bank hasn't booked yet.`;
  const mk = monthKey(TODAY), ms = monthSpend(mk);
  const prot = state.categories.filter(c => c.kind === "protected").map(c => {
    const s = ms.by[c.id] || 0, p = c.plan || 0;
    return `<a class="chip" href="#month"><span class="t"><span class="dot ochre"></span>${esc(c.name)}</span>
      <span class="v">${krN(s)} of ${krN(p)}</span><span class="meter"><i style="width:${Math.min(100, p ? s / p * 100 : 0)}%"></i></span></a>`;
  }).join("");
  const latest = TX().filter(t => t.date >= ymd(addDays(TODAY, -6))).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0).slice(0, 6);
  view.innerHTML = `${headerPills()}${emptyNote()}
  <section class="hero" aria-label="Safe to spend this week">
    <p class="hero-k">Safe to spend this week</p>
    <p class="hero-n"><span class="num">${krN(left)}</span><span class="unit">kr.</span></p>
    <div class="weekbar" role="img" aria-label="${esc(note)}">${cells}</div>
    <div class="weekdays">${DOW.map((d, i) => `<span class="${i === w.dayIdx ? "on" : ""}">${d.slice(0, 1)}</span>`).join("")}</div>
    <p class="hero-note">${note}</p>
    <div class="legend-inline">${w.carried > 0 ? '<span><i class="sw" style="background:var(--ochre)"></i>Carried</span>' : ""}<span><i class="sw" style="background:var(--spent)"></i>Spent</span><span><i class="sw" style="background:var(--accent-soft)"></i>Left of ${kr(A)}</span><span>Week ${isoWeek(TODAY)}</span></div>
  </section>
  <section class="sec">
    <div class="sec-h"><h2>Protected this month</h2><span class="aside">In the week, never cut</span></div>
    <div class="chips">${prot}</div>
  </section>
  <section class="sec">
    <div class="sec-h"><h2>Latest</h2><a class="aside" href="#month">All of ${MONTHS[TODAY.getMonth()]}</a></div>
    ${latest.length ? `<div class="list">${latest.map(txRow).join("")}</div>` : `<p class="empty">No transactions in the last seven days.</p>`}
  </section>`;
  bindTxRows(view);
}

let monthSel = monthKey(TODAY);
function renderMonth() {
  const mk = monthSel, cur = mk === monthKey(TODAY), upTo = cur ? TODAY.getDate() : daysIn(mk);
  const first = (TX().map(t => t.date).sort()[0] || ymd(TODAY)).slice(0, 7);
  const prev = shiftMonth(mk, -1), ms = monthSpend(mk), lm = prev >= first ? monthSpend(prev) : { by: {}, total: 0 };
  const plan = planTotal();
  const rowsData = state.categories.filter(c => SPEND_KINDS.includes(c.kind)).map(c => ({ c, s: ms.by[c.id] || 0, p: c.plan || 0, l: lm.by[c.id] || 0 }));
  const unc = ms.by._none || 0;
  const scale = Math.max(...rowsData.map(r => Math.max(r.s, r.p, r.l)), unc, 1);
  const catRow = r => {
    const ochre = r.c.kind === "protected" || r.s > r.p;
    return `<button class="cat" data-plan="${r.c.id}"><span class="n">${r.c.kind === "protected" ? '<span class="dot ochre"></span>' : ""}${esc(r.c.name)}</span>
      <span class="v">${krN(r.s)} <span class="p">of ${krN(r.p)}</span></span>
      <span class="bar"><span class="s${ochre ? " ochre" : ""}" style="width:${Math.max(0, r.s) / scale * 100}%"></span><span class="pl" style="left:calc(${r.p / scale * 100}% - 1px)"></span></span>
      <span class="lm">Last month ${krN(r.l)}</span></button>`;
  };
  const groups = [["Everyday", "variable"], ["Protected", "protected"], ["Fixed", "fixed"]];
  const cats = groups.map(([h, k]) => `<div class="group-h">${h}</div>` + rowsData.filter(r => r.c.kind === k).map(catRow).join("")).join("");
  const rec = recurring(), sh = sharedMonth(mk), up = upcomingWithin(31);
  const uncTx = ms.tx.filter(t => catOf(t) === null && t.amount < 0).sort((a, b) => a.date < b.date ? 1 : -1);
  view.innerHTML = `${headerPills()}${emptyNote()}
  <div class="monthnav"><h2>${fmtMonth(mk)}</h2>
    <button class="navbtn" id="mPrev" aria-label="Previous month" ${prev < first ? "disabled" : ""}>‹</button>
    <button class="navbtn" id="mNext" aria-label="Next month" ${cur ? "disabled" : ""}>›</button></div>
  <p class="bignote"><b>${kr(ms.total)}</b> spent of ${kr(plan)} planned${cur ? `, day ${upTo} of ${daysIn(mk)}` : ""}. Last month ${kr(lm.total)}</p>
  <div class="chart" id="paceChart"></div>
  <section class="sec">
    <div class="sec-h"><h2>By category</h2><span class="aside">Tap a line to change its plan</span></div>
    <div class="cats">${cats}${unc ? `<div class="group-h">Not categorised</div><div class="cat" style="cursor:default"><span class="n">Uncategorised</span><span class="v">${krN(unc)}</span><span class="lm">Counted as everyday until you pick a category below.</span></div>` : ""}</div>
    <div class="legend-inline"><span><i class="sw" style="background:var(--accent)"></i>Spent</span><span><i class="sw" style="background:var(--ochre)"></i>Protected, or past the plan</span><span><i class="sw" style="background:var(--ink);width:2px;height:12px"></i>Plan</span></div>
  </section>
  ${uncTx.length ? `<section class="sec"><div class="sec-h"><h2>Pick a category</h2><span class="aside">${uncTx.length} this month</span></div><div class="list">${uncTx.map(txRow).join("")}</div></section>` : ""}
  <section class="sec">
    <div class="sec-h"><h2>Your share of the home</h2><a class="aside" href="#shared">${sharedLabel()}</a></div>
    <div class="panel"><div class="kv"><span class="k">Costs on the shared account</span><span class="v">${kr(sh.costs)}</span></div>
    <div class="kv"><span class="k">Your half, after partner and tenant</span><span class="v">${kr(sh.share)}</span></div>
    <p class="note" style="margin-top:6px">Your standing order to the shared account is a transfer, not spending, so it isn't counted twice.</p></div>
  </section>
  ${cur && up.length ? `<section class="sec"><div class="sec-h"><h2>Coming up</h2><span class="aside">${kr(-sum(up, t => t.amount))} in the next 31 days</span></div>
    <div class="list">${up.map(t => `<div class="item"><span class="main"><span class="name">${esc(nameOf(t))}</span><span class="sub">${esc(fmtDay(parseD(t.date)))}, scheduled at the bank</span></span><span class="amt">${kr2(t.amount)}</span></div>`).join("")}</div>
    <p class="note">Not counted as spent until the bank books it.</p></section>` : ""}
  <section class="sec">
    <div class="sec-h"><h2>Recurring charges</h2><span class="aside">${kr(sum(rec, r => r.perMonth))} a month</span></div>
    ${rec.length ? `<div class="list">${rec.map(r => `<div class="item"><span class="main"><span class="name">${esc(r.name)} ${r.isNew ? '<span class="tag ochre">New</span>' : ""}</span>
      <span class="sub">${esc(catName(r.cat))}${r.acct === "shared" ? ", shared account" : ""}, ${r.cadence}, since ${esc(fmtDay(parseD(r.first)))}</span></span><span class="amt">${krN(r.amount)}</span></div>`).join("")}</div>` : `<p class="empty">None found yet. Recurring charges show up after two or three months of bank data.</p>`}
  </section>`;
  $("#mPrev").onclick = () => { monthSel = prev; renderMonth(); };
  $("#mNext").onclick = () => { monthSel = shiftMonth(mk, 1); renderMonth(); };
  view.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => openPlan(b.dataset.plan));
  bindTxRows(view);
  paceChart($("#paceChart"), mk, upTo, prev >= first ? prev : null, plan);
}
function openPlan(id) {
  const c = CAT(id);
  const why = c.kind === "protected" ? "A protected budget. It counts in the week like everyday spending, but it is never a cut candidate."
    : c.kind === "fixed" ? "Fixed charges are planned monthly and don't count against the week."
    : "Everyday and protected plans set the weekly number: their sum × 12 ÷ 52.";
  openSheet(`<h3>${esc(c.name)}</h3>
    <div class="field"><label for="planIn">Monthly plan (kr.)</label><input id="planIn" type="number" inputmode="numeric" min="0" step="50" value="${c.plan || 0}"></div>
    <p class="note">${why}</p>
    <div class="btns"><button class="btn" id="pSave">Save plan</button><button class="btn quiet" id="pCancel">Cancel</button></div>`, sh => {
    sh.querySelector("#pCancel").onclick = closeSheet;
    sh.querySelector("#pSave").onclick = () => { c.plan = Math.max(0, Math.round(Number(sh.querySelector("#planIn").value) || 0)); save(); closeSheet(); render(); toast("Plan saved"); };
  });
}
/* Cumulative spending this month vs last month vs the plan spread evenly. One y-axis. */
function paceChart(el, mk, upTo, prevMk, plan) {
  const W = 340, H = 180, m = { l: 46, r: 12, t: 10, b: 24 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const days = daysIn(mk), cur = cumulative(mk, upTo), last = prevMk ? cumulative(prevMk, daysIn(prevMk)) : [];
  const maxV = Math.max(plan, ...cur, ...last, 1);
  const step = [1000, 2000, 2500, 5000, 10000].find(s => maxV / s <= 5) || 10000, top = Math.ceil(maxV / step) * step;
  const x = d => m.l + (d - 1) / (days - 1) * iw, y = v => m.t + ih - Math.max(0, v) / top * ih;
  const path = arr => arr.map((v, i) => (i ? "L" : "M") + x(Math.min(i + 1, days)).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  el.innerHTML = `<div class="legend"><span><i class="ln"></i>${monthName(mk)}</span>${prevMk ? `<span><i class="ln last"></i>${monthName(prevMk)}</span>` : ""}<span><i class="ln plan"></i>Plan, spread evenly</span></div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending so far in ${fmtMonth(mk)}: ${kr(cur[cur.length - 1] || 0)} by day ${upTo} against a plan of ${kr(plan)}">
    ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">${krN(v)}</text>`).join("")}
    ${[1, 8, 15, 22, days].map(d => `<text x="${x(d)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">${d}</text>`).join("")}
    <line x1="${x(1)}" y1="${y(plan / days)}" x2="${x(days)}" y2="${y(plan)}" stroke="var(--ink-3)" stroke-width="1"/>
    ${last.length ? `<path d="${path(last)}" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="4 4" stroke-linejoin="round"/>` : ""}
    <path d="${path(cur)}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
    ${cur.length ? `<circle cx="${x(cur.length)}" cy="${y(cur[cur.length - 1])}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` : ""}
    <line id="cx" y1="${m.t}" y2="${m.t + ih}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="hit"/>
  </svg><div class="tip" hidden></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), cx = el.querySelector("#cx"), hit = el.querySelector("#hit");
  const move = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const d = Math.max(1, Math.min(days, Math.round((px - m.l) / iw * (days - 1)) + 1));
    cx.setAttribute("x1", x(d)); cx.setAttribute("x2", x(d)); cx.setAttribute("visibility", "visible");
    const lines = [`<b>Day ${d}</b>`];
    if (d <= cur.length) lines.push(`${monthName(mk)}: ${kr(cur[d - 1])}`);
    if (last.length) lines.push(`${monthName(prevMk)}: ${kr(last[Math.min(d, last.length) - 1])}`);
    lines.push(`Plan: ${kr(plan * d / days)}`);
    tip.innerHTML = lines.join("<br>"); tip.hidden = false;
    tip.style.left = Math.min((x(d) / W) * r.width + 8, el.clientWidth - tip.offsetWidth - 6) + "px"; tip.style.top = "34px";
  };
  hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { tip.hidden = true; cx.setAttribute("visibility", "hidden"); });
}

function renderShared() {
  const mk = monthSel, sh = sharedMonth(mk), hp = state.housingPlan || {}, L = state.labels;
  const line = (id, sign, planned) => `<div class="kv"><span class="k">${esc(catName(id))}</span><span class="v">${kr((sh.lines[id] || 0) * sign)}${planned ? `<br><span class="muted small">plan ${kr(planned)}</span>` : ""}</span></div>`;
  const tx = sh.tx.slice().sort((a, b) => a.date < b.date ? 1 : -1);
  view.innerHTML = `
  <div class="monthnav"><h2>${esc(L.shared)}</h2><a class="linkbtn" href="#month">Back to month</a></div>
  <p class="bignote">${fmtMonth(mk)}.${DATA.balances ? ` Balance today <b>${kr(DATA.balances.shared)}</b>` : ""}</p>
  <section class="sec"><div class="sec-h"><h2>Costs</h2><span class="aside">${kr(sh.costs)}</span></div>
    <div class="panel">${line("boligafgift", -1, hp.boligafgift)}${line("bills", -1, hp.bills)}${line("loan", -1, hp.loan)}</div></section>
  <section class="sec"><div class="sec-h"><h2>Money in</h2></div>
    <div class="panel">${line("contrib", 1)}
    <div class="kv"><span class="k">${esc(L.partner)}</span><span class="v">${sh.partner ? kr(sh.partner) : state.savings.partnerFrom ? "From " + esc(fmtMonth(state.savings.partnerFrom.slice(0, 7))) : "None yet"}</span></div>
    <div class="kv"><span class="k">${esc(L.tenant)}</span><span class="v">${sh.tenant ? kr(sh.tenant) : "None yet"}</span></div></div></section>
  <section class="sec"><div class="sec-h"><h2>Your share</h2></div>
    <div class="panel"><p class="bignote">(${krN(sh.costs)} costs − ${krN(sh.partner)} ${esc(L.partner.toLowerCase())} − ${krN(sh.tenant)} ${esc(L.tenant.toLowerCase())}) ÷ 2 = <b>${kr(sh.share)}</b></p>
    <p class="note" style="margin-top:6px">This is the figure the Month screen shows as your home cost.</p></div></section>
  <section class="sec"><div class="sec-h"><h2>Transactions</h2></div>${tx.length ? `<div class="list">${tx.map(txRow).join("")}</div>` : `<p class="empty">No transactions on the shared account this month.</p>`}</section>`;
  bindTxRows(view);
}

function renderSavings() {
  const S = state.savings, nn = state.nordnet.slice().sort((a, c) => a.month < c.month ? 1 : -1)[0] || { ask: 0, depot: 0, askLeft: 0, month: "" };
  const yr = String(TODAY.getFullYear()), giftCap = (S.giftCap || GIFT_CAP)[yr], askCap = (S.askCeiling || ASK_CEILING)[yr];
  const received = g => sum(state.gifts.filter(x => x.giver === g && x.date.startsWith(yr)), x => x.amount);
  const bufs = monthEndBuffers(6), target = S.bufferTarget || 0, lastBuf = bufs[bufs.length - 1];
  const bmax = Math.max(target, ...bufs.map(b => b.value || 0), 1);
  const port = (nn.ask || 0) + (nn.depot || 0), need = S.fitoutShare || 0, f5 = state.floor5 || {};
  const nnWhen = nn.month ? "Nordnet, " + monthName(nn.month) : "Not entered yet";
  view.innerHTML = `${headerPills()}${emptyNote()}
  <div class="monthnav"><h2>Savings</h2></div>
  <div class="figs">
    <div class="fig"><span class="k">${esc(state.labels.own)}</span><span class="v">${DATA.balances ? kr(DATA.balances.own) : "–"}</span><span class="s">From the bank, today</span></div>
    <div class="fig"><span class="k">${esc(state.labels.shared)}</span><span class="v">${DATA.balances ? kr(DATA.balances.shared) : "–"}</span><span class="s">From the bank, today</span></div>
    ${DATA.balances && typeof DATA.balances.budget === "number" ? `<div class="fig"><span class="k">${esc(state.labels.budget)}</span><span class="v">${kr(DATA.balances.budget)}</span><span class="s">A reserve; not part of the buffer</span></div>` : ""}
    <div class="fig"><span class="k">ASK</span><span class="v">${kr(nn.ask || 0)}</span><span class="s">${esc(nnWhen)}</span></div>
    <div class="fig"><span class="k">Depot</span><span class="v">${kr(nn.depot || 0)}</span><span class="s">${esc(nnWhen)}</span></div>
  </div>
  <div class="btns"><button class="btn quiet sm" id="nnBtn">Update Nordnet</button></div>
  <section class="sec"><div class="sec-h"><h2>Buffer at month-end</h2><span class="aside">Target ${kr(target)}</span></div>
    <div class="panel" style="display:flex;flex-direction:column;gap:10px">
      ${bufs.length ? `<p class="bignote">The ${esc(state.labels.own.toLowerCase())} held <b>${kr(lastBuf.value)}</b> the day before salary on ${esc(fmtDay(parseD(lastBuf.payday)))}.</p>
      <div class="mbars" role="img" aria-label="Lønkonto balance the day before each payday, last ${bufs.length} months, against a target of ${kr(target)}">
        <span class="target" style="bottom:calc(${target / bmax * 100}% * (120 - 32) / 120 + 32px)"></span>
        ${bufs.map(b => `<span class="b"><b>${krN(b.value)}</b><i class="${b.value < target ? "low" : ""}" style="height:calc((100% - 32px) * ${Math.max(0, b.value) / bmax})"></i><span>${MON[parseD(b.payday).getMonth()]}</span></span>`).join("")}
      </div>
      <div class="legend-inline"><span><i class="sw" style="background:var(--accent)"></i>At or above target</span><span><i class="sw" style="background:var(--ochre)"></i>Below</span><span><i class="sw" style="border-top:1.5px dashed var(--ink-3);height:0;width:14px"></i>Target</span></div>`
      : `<p class="note">Shows the ${esc(state.labels.own.toLowerCase())} balance the day before each salary, once there is a month of bank data.</p>`}
    </div></section>
  <section class="sec"><div class="sec-h"><h2>ASK room in ${yr}</h2><span class="aside">${kr(nn.askLeft || 0)} left</span></div>
    <div class="panel" style="display:flex;flex-direction:column;gap:8px">${askCap ? `<div class="track"><i style="width:${Math.min(100, Math.max(0, (askCap - (nn.askLeft || 0)) / askCap * 100))}%"></i></div>` : ""}
    <p class="note">From Nordnet's "Samlet tilbageværende indskud".${askCap ? ` The ${yr} ceiling is ${kr(askCap)}, measured against the account's value on 31 December.` : ""}</p></div></section>
  <section class="sec"><div class="sec-h"><h2>Gift room in ${yr}</h2><span class="aside">${giftCap ? kr(giftCap) + " per giver" : ""}</span></div>
    <div class="panel">${state.labels.givers.map(g => { const r = received(g); return `<div class="kv"><span class="k">${esc(g)}</span><span class="v">${giftCap ? kr(giftCap - r) + " left" : "–"}${r ? `<br><span class="muted small">${kr(r)} received</span>` : ""}</span></div>`; }).join("")}
    ${(S.giftCap || GIFT_CAP)[String(+yr + 1)] ? `<p class="note" style="margin-top:6px">In ${+yr + 1} the tax-free amount is ${kr((S.giftCap || GIFT_CAP)[String(+yr + 1)])} per giver.</p>` : ""}
    <div class="btns" style="margin-top:8px"><button class="btn quiet sm" id="giftBtn">Log a gift</button></div></div></section>
  <section class="sec"><div class="sec-h"><h2>5th floor</h2><span class="aside">${S.handover ? "Handover " + esc(fmtMonth(S.handover.slice(0, 7))) + (S.handoverLate ? " to " + esc(fmtMonth(S.handoverLate.slice(0, 7))) : "") : ""}</span></div>
    <div class="panel" style="display:flex;flex-direction:column;gap:8px">
      <p class="bignote"><b>${kr(port)}</b> in ASK and depot against your share of the fit-out, ${kr(need)}</p>
      <div class="track"><i style="width:${need ? Math.min(100, port / need * 100) : 0}%"></i></div>
      <div class="kv"><span class="k">Loan</span><span class="v">${esc(f5.loan || "Not started")}</span></div>
      <div class="btns"><button class="btn quiet sm" id="f5Btn">Edit fit-out and loan</button></div></div></section>`;
  $("#nnBtn").onclick = () => openSheet(`<h3>Nordnet, ${MONTHS[TODAY.getMonth()]}</h3>
    <div class="field"><label for="nAsk">ASK value (kr.)</label><input id="nAsk" type="number" inputmode="numeric" value="${nn.ask || ""}"></div>
    <div class="field"><label for="nDep">Depot value (kr.)</label><input id="nDep" type="number" inputmode="numeric" value="${nn.depot || ""}"></div>
    <div class="field"><label for="nLeft">Samlet tilbageværende indskud (kr.)</label><input id="nLeft" type="number" inputmode="numeric" value="${nn.askLeft || ""}"></div>
    <div class="btns"><button class="btn" id="nSave">Save values</button><button class="btn quiet" id="nCancel">Cancel</button></div>`, sh => {
    sh.querySelector("#nCancel").onclick = closeSheet;
    sh.querySelector("#nSave").onclick = () => {
      const mk = monthKey(TODAY), v = id => Math.max(0, Math.round(Number(sh.querySelector(id).value) || 0));
      state.nordnet = state.nordnet.filter(x => x.month !== mk).concat([{ month: mk, ask: v("#nAsk"), depot: v("#nDep"), askLeft: v("#nLeft") }]);
      save(); closeSheet(); render(); toast("Nordnet values saved");
    };
  });
  $("#giftBtn").onclick = () => openSheet(`<h3>Log a gift</h3>
    <div class="field"><label for="gGiver">From</label><select id="gGiver">${state.labels.givers.map(g => `<option>${esc(g)}</option>`).join("")}</select></div>
    <div class="field"><label for="gAmt">Amount (kr.)</label><input id="gAmt" type="number" inputmode="numeric"></div>
    <div class="field"><label for="gDate">Date</label><input id="gDate" type="date" value="${ymd(TODAY)}"></div>
    <div class="btns"><button class="btn" id="gSave">Log gift</button><button class="btn quiet" id="gCancel">Cancel</button></div>`, sh => {
    sh.querySelector("#gCancel").onclick = closeSheet;
    sh.querySelector("#gSave").onclick = () => {
      const a = Math.round(Number(sh.querySelector("#gAmt").value) || 0); if (a <= 0) { sh.querySelector("#gAmt").focus(); return; }
      state.gifts.push({ giver: sh.querySelector("#gGiver").value, amount: a, date: sh.querySelector("#gDate").value || ymd(TODAY) });
      save(); closeSheet(); render(); toast("Gift logged");
    };
  });
  $("#f5Btn").onclick = () => openSheet(`<h3>5th floor</h3>
    <div class="field"><label for="fNeed">Your share of the fit-out (kr.)</label><input id="fNeed" type="number" inputmode="numeric" step="1000" value="${need || ""}"></div>
    <div class="field"><label for="fLoan">Loan status</label><input id="fLoan" type="text" value="${esc(f5.loan || "")}"></div>
    <div class="btns"><button class="btn" id="fSave">Save</button><button class="btn quiet" id="fCancel">Cancel</button></div>`, sh => {
    sh.querySelector("#fCancel").onclick = closeSheet;
    sh.querySelector("#fSave").onclick = () => {
      state.savings.fitoutShare = Math.max(0, Math.round(Number(sh.querySelector("#fNeed").value) || 0));
      state.floor5 = Object.assign({}, state.floor5, { loan: sh.querySelector("#fLoan").value.trim() || "Not started" });
      save(); closeSheet(); render(); toast("Saved");
    };
  });
}

function renderBuying() {
  const cands = cutCandidates(), idea = cands[0], mk = monthKey(TODAY), th = state.settings.wishlistThreshold;
  const wl = state.wishlist.map(w => ({ w, s: wishState(w) }));
  const due = wl.filter(x => x.s === "due"), waiting = wl.filter(x => x.s === "waiting"), free = wl.filter(x => x.s === "free");
  const dropped = wl.filter(x => x.s === "dropped"), usedFirst = wl.filter(x => x.s === "used");
  const rat = state.ratings[mk] || {};
  const rec = recurring().filter(r => kindOf(r.cat) === "fixed" || r.cat === "sport");
  const subRow = r => {
    const s = state.subs[r.key] || {}, used = (s.used || []).includes(mk);
    const old = daysBetween(parseD(r.first), TODAY) > 60, lastUse = (s.used || []).slice().sort().pop();
    const stale = s.status === "keep" && old && (!lastUse || lastUse < shiftMonth(mk, -1));
    let action;
    if (!s.status) action = `<div class="btns"><button class="btn sm" data-sub="${esc(r.key)}" data-v="keep">Keep</button><button class="btn quiet sm" data-sub="${esc(r.key)}" data-v="cancel">Cancel it</button></div>`;
    else if (s.status === "cancel") action = `<span class="tag">Marked to cancel</span>`;
    else action = `<button class="btn ${used ? "quiet" : "line"} sm" data-used="${esc(r.key)}">${used ? "Used this month" : "Mark as used"}</button>`;
    return `<div class="item"><span class="main"><span class="name">${esc(r.name)} ${!s.status ? '<span class="tag ochre">New</span>' : ""}</span>
      <span class="sub">${kr(r.amount)} ${r.cadence === "monthly" ? "a month" : "a quarter"}${stale ? ". Not marked as used for two months; cancel it?" : ""}</span></span>${action}</div>`;
  };
  view.innerHTML = `${headerPills()}
  <div class="monthnav"><h2>Buying</h2></div>
  ${idea ? `<div class="card idea"><h3>One idea: ${esc(idea.cat.name)}</h3>
    <p class="note">About <b>${kr(idea.spend)}</b> a month against a plan of ${kr(idea.cat.plan || 0)}, rated ${idea.rating === 1 ? "low" : "some"} value. ${esc(IDEAS[idea.cat.id] || "")}</p>
    <div class="btns"><button class="btn quiet sm" id="snooze">Not now</button></div></div>`
    : `<div class="card"><p class="note">No cut ideas right now. Rate the month below; an idea shows up when something is high spend and low value.</p></div>`}
  <section class="sec"><div class="sec-h"><h2>Wishlist</h2><button class="linkbtn aside" id="addWish">Add something</button></div>
    <div class="list">
      ${due.map(({ w }) => `<div class="item stack due"><span class="name">${esc(w.name)} <span class="muted">${kr(w.price)}</span></span>
        <p class="note"><b>${state.settings.coolingDays} days are up. Still want it?</b></p>
        <div class="btns"><button class="btn sm" data-w="${w.id}" data-v="bought">Buy it</button><button class="btn quiet sm" data-w="${w.id}" data-v="dropped">Drop it</button>
        <a class="btn line sm" href="https://www.dba.dk/soeg/?soeg=${encodeURIComponent(w.name)}" target="_blank" rel="noopener noreferrer">Look on DBA first</a>
        <button class="btn quiet sm" data-w="${w.id}" data-v="used">Bought it used</button></div></div>`).join("")}
      ${waiting.map(({ w }) => { const left = state.settings.coolingDays - daysBetween(parseD(w.added), TODAY); return `<div class="item"><span class="main"><span class="name">${esc(w.name)}</span><span class="sub">${left} day${left === 1 ? "" : "s"} to go</span></span><span class="amt">${krN(w.price)}</span></div>`; }).join("")}
      ${free.map(({ w }) => `<div class="item"><span class="main"><span class="name">${esc(w.name)}</span><span class="sub">Under ${kr(th)}, no wait needed</span></span>
        <div class="btns"><button class="btn quiet sm" data-w="${w.id}" data-v="bought">Bought</button><button class="btn quiet sm" data-w="${w.id}" data-v="dropped">Drop</button></div></div>`).join("")}
      ${!due.length && !waiting.length && !free.length ? `<div class="item"><span class="main"><span class="sub">Nothing waiting. Anything over ${kr(th)} waits ${state.settings.coolingDays} days here before you buy it.</span></span></div>` : ""}
    </div>
    ${dropped.length || usedFirst.length ? `<p class="note">${dropped.length ? `Dropped after cooling off: ${dropped.length} item${dropped.length > 1 ? "s" : ""}, ${kr(sum(dropped, x => x.w.price))} not spent.` : ""}${usedFirst.length ? ` Bought used instead: ${usedFirst.length}.` : ""}</p>` : ""}
  </section>
  <section class="sec"><div class="sec-h"><h2>Cost per use</h2><button class="linkbtn aside" id="addGear">Add gear</button></div>
    ${state.gear.length ? `<div class="list">${state.gear.map(g => { const per = g.price / Math.max(1, g.uses), earned = per <= g.fair;
      return `<div class="item"><span class="main"><span class="name">${esc(g.name)} ${earned ? '<span class="tag accent">Earned its price</span>' : ""}</span>
      <span class="sub">${kr(per)} per use over ${g.uses} uses. ${earned ? `Fair at ${kr(g.fair)}` : `Fair at ${kr(g.fair)}, about ${Math.ceil(g.price / g.fair - g.uses)} more uses to go.`}</span></span>
      <button class="btn quiet sm" data-use="${g.id}" aria-label="Add a use for ${esc(g.name)}">+1</button></div>`; }).join("")}</div>`
    : `<p class="empty">Add sport and cycling gear here and count the uses. The app shows when an item has earned its price.</p>`}
  </section>
  <section class="sec"><div class="sec-h"><h2>Subscriptions</h2><span class="aside">${kr(sum(rec, r => r.perMonth))} a month</span></div>
    ${rec.length ? `<div class="list">${rec.map(subRow).join("")}</div>` : `<p class="empty">Subscriptions show up here once the bank data shows them repeating.</p>`}</section>
  <section class="sec"><div class="sec-h"><h2>Value in ${MONTHS[TODAY.getMonth()]}</h2><span class="aside">How much does it add to your life?</span></div>
    <div class="list">${state.categories.filter(c => c.kind === "variable" || c.kind === "fixed").map(c => `<div class="item"><span class="main"><span class="name">${esc(c.name)}</span></span>
      <span class="rate${rat[c.id] === 1 ? " v1" : ""}" role="group" aria-label="Value of ${esc(c.name)}">${[[1, "Low"], [2, "Some"], [3, "High"]].map(([v, l]) => `<button data-rate="${c.id}" data-v="${v}" class="${rat[c.id] === v ? "on" : ""}" aria-pressed="${rat[c.id] === v}">${l}</button>`).join("")}</span></div>`).join("")}</div>
    <p class="note">Protected budgets aren't rated.</p></section>`;
  const sn = $("#snooze"); if (sn) sn.onclick = () => { state.snoozed[idea.cat.id] = mk; save(); render(); toast("Hidden until next month"); };
  $("#addWish").onclick = openWish; $("#addGear").onclick = openGear;
  view.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { const w = state.wishlist.find(x => x.id === b.dataset.w); w.status = b.dataset.v; w.decided = ymd(TODAY); save(); render(); toast(b.dataset.v === "dropped" ? "Dropped. That's a quiet win." : "Logged"); });
  view.querySelectorAll("[data-use]").forEach(b => b.onclick = () => { const g = state.gear.find(x => x.id === b.dataset.use); g.uses++; save(); render(); });
  view.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { state.subs[b.dataset.sub] = { status: b.dataset.v, used: [] }; save(); render(); });
  view.querySelectorAll("[data-used]").forEach(b => b.onclick = () => { const s = state.subs[b.dataset.used]; s.used = s.used || []; s.used = s.used.includes(mk) ? s.used.filter(x => x !== mk) : s.used.concat(mk); save(); render(); });
  view.querySelectorAll("[data-rate]").forEach(b => b.onclick = () => { state.ratings[mk] = state.ratings[mk] || {}; state.ratings[mk][b.dataset.rate] = Number(b.dataset.v); save(); render(); });
}
function openWish() {
  const th = state.settings.wishlistThreshold, days = state.settings.coolingDays;
  openSheet(`<h3>Add to the wishlist</h3>
    <div class="field"><label for="wName">What is it?</label><input id="wName" type="text" autocomplete="off"></div>
    <div class="field"><label for="wPrice">Price (kr.)</label><input id="wPrice" type="number" inputmode="numeric"></div>
    <div class="field"><label for="wCat">Category</label><select id="wCat">${state.categories.filter(c => SPEND_KINDS.includes(c.kind)).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
    <p class="note">Over ${kr(th)} it waits ${days} days, then the app asks whether you still want it.</p>
    <div class="btns"><button class="btn" id="wSave">Add to wishlist</button><button class="btn quiet" id="wCancel">Cancel</button></div>`, sh => {
    sh.querySelector("#wCancel").onclick = closeSheet;
    sh.querySelector("#wSave").onclick = () => {
      const name = sh.querySelector("#wName").value.trim(), price = Math.round(Number(sh.querySelector("#wPrice").value) || 0);
      if (!name) { sh.querySelector("#wName").focus(); return; } if (price <= 0) { sh.querySelector("#wPrice").focus(); return; }
      state.wishlist.push({ id: "w" + Date.now(), name, price, cat: sh.querySelector("#wCat").value, added: ymd(TODAY) });
      save(); closeSheet(); render(); toast(price >= th ? `Added. Ask again in ${days} days.` : "Added. No wait needed.");
    };
  });
}
function openGear() {
  openSheet(`<h3>Add gear</h3>
    <div class="field"><label for="gName">Item</label><input id="gName" type="text" autocomplete="off"></div>
    <div class="field"><label for="gPrice">Price (kr.)</label><input id="gPrice" type="number" inputmode="numeric"></div>
    <div class="field"><label for="gFair">A fair price per use (kr.)</label><input id="gFair" type="number" inputmode="numeric" value="60"></div>
    <p class="note">Compare with renting it or a day pass. When the cost per use drops to this, it has earned its price.</p>
    <div class="btns"><button class="btn" id="gSave">Add gear</button><button class="btn quiet" id="gCancel">Cancel</button></div>`, sh => {
    sh.querySelector("#gCancel").onclick = closeSheet;
    sh.querySelector("#gSave").onclick = () => {
      const name = sh.querySelector("#gName").value.trim(), price = Math.round(Number(sh.querySelector("#gPrice").value) || 0), fair = Math.max(1, Math.round(Number(sh.querySelector("#gFair").value) || 60));
      if (!name) { sh.querySelector("#gName").focus(); return; } if (price <= 0) { sh.querySelector("#gPrice").focus(); return; }
      state.gear.push({ id: "g" + Date.now(), name, price, uses: 0, fair });
      save(); closeSheet(); render(); toast("Gear added");
    };
  });
}

/* ---------- Sunday and the reports for Claude ---------- */
function renderSunday() {
  const { w, unus, due, idea, newRec, unc } = sundayData(), isSun = w.dayIdx === 6;
  const lastW = lastCheckin(), lastM = lastCheckin("monthly");
  const line1 = w.left >= 0 ? `A calm week: ${kr(w.spent)} spent, ${kr(w.left)} under the week's ${kr(w.allowance - w.carried)}`
    : `${kr(w.spent)} spent this week, ${kr(-w.left)} over. It carries into next week`;
  const items = [...unus.map(u => `${esc(nameOf(u.t))}, ${kr(-u.t.amount)} on ${esc(fmtDay(parseD(u.t.date)))}: ${esc(u.why)}`),
    ...newRec.map(r => `New recurring charge: ${esc(r.name)}, ${kr(r.amount)} ${r.cadence === "monthly" ? "a month" : "a quarter"}`),
    ...(unc.length ? [`${unc.length} transaction${unc.length > 1 ? "s" : ""} without a category`] : [])];
  const monthlyDue = isFirstSundayOfMonth(TODAY) || !lastM || daysBetween(parseD(lastM), TODAY) >= 28;
  view.innerHTML = `
  <div class="monthnav"><h2>Sunday check-in</h2></div>
  <p class="bignote">Week ${isoWeek(TODAY)}, ${w.mon.getDate()} ${MON[w.mon.getMonth()]} to ${w.sun.getDate()} ${MON[w.sun.getMonth()]}. ${isSun ? "Five minutes." : `It's ${DOW[w.dayIdx]}; this is the week so far.`}</p>
  <div class="sunday">
    <p class="line1">${line1}</p>
    <div><h3>Anything unusual</h3>${items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>` : `<p class="note">Nothing stood out.</p>`}</div>
    <div><h3>Wishlist</h3>${due.length ? `<p class="note">${due.map(d => esc(d.name)).join(" and ")} ${due.length > 1 ? "are" : "is"} past the cooling-off days. <a href="#buying">Decide on the Buying screen</a></p>` : `<p class="note">Nothing due.</p>`}</div>
    <div><h3>One suggestion</h3><p class="note">${idea ? `${esc(idea.cat.name)}: ${esc(IDEAS[idea.cat.id] || "")}` : "None this week."}</p></div>
  </div>
  <section class="sec">
    <div class="sec-h"><h2>Check in with Claude</h2><span class="aside">${lastW ? "Last " + esc(fmtDay(parseD(lastW))) : "No check-ins yet"}</span></div>
    ${monthlyDue ? `<p class="note">${lastM ? `Last monthly review ${esc(fmtDay(parseD(lastM)))}.` : "No monthly review yet."} Time for one: it covers everything since then and the months before, so you can see where the money actually goes.</p>` : ""}
    <div class="btns"><button class="btn${monthlyDue ? " quiet" : ""}" id="repWeek">Weekly report</button><button class="btn${monthlyDue ? "" : " quiet"}" id="repMonth">Monthly review</button></div>
    <div id="reportBox" hidden><textarea class="report" id="reportText" readonly aria-label="Report for Claude"></textarea>
      <div class="btns" style="margin-top:8px"><button class="btn quiet sm" id="copyReport">Copy report</button><button class="btn sm" id="markDone">Mark check-in done</button></div>
      <p class="note" style="margin-top:6px">Paste it into a session with Claude. It holds no token or key.</p></div>
  </section>`;
  let kind = null;
  const show = k => { kind = k; $("#reportText").value = k === "monthly" ? buildMonthlyReview() : buildWeeklyReport(); $("#reportBox").hidden = false; };
  $("#repWeek").onclick = () => show("weekly");
  $("#repMonth").onclick = () => show("monthly");
  $("#copyReport").onclick = () => {
    const ta = $("#reportText"), fallback = () => { ta.focus(); ta.select(); toast("Selected. Copy it from the menu."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(() => toast("Report copied"), fallback); else fallback();
  };
  $("#markDone").onclick = () => { state.checkins.push({ date: ymd(TODAY), kind }); save(); render(); toast(kind === "monthly" ? "Monthly review logged" : "Check-in logged"); };
}
/* ---------- settings ---------- */
$("#settingsBtn").onclick = () => {
  const ur = state.rules.filter(r => !r.seed), seedN = state.rules.length - ur.length;
  const consent = DATA.consentUntil ? `Valid until ${esc(fmtDay(parseD(DATA.consentUntil)))} ${DATA.consentUntil.slice(0, 4)}. A reminder appears 14 days before.` : "Not connected yet.";
  openSheet(`<h3>Settings</h3>
    <div class="panel" style="padding:4px 14px;background:var(--ground)">
      <div class="kv"><span class="k">Data</span><span class="v">${MODE === "example" ? "Example data, made up" : "Your state file" + (TX().length ? " and bank data" : "; no bank data yet")}</span></div>
      <div class="kv"><span class="k">Bank access</span><span class="v">${consent}</span></div>
      <div class="kv"><span class="k">Rules</span><span class="v">${seedN} from the start file, ${ur.length} of yours</span></div>
      <div class="kv"><span class="k">Version</span><span class="v">${APP_VERSION}</span></div>
    </div>
    <div class="field"><label for="stateFile">Load your state file</label><input id="stateFile" type="file" accept="application/json,.json">
      <span class="note">The file made by derive_seed.py. Needed once, on one device; a connected device sends it on, encrypted.</span></div>
    ${deviceBox()}
    ${MODE === "yours" ? `<div class="btns"><button class="btn line sm" id="toExample">Show example data</button></div>` : (readJSON(KEY_STATE) ? `<div class="btns"><button class="btn line sm" id="toYours">Show your data</button></div>` : "")}
    ${ur.length ? `<div class="field"><label>Your rules</label><div class="list" style="background:var(--ground)">${ur.map(r => `<div class="item"><span class="main"><span class="name">${esc(r.pattern.replace(/^\^/, "").replace(/\\/g, ""))}</span><span class="sub">${esc(catName(r.cat))}</span></span><button class="btn quiet sm" data-delrule="${esc(r.id)}">Remove</button></div>`).join("")}</div></div>` : ""}
    <div class="btns">${MODE === "example" ? `<button class="btn line" id="resetBtn">Reset example data</button>` : ""}<button class="btn quiet" id="sClose">Close</button></div>
    <p class="note" id="loadMsg" role="status"></p>`, sh => {
    sh.querySelector("#sClose").onclick = closeSheet;
    bindDeviceBox(sh);
    sh.querySelectorAll("[data-delrule]").forEach(b => b.onclick = () => { state.rules = state.rules.filter(r => r.id !== b.dataset.delrule); save(); closeSheet(); render(); toast("Rule removed"); });
    const rb = sh.querySelector("#resetBtn");
    if (rb) rb.onclick = () => { if (rb.dataset.armed) { state = Object.assign(exampleState(TODAY, window.FIN_SEED), { example: APP_VERSION }); save(); DATA = loadData(); closeSheet(); render(); toast("Example data reset"); return; } rb.dataset.armed = "1"; rb.textContent = "Tap again to reset"; };
    const te = sh.querySelector("#toExample"); if (te) te.onclick = () => switchMode("example");
    const ty = sh.querySelector("#toYours"); if (ty) ty.onclick = () => switchMode("yours");
    sh.querySelector("#stateFile").onchange = e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { const r = loadStateText(String(rd.result)); if (r.ok) { closeSheet(); render(); toast("State loaded: " + r.summary); } else sh.querySelector("#loadMsg").textContent = r.error; };
      rd.readAsText(f);
    };
  });
};
function loadStateText(text) {
  let s; try { s = JSON.parse(text); } catch (e) { return { ok: false, error: "The file isn't valid JSON." }; }
  const err = validateState(s); if (err) return { ok: false, error: err };
  const prev = MODE === "yours" ? readJSON(KEY_STATE) : null;
  const next = normalise(Object.assign(baseState(), s));
  if (prev) ["overrides", "ratings", "snoozed", "wishlist", "gear", "subs", "gifts", "checkins"].forEach(k => { if (prev[k] && !s[k]) next[k] = prev[k]; });  // a fresh seed keeps what you've done
  if (prev) next.rules = (prev.rules || []).filter(r => !r.seed).concat(next.rules.filter(r => r.seed !== false));
  writeJSON(KEY_STATE, next); switchMode("yours", true); save();     // save() marks it for the next sync when this device is connected
  return { ok: true, summary: `${next.categories.filter(c => SPEND_KINDS.includes(c.kind)).length} categories, ${next.rules.length} rules` };
}
function switchMode(m, quiet) {
  MODE = m; writeMode(m);
  state = loadState(); DATA = loadData(); monthSel = monthKey(TODAY);
  if (!quiet) { closeSheet(); render(); toast(m === "example" ? "Showing example data" : "Showing your data"); }
}

/* ---------- this device and the data repository ---------- */
function deviceBox() {
  if (!connected()) return `<div class="field"><label>Connect this device</label>
      <span class="note">Reads your bank data and keeps your plans in step between devices. The token and the key stay on this device.</span>
      <input id="dRepo" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="owner/finance-data" aria-label="Data repository" value="${esc(defaultRepo())}">
      <input id="dToken" type="password" autocomplete="off" placeholder="This device's token" aria-label="Device token" style="margin-top:6px">
      <input id="dPass" type="password" autocomplete="off" placeholder="finance passphrase" aria-label="Passphrase" style="margin-top:6px">
      <div class="btns" style="margin-top:8px"><button class="btn sm" id="dConnect">Connect</button></div></div>`;
  const m = syncMeta(), when = m.at ? fmtDay(parseD(m.at.slice(0, 10))) + " " + new Date(m.at).toTimeString().slice(0, 5) : "not yet";
  return `<div class="field"><label>This device</label>
    <div class="panel" style="padding:4px 14px;background:var(--ground)">
      <div class="kv"><span class="k">Data repository</span><span class="v">${esc(readRaw(KEY_REPO))}</span></div>
      <div class="kv"><span class="k">Key fingerprint</span><span class="v">${esc(m.fingerprint || "")}</span></div>
      <div class="kv"><span class="k">Last sync</span><span class="v">${esc(when)}${m.dirty ? "; changes waiting" : ""}</span></div>
      ${m.error ? `<div class="kv"><span class="k">Last attempt</span><span class="v">${esc(syncText({ code: m.error }))}</span></div>` : ""}
      <div class="kv"><span class="k"><label for="dUntil">Token expires</label></span><span class="v"><input id="dUntil" type="date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(m.tokenUntil || "") ? m.tokenUntil : "")}" style="width:auto;padding:4px 8px"></span></div>
    </div>
    <span class="note">The browser can't read the expiry from GitHub, so enter the date GitHub showed when you made this device's token. A reminder appears 14 days before.</span>
    <div class="btns" style="margin-top:8px"><button class="btn sm" id="dSync">Sync now</button><button class="btn line sm" id="dDisconnect">Disconnect this device</button></div></div>`;
}
function afterSync(r, quiet) {
  monthSel = monthKey(TODAY); render();
  if (!quiet) toast(r.ok ? (r.state === "empty" ? "Connected. Load your state file on one device." : "Synced") : r.text || "Sync failed");
}
function bindDeviceBox(sh) {
  const msg = sh.querySelector("#loadMsg"), c = sh.querySelector("#dConnect"), s = sh.querySelector("#dSync"), d = sh.querySelector("#dDisconnect");
  if (c) c.onclick = async () => {
    c.disabled = true; msg.textContent = "Opening the key. This takes a few seconds.";
    try {
      const print = await connectDevice(sh.querySelector("#dRepo").value, sh.querySelector("#dToken").value, sh.querySelector("#dPass").value);
      if (readJSON(KEY_STATE)) writeMode("yours");
      msg.textContent = "Key " + print + " opened. Fetching your data.";
      const r = await syncAll(); closeSheet(); afterSync(r);
    } catch (e) { c.disabled = false; msg.textContent = syncText(e); }
  };
  const u = sh.querySelector("#dUntil");
  if (u) u.onchange = () => {
    const v = u.value, m = syncMeta();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    if (v) m.tokenUntil = v; else delete m.tokenUntil;
    writeJSON(KEY_SYNC, m); setDataPill(); toast(v ? "Token date saved" : "Token date cleared");
  };
  if (s) s.onclick = async () => { s.disabled = true; msg.textContent = "Syncing."; const r = await syncAll(); closeSheet(); afterSync(r); };
  if (d) d.onclick = () => { if (d.dataset.armed) { disconnectDevice(); DATA = loadData(); closeSheet(); render(); toast("Disconnected. The token and key are removed from this device."); return; } d.dataset.armed = "1"; d.textContent = "Tap again to disconnect"; };
}
window.addEventListener("finance-sync", e => { if ($("#scrim").hidden) afterSync(e.detail, e.detail.ok || e.detail.code === "offline"); else setDataPill(); });

/* ---------- routing ---------- */
const VIEWS = { week: renderWeek, month: renderMonth, savings: renderSavings, buying: renderBuying, sunday: renderSunday, shared: renderShared };
function current() { const h = location.hash.replace(/^#/, ""); return VIEWS[h] ? h : "week"; }
function render() {
  const v = current();
  setDataPill();
  VIEWS[v]();
  const tab = v === "shared" ? "month" : v;
  document.querySelectorAll(".tabs a").forEach(a => { const on = a.dataset.tab === tab; a.classList.toggle("on", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}
window.addEventListener("hashchange", () => { closeSheet(); render(); window.scrollTo(0, 0); });
render();
/* A connected device syncs when the app opens and when it comes back to the front after a while. */
if (!window.FIN_NO_AUTOSYNC && connected()) {
  scheduleSync(50);
  document.addEventListener("visibilitychange", () => { const at = syncMeta().at; if (!document.hidden && (!at || Date.now() - Date.parse(at) > 10 * 60 * 1000)) scheduleSync(50); });
}
if ("serviceWorker" in navigator && location.protocol === "https:" && !window.FIN_NO_SW) navigator.serviceWorker.register("sw.js").catch(() => {});
