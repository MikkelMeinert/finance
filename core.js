/* finance: the money logic. No screen, no storage, no network: this file runs the same in the app and in Node
   (the check-in script and the tests load it there), so there is one copy of the maths.
   It works on one context: state (plans, rules, ratings...), DATA (transactions, balances) and TODAY.
   The app sets these directly; Node calls use({ state, data, today, mode, version }).
   It holds no personal data: a test checks this file against the seed. */
"use strict";
let state = null, DATA = { tx: [], balances: null, consentUntil: null }, TODAY = null, MODE = "yours", VERSION = "";
function use(ctx) {
  state = normalise(ctx.state); DATA = ctx.data || { tx: [], balances: null, consentUntil: null };
  TODAY = typeof ctx.today === "string" ? parseD(ctx.today) : ctx.today; MODE = ctx.mode || "yours"; VERSION = ctx.version || "";
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const monthKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1);
const monthStart = mk => parseD(mk + "-01");
const shiftMonth = (mk, n) => { const d = monthStart(mk); return monthKey(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
const daysIn = mk => { const d = monthStart(mk); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
const dow = d => (d.getDay() + 6) % 7;                    // Monday = 0
const mondayOf = d => addDays(d, -dow(d));
const isoWeek = d => { const t = addDays(d, 3 - dow(d)); const j = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - j) / 864e5 - 3 + dow(j)) / 7); };
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDay = d => DOW[dow(d)] + " " + d.getDate() + " " + MON[d.getMonth()];
const fmtMonth = mk => { const d = monthStart(mk); return MONTHS[d.getMonth()] + " " + d.getFullYear(); };
const monthName = mk => MONTHS[monthStart(mk).getMonth()];

/* ---------- money ---------- */
const nf0 = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kr = n => nf0.format(Math.round(n) || 0) + " kr.";          // || 0 turns −0 into 0
const krN = n => nf0.format(Math.round(n) || 0);
const kr2 = n => (n < 0 ? "−" : "+") + nf2.format(Math.abs(n));
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

/* ---------- defaults (structure only, no personal figures) ---------- */
const DEFAULT_CATEGORIES = [
  ["groceries", "Groceries", "variable"], ["kiosk", "Snacks & kiosk", "variable"], ["restaurants", "Restaurants & bars", "variable"],
  ["cafes", "Cafés & bakeries", "variable"], ["mobilepay", "MobilePay with friends", "variable"], ["home", "Home & furnishing", "variable"],
  ["clothing", "Clothing & shopping", "variable"], ["care", "Health & personal care", "variable"], ["transport", "Transport", "variable"],
  ["events", "Events & tickets", "variable"], ["other", "Other", "variable"],
  ["sport", "Sport", "protected"], ["cycling", "Cycling", "protected"], ["travel", "Travel", "protected"],
  ["media", "Streaming, media & apps", "fixed"], ["ai", "AI tools", "fixed"], ["insurance", "Insurance", "fixed"],
  ["salary", "Salary", "flow"], ["income", "Other income", "flow"], ["housing", "Housing share", "flow"],
  ["savings", "Savings & Nordnet", "flow"], ["transfer", "Own transfer", "flow"], ["giftin", "Gift received", "flow"],
  ["boligafgift", "Boligafgift", "shared"], ["bills", "Bills", "shared"], ["loan", "Andelslån", "shared"],
  ["contrib", "Brothers' payments", "sharedin"], ["partner", "Partner", "sharedin"], ["tenant", "Tenant", "sharedin"]
].map(([id, name, kind]) => ({ id, name, kind }));
/* Example-only figures, round and made up. Your real plans arrive with your state file. */
const EXAMPLE_PLAN = { groceries: 3000, kiosk: 500, restaurants: 700, cafes: 400, mobilepay: 500, home: 500, clothing: 500, care: 300,
  transport: 300, events: 150, other: 400, sport: 2000, cycling: 700, travel: 1000, media: 200, ai: 0, insurance: 50 };
const EXAMPLE_RULES = [
  ["til fælleskonto", "housing"], ["lønoverførsel", "salary"], ["nordnet", "savings"], ["\\beur kurs", "travel"],
  ["candy kiosk|circle k|7-eleven", "kiosk"], ["netto|rema 1000|coop 365|lidl|føtex|meny", "groceries"],
  ["wolt|isola pizza|mikkeller|ramen", "restaurants"], ["lagkagehuset|coffee collective|emmerys|original coffee", "cafes"],
  ["mobilepay", "mobilepay"], ["ikea|jysk|blå kors|silvan", "home"], ["zalando|uniqlo|h&m", "clothing"],
  ["matas|apotek", "care"], ["rejsekort|dsb", "transport"], ["ebillet", "events"],
  ["puregym|cph beach|matchi|marathon sport", "sport"], ["cykelsmeden|jupiter cykler", "cycling"], ["flixbus|norwegian", "travel"],
  ["spotify|apple\\.com", "media"], ["claude\\.ai", "ai"], ["djøf forsikring", "insurance"],
  ["boligafgift", "boligafgift"], ["andel energi|hiper", "bills"], ["andelsboliglån", "loan"], ["indbetaling", "contrib"]
].map(([pattern, cat], i) => ({ id: "ex-" + i, pattern, cat, seed: true }));
const ASK_CEILING = { "2026": 174200, "2027": 179300 };       // public figures
const GIFT_CAP = { "2026": 80600, "2027": 83000 };

function baseState() {
  return {
    v: 1, labels: { own: "Lønkonto", shared: "Shared account", budget: "Budgetkonto", brother: "Brother", partner: "Partner", tenant: "Tenant", givers: ["Giver 1", "Giver 2", "Giver 3"] },
    categories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)), rules: [], overrides: {}, ratings: {}, snoozed: {},
    wishlist: [], gear: [], subs: {}, nordnet: [], gifts: [], checkins: [],
    housingPlan: {}, savings: { bufferTarget: 25000, askCeiling: ASK_CEILING, giftCap: GIFT_CAP },
    floor5: { loan: "Not started" }, settings: { wishlistThreshold: 500, coolingDays: 7 }
  };
}
function exampleState(today, seed) {
  const s = baseState(), d = n => ymd(addDays(today, -n));
  s.categories.forEach(c => { if (c.id in EXAMPLE_PLAN) c.plan = EXAMPLE_PLAN[c.id]; });
  s.rules = EXAMPLE_RULES.map(r => Object.assign({}, r));
  s.housingPlan = { boligafgift: 12000, bills: 2500, loan: 6500 };
  s.savings = { bufferTarget: 25000, askCeiling: ASK_CEILING, giftCap: GIFT_CAP, fitoutShare: 240000, handover: "2027-10-01", handoverLate: "2028-01-01" };
  s.ratings = { [monthKey(today)]: { groceries: 3, kiosk: 1, restaurants: 2, cafes: 2, mobilepay: 2, home: 2, clothing: 2, care: 3, transport: 3, events: 3, other: 1, media: 2, ai: 2, insurance: 3 } };
  s.wishlist = [
    { id: "w1", name: "Merino cycling jersey", price: 1200, cat: "cycling", added: d(4) },
    { id: "w2", name: "Noise-cancelling headphones", price: 2300, cat: "other", added: d(9) },
    { id: "w3", name: "Bike lights", price: 450, cat: "cycling", added: d(2) },
    { id: "w4", name: "Smartwatch", price: 2900, cat: "sport", added: d(40), status: "dropped", decided: d(33) },
    { id: "w5", name: "Rain jacket", price: 1100, cat: "clothing", added: d(30), status: "used", decided: d(23) }
  ];
  s.gear = [
    { id: "g1", name: "Gravel bike", price: 14000, uses: 61, fair: 100, cat: "cycling" },
    { id: "g2", name: "Squash racket", price: 1100, uses: 38, fair: 60, cat: "sport" },
    { id: "g3", name: "Padel racket", price: 1290, uses: 3, fair: 60, cat: "sport" }
  ];
  const mk = monthKey(today);
  s.subs = { spotify: { status: "keep", used: [mk] }, "apple.com/bill": { status: "keep", used: [mk] }, puregym: { status: "keep", used: [mk] }, "cph beach": { status: "keep", used: [] } };
  s.nordnet = [{ month: shiftMonth(mk, -1), ask: 70000, depot: 1500, askLeft: 104000 }];
  s.checkins = [{ date: ymd(mondayOf(addDays(today, -7))), kind: "weekly" }];
  if (seed) mergeSeed(s, seed);   // preview only: real plans over example transactions
  return s;
}
function mergeSeed(s, seed) {
  if (seed.categories) { const by = Object.fromEntries(seed.categories.map(c => [c.id, c])); s.categories = s.categories.map(c => by[c.id] ? Object.assign({}, c, by[c.id]) : c).concat(seed.categories.filter(c => !s.categories.some(x => x.id === c.id))); }
  ["housingPlan", "labels"].forEach(k => { if (seed[k]) s[k] = Object.assign({}, s[k], seed[k]); });
  if (seed.savings) s.savings = Object.assign({}, s.savings, seed.savings);
  if (seed.nordnet) s.nordnet = seed.nordnet;
  if (seed.rules) s.rules = seed.rules;
}

/* ---------- example transactions (deterministic per day; never your data) ---------- */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const EX_START = "2026-06-01";
const EX_SHOPS = {   // category: [merchants, low, high]
  groceries: [["Netto", "Rema 1000", "Coop 365", "Lidl", "Føtex", "Meny"], 40, 380], kiosk: [["Candy Kiosk", "Circle K", "7-Eleven"], 22, 85],
  restaurants: [["Wolt", "Isola Pizza", "Mikkeller Bar", "Ramen To Bíiru"], 90, 360], cafes: [["Lagkagehuset", "Coffee Collective", "Emmerys", "Original Coffee"], 35, 95],
  mobilepay: [["MobilePay, friend"], 60, 280], home: [["IKEA", "Jysk", "Blå Kors", "Silvan"], 80, 600], clothing: [["Zalando", "Uniqlo", "H&M"], 150, 650],
  care: [["Matas", "Apotek"], 60, 280], transport: [["Rejsekort"], 20, 60], events: [["Ebillet"], 120, 320],
  other: [["Bryggen Isenkram", "Vesterbro Bazar", "Strøget Souvenir"], 80, 380], cycling: [["Cykelsmeden", "Jupiter Cykler"], 150, 900]
};
function exampleData(state, today) {
  const tx = [], end = ymd(today), plan = id => (state.categories.find(c => c.id === id) || {}).plan || 0;
  for (let d = parseD(EX_START); ymd(d) <= end; d = addDays(d, 1)) {
    const ds = ymd(d), r = rng(hashStr(ds)), dd = d.getDate(), wd = dow(d), mk = monthKey(d), last = daysIn(mk); let n = 0;
    const add = (acct, amount, cp, text, card) => tx.push({ id: "ex-" + ds + "-" + acct + "-" + (n++), acct, date: ds, amount: Math.round(amount * 100) / 100, cur: "DKK", cp, text: text || cp, card: !!card });
    const payday = (() => { let p = parseD(mk + "-" + pad(last)); while (dow(p) > 4) p = addDays(p, -1); return p.getDate(); })();
    if (dd === 1) {
      add("own", -11200, "Til fælleskonto", "Fast overførsel"); add("own", -500, "Nordnet", "Månedsopsparing"); add("own", -313, "PureGym", "Medlemskab");
      add("shared", 11200, "Indbetaling, lønkonto", "Fast overførsel"); add("shared", 11200, "Indbetaling, bror", "Fast overførsel");
      add("shared", -(state.housingPlan.boligafgift || 12000), "Boligafgift", "Betalingsservice");
    }
    if (dd === 2) add("own", -180, "CPH Beach", "Medlemskab");
    if (dd === 3) add("own", -199, "Spotify", "Spotify P2A");
    if (dd === 9) add("own", -9, "Apple.com/bill", "iCloud+");
    if (dd === 12) add("own", -170, "Claude.ai subscription", "Abonnement");
    if (dd === 28 && ds >= "2026-08-28") add("own", -39, "Apple.com/bill", "Apple abonnement");
    if (dd === 15 && [0, 3, 6, 9].includes(d.getMonth())) add("own", -124, "Djøf forsikring", "MobilePay");
    if (dd === 10) add("shared", -Math.round((state.housingPlan.bills || 2500) * (0.9 + r() * 0.2)), "Andel Energi", "Elregning");
    if (dd === last) add("shared", -(state.housingPlan.loan || 6500), "AL andelsboliglån", "Ydelse");
    if (dd === payday) add("own", 27500, "Lønoverførsel", "Løn");
    Object.entries(EX_SHOPS).forEach(([cat, [shops, lo, hi]], k) => {
      const rr = rng(hashStr(ds + cat)), avg = (lo + hi) / 2, p = Math.min(0.9, plan(cat) * 1.05 / avg / 30.4);
      if (rr() < p) {
        let a = -(lo + rr() * (hi - lo)); const cp = shops[Math.floor(rr() * shops.length)];
        if (cat === "mobilepay" && rr() < 0.25) a = -a;          // friends paying back
        if (cat === "other" && rr() < 0.5) return;                // half of "other" stays a mystery shop
        add("own", a, cp, null, cat !== "mobilepay");
      }
    });
    if (wd === 1 && r() < 0.8) add("own", -140, "Matchi", "Squash booking", true);
    if (wd === 3 && r() < 0.7) add("own", -210, "Matchi", "Padel booking", true);
    if (ds === "2026-07-18") add("own", -1290, "Marathon Sport", "Padelketsjer", true);
    if (ds === "2026-09-12") add("own", -1850, "Norwegian", "Flybillet", true);
    if (ds === "2026-10-16") add("own", -299, "Flixbus", "Bus to Berlin", true);
    if (["2026-10-17", "2026-10-18"].includes(ds)) { add("own", -312.4, "EUR Kurs 7,46 Späti Berlin", null, true); add("own", -486.9, "EUR Kurs 7,46 Restaurant Berlin", null, true); }
  }
  const cut = ymd(addDays(today, -1));
  tx.forEach(t => { t.status = t.card && t.date >= cut ? "PDNG" : "BOOK"; });
  const opening = { own: 21000, shared: 2500 }, bal = Object.assign({}, opening);
  tx.forEach(t => { if (t.status === "BOOK") bal[t.acct] += t.amount; });
  return { tx, balances: { own: bal.own, shared: bal.shared, asof: end }, consentUntil: ymd(addDays(parseD(EX_START), 180 + 120)), example: true };
}

/* ---------- transactions ----------
   The bank reports scheduled payments (standing orders, Betalingsservice) as pending with a future date.
   Those are "upcoming": known charges ahead, never counted as spent. TX() is everything else. */
let _txSrc = null, _txDay = "", _tx = [], _up = [];
function _split() {
  const day = ymd(TODAY), all = (DATA && DATA.tx) || [];
  if (_txSrc === all && _txDay === day && _tx.length + _up.length === all.length) return;
  _txSrc = all; _txDay = day; _tx = []; _up = [];
  all.forEach(t => (t.status === "PDNG" && t.date > day ? _up : _tx).push(t));
  _up.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}
const TX = () => { _split(); return _tx; };
const UPCOMING = () => { _split(); return _up; };
/* Some banks send no counterparty name, only a text. The name shown and grouped on is whichever exists.
   Card payments arrive as "DK-NOTA<receipt> SHOP" or "Forretning: SHOP"; the label in front says nothing about the shop
   and the receipt number changes every time, so both are taken off before a text is shown, grouped or matched by a rule. */
const bare = s => String(s == null ? "" : s).replace(/^(?:DK-NOTA ?\S+|Forretning:)\s+(?=\S)/i, "").trim();
const nameOf = t => String((t && (t.cp || bare(t.text))) || "").trim();

/* ---------- state shape ---------- */
function normalise(s) {
  const b = baseState();
  Object.keys(b).forEach(k => { if (s[k] == null) s[k] = b[k]; });
  s.labels = Object.assign(b.labels, s.labels); s.savings = Object.assign(b.savings, s.savings);
  return s;
}

/* ---------- categorisation (in the app, so history files are never rewritten) ---------- */
const CAT = id => state.categories.find(c => c.id === id);
const catName = id => id ? ((CAT(id) || {}).name || id) : "Uncategorised";
const kindOf = id => { const c = CAT(id); return c ? c.kind : null; };
const SPEND_KINDS = ["variable", "protected", "fixed"];
const WEEK_KINDS = ["variable", "protected"];          // protected budgets count in the week; fixed charges don't
const merchantKey = t => nameOf(t).toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const _re = new Map();
/* \b in JavaScript only knows a-z, so "\bblå\b" would never match. Rules get a word boundary that knows æ, ø, å, ü and friends. */
const _W = "[A-Za-z0-9_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF]", _B = "(?:(?<=" + _W + ")(?!" + _W + ")|(?<!" + _W + ")(?=" + _W + "))";
const ruleSource = p => String(p).replace(/\\\\|\\b/g, m => m === "\\b" ? _B : m);
function ruleRe(p) { if (!_re.has(p)) { try { _re.set(p, new RegExp(ruleSource(p), "i")); } catch (e) { _re.set(p, null); } } return _re.get(p); }
function catOf(t) {
  if (state.overrides[t.id]) return state.overrides[t.id];
  const hay = [t.cp, bare(t.text)].filter(Boolean).join(" ");
  for (const r of state.rules) { if (r.acct && r.acct !== t.acct) continue; const re = ruleRe(r.pattern); if (re && re.test(hay)) return r.cat; }
  return null;
}
/* Spending is net within spending categories (a friend paying back on MobilePay reduces it).
   Uncategorised money out counts as everyday until you pick a category; uncategorised money in is ignored. */
function spendOf(t, kinds) {
  if (t.acct !== "own") return 0;
  const c = catOf(t);
  if (c === null) return t.amount < 0 && kinds.includes("variable") ? -t.amount : 0;
  return kinds.includes(kindOf(c)) ? -t.amount : 0;
}
const inRange = (t, a, b) => t.date >= a && t.date <= b;
const planOf = id => (CAT(id) || {}).plan || 0;
const plannedKinds = kinds => sum(state.categories.filter(c => kinds.includes(c.kind)), c => c.plan || 0);
const planTotal = () => plannedKinds(SPEND_KINDS);

/* ---------- the week, with overspending carried forward ----------
   Allowance = (everyday + protected plans) × 12 ÷ 52. Overspending carries into the
   next weeks until underspending pays it back. Underspending never builds credit:
   it stays on the lønkonto and becomes buffer. */
const weekAllowance = () => plannedKinds(WEEK_KINDS) * 12 / 52;
function weekSpend(mon) { const a = ymd(mon), b = ymd(addDays(mon, 6)); return sum(TX().filter(t => inRange(t, a, b)), t => spendOf(t, WEEK_KINDS)); }
function firstMonday() {
  const dates = TX().map(t => t.date).sort();
  const start = state.trackingStart || dates[0];
  return start ? mondayOf(parseD(start)) : mondayOf(TODAY);
}
function carryInto(mon) {
  const A = weekAllowance(); let debt = 0;
  const hist = [];
  for (let w = firstMonday(); w < mon; w = addDays(w, 7)) { const s = weekSpend(w); debt = Math.max(0, debt + s - A); hist.push({ mon: w, spent: s, debtAfter: debt }); }
  return { debt, hist };
}
function weekStatus(today) {
  const mon = mondayOf(today), sun = addDays(mon, 6), a = ymd(mon), b = ymd(sun), A = weekAllowance();
  const { debt, hist } = carryInto(mon);
  const spentByDay = Array.from({ length: 7 }, (_, i) => sum(TX().filter(t => t.date === ymd(addDays(mon, i))), t => spendOf(t, WEEK_KINDS)));
  const spent = sum(spentByDay, x => x), dayIdx = dow(today);
  return { mon, sun, a, b, allowance: A, carried: debt, spentByDay, spent, left: A - debt - spent, dayIdx,
    pace: A * (dayIdx + 1) / 7, hist,
    pending: TX().filter(t => t.status === "PDNG" && inRange(t, a, b) && t.acct === "own").length };
}

/* ---------- months, home, balances ---------- */
function monthSpend(mk, upToDay) {
  const a = mk + "-01", b = mk + "-" + pad(upToDay || daysIn(mk));
  const tx = TX().filter(t => inRange(t, a, b) && t.acct === "own");
  const by = {}; let total = 0;
  tx.forEach(t => { const v = spendOf(t, SPEND_KINDS); if (!v) return; const c = catOf(t) || "_none"; by[c] = (by[c] || 0) + v; total += v; });
  return { tx, by, total, count: tx.filter(t => spendOf(t, SPEND_KINDS) > 0).length };
}
function cumulative(mk, upToDay) {
  const out = []; let acc = 0;
  for (let d = 1; d <= upToDay; d++) { const ds = mk + "-" + pad(d); acc += sum(TX().filter(t => t.date === ds), t => spendOf(t, SPEND_KINDS)); out.push(acc); }
  return out;
}
function sharedMonth(mk) {
  const a = mk + "-01", b = mk + "-" + pad(daysIn(mk));
  const tx = TX().filter(t => t.acct === "shared" && inRange(t, a, b));
  const lines = {}; tx.forEach(t => { const c = catOf(t) || "_none"; lines[c] = (lines[c] || 0) + t.amount; });
  const moves = t => ["sharedin", "flow"].includes(kindOf(catOf(t)));      // money between the owners is not a cost of the home
  const costs = -sum(tx.filter(t => t.amount < 0 && !moves(t)), t => t.amount);
  const partner = lines.partner || 0, tenant = lines.tenant || 0;
  return { tx, lines, costs, partner, tenant, share: Math.max(0, (costs - partner - tenant) / 2) };
}
function flowsOf(mk) {
  const a = mk + "-01", b = mk + "-" + pad(daysIn(mk)), own = TX().filter(t => t.acct === "own" && inRange(t, a, b) && t.status === "BOOK");
  const k = id => sum(own.filter(t => catOf(t) === id), t => t.amount);
  return { salary: k("salary"), income: k("income") + k("giftin"), housing: -k("housing"), savings: -k("savings"), transfer: -k("transfer"),
    spending: sum(own, t => spendOf(t, SPEND_KINDS)), net: sum(own, t => t.amount) };
}
/* Lønkonto balance at the end of any day, rebuilt backwards from today's balance. */
function ownBalanceAt(ds) {
  if (!DATA.balances) return null;
  return DATA.balances.own - sum(TX().filter(t => t.acct === "own" && t.status === "BOOK" && t.date > ds), t => t.amount);
}
/* Buffer = what is left on the lønkonto the day before salary lands. */
function monthEndBuffers(n) {
  const pays = TX().filter(t => t.acct === "own" && t.amount > 0 && catOf(t) === "salary" && t.status === "BOOK").map(t => t.date).sort();
  return pays.slice(-n).map(p => ({ date: ymd(addDays(parseD(p), -1)), payday: p, value: ownBalanceAt(ymd(addDays(parseD(p), -1))) }));
}

/* ---------- recurring, ratings, ideas ---------- */
function recurring() {
  const groups = {};
  TX().filter(t => t.amount < 0 && t.status === "BOOK" && catOf(t) && kindOf(catOf(t)) !== "flow")
    .forEach(t => { const k = t.acct + "|" + merchantKey(t); (groups[k] = groups[k] || []).push(t); });
  const out = [];
  Object.values(groups).forEach(a => {
    if (a.length < 2) return;
    a.sort((x, y) => x.date < y.date ? -1 : 1);
    const amts = a.map(t => -t.amount).sort((x, y) => x - y), med = amts[Math.floor(amts.length / 2)];
    const tol = a.length >= 3 ? 0.15 : 0.02;
    if (!a.every(t => Math.abs(-t.amount - med) <= med * tol)) return;
    const gaps = a.slice(1).map((t, i) => daysBetween(parseD(a[i].date), parseD(t.date)));
    if (!gaps.every(g => g >= 25 && g <= 100)) return;
    const monthly = gaps.every(g => g <= 40), first = a[0].date, isNew = daysBetween(parseD(first), TODAY) <= 45;
    if (a.length === 2 && !isNew) return;
    out.push({ key: merchantKey(a[0]), name: nameOf(a[0]), acct: a[0].acct, amount: med, perMonth: monthly ? med : med / 3, cadence: monthly ? "monthly" : "quarterly",
      cat: catOf(a[0]), first, last: a[a.length - 1].date, isNew });
  });
  return out.sort((x, y) => y.perMonth - x.perMonth);
}
function latestRatings() { const out = {}; Object.keys(state.ratings).sort().forEach(m => Object.assign(out, state.ratings[m])); return out; }
const IDEAS = {
  kiosk: "Kiosk runs add up through frequency, not size. Two a week fits the plan; keep a snack in the bag for the rest.",
  restaurants: "Restaurants and cafés share one pot in the plan. Keep the evenings with people; trim the solo takeaway.",
  cafes: "Restaurants and cafés share one pot in the plan. A thermos on two workdays covers most of the gap.",
  mobilepay: "MobilePay to friends is mostly shared bills. Settle the regular ones less often and it gets easier to see.",
  home: "Moving-in buying is done. Put anything over 500 kr. on the wishlist first.",
  clothing: "Put clothes over 500 kr. on the wishlist first; seven days is usually enough to know.",
  media: "Look at the subscriptions you haven't marked as used. Pausing one for a month shows whether you miss it.",
  ai: "This one can go on work expenses instead.",
  groceries: "Plan two dinners a week ahead. It mostly cuts the extra trips, not the food.",
  other: "Most of this is unknown shops. Categorise them for a month to see what they really are.",
  transport: "Small already; nothing to change unless it rises.", care: "Nothing to change unless it rises.",
  events: "Nothing to change unless it rises.", insurance: "Check whether this cover overlaps your home insurance."
};
function cutCandidates() {
  const rat = latestRatings(), m0 = monthKey(TODAY), first = (TX().map(t => t.date).sort()[0] || ymd(TODAY)).slice(0, 7);
  const months = [1, 2, 3].map(i => shiftMonth(m0, -i)).filter(m => m >= first);
  const avg = {}; months.forEach(m => Object.entries(monthSpend(m).by).forEach(([c, v]) => avg[c] = (avg[c] || 0) + v / months.length));
  return state.categories.filter(c => (c.kind === "variable" || c.kind === "fixed") && rat[c.id] && rat[c.id] <= 2 && (avg[c.id] || 0) > 0)
    .map(c => ({ cat: c, spend: avg[c.id], rating: rat[c.id], score: avg[c.id] * (3 - rat[c.id]) * (avg[c.id] > (c.plan || 0) ? 1.5 : 1) }))
    .filter(x => !(state.snoozed[x.cat.id] && state.snoozed[x.cat.id] >= m0))
    .sort((a, b) => b.score - a.score);
}
function wishState(w) {
  if (w.status) return w.status;
  if (w.price < state.settings.wishlistThreshold) return "free";
  return TODAY >= addDays(parseD(w.added), state.settings.coolingDays) ? "due" : "waiting";
}
function unusual(a, b) {
  const out = [];
  TX().filter(t => inRange(t, a, b) && spendOf(t, SPEND_KINDS) > 0).forEach(t => {
    const hist = TX().filter(h => h.date < a && merchantKey(h) === merchantKey(t) && h.amount < 0).map(h => -h.amount).sort((x, y) => x - y);
    if (hist.length >= 3) { const med = hist[Math.floor(hist.length / 2)]; if (-t.amount > med * 2.5 && -t.amount > 150) out.push({ t, why: "about " + Math.round(-t.amount / med) + "× your usual there" }); }
    else if (hist.length === 0 && -t.amount >= 300) out.push({ t, why: "first time at this place" });
  });
  return out.slice(0, 5);
}
/* Scheduled payments on the given accounts in the next n days (default: own). */
function upcomingWithin(n, acct) { const to = ymd(addDays(TODAY, n)); return UPCOMING().filter(t => t.acct === (acct || "own") && t.date <= to); }
const lastCheckin = kind => state.checkins.filter(c => !kind || c.kind === kind).map(c => c.date).sort().pop() || null;

/* ---------- the Sunday card and the reports for Claude ---------- */
function sundayData() {
  const w = weekStatus(TODAY), unus = unusual(w.a, w.b), due = state.wishlist.filter(x => wishState(x) === "due"), idea = cutCandidates()[0];
  const newRec = recurring().filter(r => r.isNew && !(state.subs[r.key] && state.subs[r.key].status));
  const unc = TX().filter(t => spendOf(t, SPEND_KINDS) > 0 && catOf(t) === null && inRange(t, w.a, w.b));
  return { w, unus, due, idea, newRec, unc };
}
function isFirstSundayOfMonth(d) { return dow(d) === 6 && d.getDate() <= 7; }
const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "-";
function reportHeader(title, from) {
  return [`# ${title}`, `finance ${VERSION}, ${MODE === "example" ? "EXAMPLE DATA, not real" : "your data"}, built ${ymd(TODAY)}`,
    from ? `Covers ${from} to ${ymd(TODAY)} (since the last check-in), with earlier months for comparison.` : "First check-in: covers all data so far.", ""];
}
function weeksTable(from) {
  const L = ["Week | Mon | spent | allowance | carried after"], A = weekAllowance(), fromMon = from ? mondayOf(parseD(from)) : firstMonday();
  const { hist } = carryInto(addDays(mondayOf(TODAY), 7));
  hist.filter(h => h.mon >= fromMon).forEach(h => L.push(`${isoWeek(h.mon)} | ${ymd(h.mon)} | ${krN(h.spent)} | ${krN(A)} | ${krN(h.debtAfter)}`));
  return L;
}
function buildWeeklyReport() {
  const from = lastCheckin(), { w, unus, due, idea, newRec } = sundayData(), a = from || ymd(firstMonday());
  const L = reportHeader("Weekly check-in", from);
  L.push("## Weeks", ...weeksTable(from), "");
  L.push(`This week so far: ${krN(w.spent)} of ${krN(w.allowance)} kr., ${krN(w.carried)} carried in, ${w.pending} pending card payments.`, "");
  const soon = upcomingWithin(7);
  L.push(`Scheduled by the bank in the next 7 days: ${soon.length ? soon.length + " payments, " + krN(-sum(soon, t => t.amount)) + " kr." : "none"}.`, "");
  L.push("## Unusual", ...(unus.length ? unus.map(u => `- ${u.t.date} ${nameOf(u.t)} ${krN(-u.t.amount)} kr.: ${u.why}`) : ["- none"]), ...newRec.map(r => `- new recurring: ${r.name} ${krN(r.amount)} kr.`), "");
  const unc = TX().filter(t => t.date >= a && spendOf(t, SPEND_KINDS) > 0 && catOf(t) === null);
  L.push("## Uncategorised since last time", ...(unc.length ? unc.map(t => `- ${t.date} ${nameOf(t)} ${krN(-t.amount)} kr.`) : ["- none"]), "");
  L.push("## Wishlist due", ...(due.length ? due.map(d => `- ${d.name} ${krN(d.price)} kr.`) : ["- none"]), "");
  L.push("## Cut idea", idea ? `- ${idea.cat.name}: ${krN(idea.spend)} kr./month vs plan ${krN(idea.cat.plan || 0)}, value ${idea.rating}` : "- none");
  return L.join("\n");
}
function buildMonthlyReview() {
  const from = lastCheckin("monthly"), m0 = monthKey(TODAY), first = (TX().map(t => t.date).sort()[0] || ymd(TODAY)).slice(0, 7);
  const months = []; for (let i = 6; i >= 0; i--) { const m = shiftMonth(m0, -i); if (m >= first) months.push(m); }
  const full = months.filter(m => m !== m0), a = from || (months[0] + "-01");
  const L = reportHeader("Monthly review", from);
  L.push("Please look for: where spending drifts from plan and why, what changed since last time, what the savings trend means for the buffer target and the 5th floor, and one or two adjustments worth making (plans, rules, caps). Protected budgets (sport, cycling, travel) are kept by choice.", "");
  // categories by month
  const spends = Object.fromEntries(months.map(m => [m, monthSpend(m, m === m0 ? TODAY.getDate() : undefined)]));
  L.push(`## Spending by category (${months.map(monthName).join(", ")}${months.includes(m0) ? "; current month to day " + TODAY.getDate() : ""})`);
  L.push(["Category", "kind", "plan", ...months.map(m => m.slice(5)), `avg ${full.length} full months`, "vs plan", "value"].join(" | "));
  const rat = latestRatings();
  state.categories.filter(c => SPEND_KINDS.includes(c.kind)).forEach(c => {
    const vals = months.map(m => spends[m].by[c.id] || 0), avg = full.length ? sum(full, m => spends[m].by[c.id] || 0) / full.length : 0;
    L.push([c.name, c.kind, krN(c.plan || 0), ...vals.map(krN), krN(avg), pct(avg, c.plan || 0), rat[c.id] || "-"].join(" | "));
  });
  L.push(["Uncategorised", "-", "-", ...months.map(m => krN(spends[m].by._none || 0)), "", "", ""].join(" | "));
  L.push(["Total", "", krN(planTotal()), ...months.map(m => krN(spends[m].total)), krN(full.length ? sum(full, m => spends[m].total) / full.length : 0), pct(full.length ? sum(full, m => spends[m].total) / full.length : 0, planTotal()), ""].join(" | "), "");
  // money flow per month
  L.push("## Money in and out of the lønkonto per month");
  L.push("Month | salary | other in | spending | housing share | savings | own transfers | net change | buffer day before salary");
  const bufs = monthEndBuffers(12);
  full.forEach(m => { const f = flowsOf(m), b = bufs.find(x => x.payday.startsWith(m));
    L.push([m, krN(f.salary), krN(f.income), krN(f.spending), krN(f.housing), krN(f.savings), krN(f.transfer), krN(f.net), b ? krN(b.value) : "-"].join(" | ")); });
  L.push(`Buffer target ${krN(state.savings.bufferTarget || 0)} kr.`, "");
  // weeks
  L.push("## Weeks since last review (allowance " + krN(weekAllowance()) + " kr.)", ...weeksTable(from), "");
  // merchants
  const per = TX().filter(t => t.date >= a && spendOf(t, SPEND_KINDS) > 0);
  const byM = {}; per.forEach(t => { const k = nameOf(t); byM[k] = byM[k] || { n: 0, s: 0, c: catOf(t) }; byM[k].n++; byM[k].s += -t.amount; });
  const top = Object.entries(byM);
  L.push("## Top merchants since " + a + " (by amount)", ...top.sort((x, y) => y[1].s - x[1].s).slice(0, 12).map(([k, v]) => `- ${k} (${catName(v.c)}): ${krN(v.s)} kr. over ${v.n} purchases`), "");
  L.push("## Most frequent", ...top.sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([k, v]) => `- ${k}: ${v.n} purchases, ${krN(v.s)} kr.`), "");
  // home, recurring, subs
  L.push("## Home (shared account)", ...full.slice(-3).map(m => { const s = sharedMonth(m); return `- ${m}: costs ${krN(s.costs)}, your share ${krN(s.share)}`; }), "");
  const rec = recurring();
  L.push("## Recurring charges", ...rec.map(r => `- ${r.name} (${catName(r.cat)}): ${krN(r.amount)} kr. ${r.cadence}${r.isNew ? ", NEW" : ""}${state.subs[r.key] ? ", " + state.subs[r.key].status + (state.subs[r.key].used && state.subs[r.key].used.length ? ", last used " + state.subs[r.key].used.slice().sort().pop() : ", never marked used") : ""}`), "");
  // decisions
  const dec = state.wishlist.filter(w => w.decided && w.decided >= a);
  L.push("## Wishlist decisions since " + a, ...(dec.length ? dec.map(w => `- ${w.name} ${krN(w.price)} kr.: ${w.status}`) : ["- none"]), "");
  L.push("## Cost per use", ...(state.gear.length ? state.gear.map(g => `- ${g.name}: ${krN(g.price / Math.max(1, g.uses))} kr./use over ${g.uses} uses (fair ${krN(g.fair)})`) : ["- none"]), "");
  const ideas = cutCandidates().slice(0, 3);
  L.push("## Cut candidates (high spend, low value)", ...(ideas.length ? ideas.map(x => `- ${x.cat.name}: ${krN(x.spend)} kr./month, plan ${krN(x.cat.plan || 0)}, value ${x.rating}`) : ["- none"]), "");
  const newRules = state.rules.filter(r => r.created && r.created >= a);
  L.push("## Rules you added since " + a, ...(newRules.length ? newRules.map(r => `- ${r.pattern} -> ${catName(r.cat)}`) : ["- none"]), "");
  const nn = state.nordnet.slice().sort((x, y) => x.month < y.month ? -1 : 1);
  L.push("## Savings", ...nn.slice(-3).map(n => `- Nordnet ${n.month}: ASK ${krN(n.ask || 0)}, depot ${krN(n.depot || 0)}, ASK room left ${krN(n.askLeft || 0)}`),
    DATA.balances ? `- Today: lønkonto ${krN(DATA.balances.own)}, shared ${krN(DATA.balances.shared)}` : "- No bank balances yet",
    `- 5th floor: your fit-out share ${krN(state.savings.fitoutShare || 0)}, loan ${(state.floor5 || {}).loan || "not started"}`);
  return L.join("\n");
}

/* ---------- reading a state file ---------- */
function validateState(s) {
  if (!s || typeof s !== "object" || s.v !== 1) return "This isn't a finance state file (version 1).";
  if (!Array.isArray(s.categories) || !s.categories.some(c => SPEND_KINDS.includes(c.kind))) return "The file has no spending categories.";
  if (!Array.isArray(s.rules)) return "The file has no rules list.";
  const bad = s.rules.find(r => { try { new RegExp(r.pattern, "i"); return false; } catch (e) { return true; } });
  if (bad) return `Rule ${bad.id} has a pattern the app can't read.`;
  return null;
}
/* ---------- bank feed files -> the data the app works on ----------
   feed = { tx: [doc...], balances: [doc...], pending: doc or null, status: doc or null }, each doc as the
   feed wrote it. Public-key encryption cannot prove who wrote a file, so every row is checked and only the
   known fields are copied. */
const ACCOUNTS = ["own", "shared", "budget"];
const _DAY = /^\d{4}-\d{2}-\d{2}$/;
const validTx = t => !!t && typeof t === "object" && typeof t.id === "string" && t.id.length <= 64 && ACCOUNTS.includes(t.acct) && _DAY.test(t.date || "") &&
  Number.isFinite(t.amount) && typeof t.text === "string" && (t.status === "BOOK" || t.status === "PDNG");
const _row = t => ({ id: t.id, acct: t.acct, date: t.date, amount: t.amount, cur: typeof t.cur === "string" ? t.cur.slice(0, 3) : "", cp: typeof t.cp === "string" ? t.cp.slice(0, 200) : "", text: t.text.slice(0, 200), status: t.status });
function feedToData(feed) {
  const ids = new Set(), tx = []; let dropped = 0;
  const rows = doc => Array.isArray(doc && doc.tx) ? doc.tx : [];
  (feed.tx || []).forEach(doc => rows(doc).forEach(t => { if (!validTx(t) || t.status !== "BOOK") dropped++; else if (!ids.has(t.id)) { ids.add(t.id); tx.push(_row(t)); } }));
  rows(feed.pending).forEach(t => { if (!validTx(t) || t.status !== "PDNG") dropped++; else if (!ids.has(t.id)) { ids.add(t.id); tx.push(_row(t)); } });
  tx.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);
  const history = [];
  (feed.balances || []).forEach(doc => (Array.isArray(doc && doc.balances) ? doc.balances : []).forEach(b => {
    if (b && ACCOUNTS.includes(b.acct) && Number.isFinite(b.amount) && _DAY.test(b.date || "")) history.push({ run: String(doc.run || ""), acct: b.acct, type: String(b.type || ""), amount: b.amount, date: b.date }); else dropped++;
  }));
  /* The balance of an account is its latest booked closing balance (CLBD); another type only if the bank gives no CLBD. */
  const lastRun = history.reduce((m, b) => b.run > m ? b.run : m, ""), latest = history.filter(b => b.run === lastRun);
  const pick = acct => { const l = latest.filter(b => b.acct === acct); return (l.find(b => b.type === "CLBD") || l[0] || null); };
  const own = pick("own"), balances = own ? { own: own.amount, asof: own.date } : null;
  if (balances) ["shared", "budget"].forEach(a => { const b = pick(a); if (b) balances[a] = b.amount; });
  const st = feed.status && typeof feed.status === "object" ? feed.status : null;
  const iso = s => typeof s === "string" && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
  return { tx, balances, balanceHistory: history, consentUntil: st && iso(st.consentUntil) ? iso(st.consentUntil).slice(0, 10) : null,
    feed: st ? { ok: st.ok === true, at: iso(st.at), error: typeof st.error === "string" ? st.error.replace(/[^A-Z0-9_]/g, "").slice(0, 40) : null } : null, dropped };
}

/* ---------- merging state from two devices ----------
   base is the state as this device last saw it in the repository, local is the device's state now, remote is
   the repository's state now. A change made on one side only is kept. When both sides changed the same thing,
   lists are merged item by item (by id) and the local value wins for a single value. Something deleted on
   one side stays deleted unless the other side changed it. */
const _KEYS = { categories: "id", rules: "id", wishlist: "id", gear: "id", nordnet: "month", checkins: c => c.date + "|" + c.kind, gifts: g => g.giver + "|" + g.date + "|" + g.amount };
const _same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const _plain = x => !!x && typeof x === "object" && !Array.isArray(x);
function merge3(b, l, r, key) {
  if (_same(l, r)) return l;
  if (_same(b, l)) return r;
  if (_same(b, r)) return l;
  if (Array.isArray(l) && Array.isArray(r) && key) {
    const k = typeof key === "function" ? key : x => x && x[key], idx = list => new Map((Array.isArray(list) ? list : []).map(x => [k(x), x]));
    const B = idx(b), L = idx(l), R = idx(r), out = [];
    l.forEach(x => { const id = k(x); if (R.has(id)) out.push(merge3(B.get(id), x, R.get(id))); else if (!B.has(id) || !_same(B.get(id), x)) out.push(x); });   // gone remotely: keep only if new or changed here
    const fresh = r.filter(x => !L.has(k(x)) && !B.has(k(x)));
    const firstKnown = r.findIndex(x => L.has(k(x)) || B.has(k(x)));
    const front = fresh.filter(x => firstKnown < 0 ? false : r.indexOf(x) < firstKnown), back = fresh.filter(x => !front.includes(x));
    r.forEach(x => { const id = k(x); if (!L.has(id) && B.has(id) && !_same(B.get(id), x)) back.push(x); });                                                // gone here but changed remotely: keep
    return front.concat(out, back);
  }
  if (_plain(l) && _plain(r)) {
    const out = {}, bb = _plain(b) ? b : {};
    Array.from(new Set(Object.keys(l).concat(Object.keys(r)))).forEach(kk => { const v = merge3(bb[kk], l[kk], r[kk], _KEYS[kk]); if (v !== undefined) out[kk] = v; });
    return out;
  }
  return l === undefined ? r : l;
}
function mergeState(base, local, remote) { return merge3(base || {}, local, remote); }


/* Node: everything by name, plus live views of the context. */
if (typeof module !== "undefined" && module.exports) module.exports = Object.defineProperties({ use, catName, bare, ruleSource, ACCOUNTS, validTx, feedToData, merge3, mergeState, ASK_CEILING, CAT, DEFAULT_CATEGORIES, DOW, EXAMPLE_PLAN, EXAMPLE_RULES, EX_SHOPS, EX_START, GIFT_CAP, IDEAS, MON, MONTHS, SPEND_KINDS, TX, UPCOMING, WEEK_KINDS, addDays, baseState, buildMonthlyReview, buildWeeklyReport, carryInto, catOf, cumulative, cutCandidates, daysBetween, daysIn, dow, escRe, exampleData, exampleState, firstMonday, flowsOf, fmtDay, fmtMonth, hashStr, inRange, isFirstSundayOfMonth, isoWeek, kindOf, kr, kr2, krN, lastCheckin, latestRatings, merchantKey, mergeSeed, mondayOf, monthEndBuffers, monthKey, monthName, monthSpend, monthStart, nameOf, nf0, nf2, normalise, ownBalanceAt, pad, parseD, pct, planOf, planTotal, plannedKinds, recurring, reportHeader, rng, ruleRe, sharedMonth, shiftMonth, spendOf, sum, sundayData, unusual, upcomingWithin, validateState, weekAllowance, weekSpend, weekStatus, weeksTable, wishState, ymd }, {
  state: { get: () => state }, DATA: { get: () => DATA }, TODAY: { get: () => TODAY } });
