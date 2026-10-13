// LibSeat backend: zero dependencies, plain Node.js. Run: node server.js
process.env.TZ = 'Asia/Kolkata';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const DB = path.join(__dirname, 'data.json'), PORT = process.env.PORT || 3000;
const SLOTS = ['08:00','10:00','12:00','14:00','16:00'], FLOORS = [1,2,3], SEATS = 30, GRACE = 15;
let db = { users: [], sessions: {}, bookings: [], sus: {}, blocked: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB))); } catch (e) {}
const save = () => fs.writeFileSync(DB, JSON.stringify(db, null, 1));
const ymd = d => d.toLocaleDateString('en-CA');
const start = (d, s) => new Date(d + 'T' + s + ':00').getTime();
const isPast = (d, s) => Date.now() > start(d, s) + GRACE * 6e4;
const active = b => b.status === 'booked' || b.status === 'checked_in';
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const pub = u => ({ id: u.id, name: u.name, roll: u.roll, email: u.email, role: u.role || 'student', prefs: u.prefs || {} });
const blocked = (f, n) => db.blocked.some(x => x.floor === f && x.seat === n);
// The admin is a fixed account, never created through signup. Everyone else is a student.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@libseat.com').toLowerCase();
db.users.forEach(u => { u.role = u.email === ADMIN_EMAIL ? 'admin' : 'student'; });
if (!db.users.some(u => u.email === ADMIN_EMAIL)) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.users.push({ id: crypto.randomBytes(6).toString('hex'), name: 'Library Admin', roll: 'ADMIN', email: ADMIN_EMAIL, role: 'admin', prefs: {}, salt, pw: hash(process.env.ADMIN_PASSWORD || 'Admin@12345', salt), createdAt: new Date().toISOString() });
}
save();
const userOf = req => { const s = db.sessions[(req.headers.authorization || '').slice(7)]; return s && s.exp > Date.now() ? db.users.find(u => u.id === s.uid) || null : null; };
function sweep() {
  const n = Date.now();
  db.bookings.forEach(b => {
    const t = start(b.date, b.slot);
    if (b.status === 'booked' && n > t + GRACE * 6e4) b.status = 'expired';
    else if (b.status === 'checked_in' && n > t + 120 * 6e4) b.status = 'done';
  });
  Object.keys(db.sessions).forEach(k => { if (db.sessions[k].exp < n) delete db.sessions[k]; });
}
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch (e) { r({}); } }); });
function session(u) { const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = { uid: u.id, exp: Date.now() + 7 * 864e5 }; return t; }
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams, M = req.method;
  if (M === 'GET' && p === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  if (!p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  sweep();
  if (M === 'GET' && p === '/api/seats') {
    const date = q.get('date') || ymd(new Date()), floor = +q.get('floor') || 1;
    const slots = SLOTS.map(t => ({ t, past: isPast(date, t) }));
    const slot = SLOTS.includes(q.get('slot')) ? q.get('slot') : (slots.find(s => !s.past) || slots[0]).t;
    const seats = Array.from({ length: SEATS }, (_, i) => { const n = i + 1;
      return { n, outlet: n % 2 === 0, quiet: n <= 12, taken: blocked(floor, n) || db.bookings.some(b => active(b) && b.floor === floor && b.seat === n && b.date === date && b.slot === slot) }; });
    return send(res, 200, { date, floor, slot, slots, seats });
  }
  if (M === 'POST' && p === '/api/signup') {
    const b = await body(req), name = String(b.name || '').trim(), roll = String(b.roll || '').trim().toUpperCase(), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (name.length < 2 || name.length > 40) return send(res, 400, { error: 'Enter your full name (2 to 40 characters).' });
    if (!/^[A-Z0-9]{4,15}$/.test(roll)) return send(res, 400, { error: 'Enter a valid roll number (letters and digits only).' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (pw.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    if (db.users.some(x => x.roll === roll || x.email === email)) return send(res, 409, { error: 'An account with this roll number or email already exists. Try logging in.' });
    const salt = crypto.randomBytes(16).toString('hex'), nu = { id: crypto.randomBytes(6).toString('hex'), name, roll, email, role: 'student', prefs: {}, salt, pw: hash(pw, salt), createdAt: new Date().toISOString() };
    db.users.push(nu); const token = session(nu); save(); return send(res, 201, { token, user: pub(nu) });
  }
  if (M === 'POST' && p === '/api/login') {
    const b = await body(req), id = String(b.id || '').trim(), pw = String(b.password || ''), us = db.users.find(x => x.roll === id.toUpperCase() || x.email === id.toLowerCase());
    if (!us || !crypto.timingSafeEqual(Buffer.from(hash(pw, us.salt), 'hex'), Buffer.from(us.pw, 'hex'))) return send(res, 401, { error: 'Roll number/email or password is incorrect.' });
    const token = session(us); save(); return send(res, 200, { token, user: pub(us) });
  }
  const me = userOf(req);
  if (!me) return send(res, 401, { error: 'Please log in to continue.' });
  if (M === 'GET' && p === '/api/me') return send(res, 200, pub(me));
  if (M === 'POST' && p === '/api/logout') { delete db.sessions[(req.headers.authorization || '').slice(7)]; save(); return send(res, 200, { ok: true }); }
  const mine = () => db.bookings.filter(b => b.uid === me.id).sort((a, b) => start(b.date, b.slot) - start(a.date, a.slot));
  if (M === 'GET' && p === '/api/bookings') return send(res, 200, mine());
  if (M === 'GET' && p === '/api/dashboard') {
    const m = mine(), c = s => m.filter(b => b.status === s).length, today = ymd(new Date());
    let date = today, slot = SLOTS.find(s => !isPast(today, s)); if (!slot) { date = ymd(new Date(Date.now() + 864e5)); slot = SLOTS[0]; }
    const done = c('checked_in') + c('done');
    return send(res, 200, { date, slot, counts: { total: m.length, cancelled: c('cancelled'), missed: c('expired') }, hours: done * 2,
      upcoming: m.filter(active).sort((a, b) => start(a.date, a.slot) - start(b.date, b.slot))[0] || null, recent: m.slice(0, 5),
      floors: FLOORS.map(f => ({ floor: f, total: SEATS, taken: db.bookings.filter(b => active(b) && b.floor === f && b.date === date && b.slot === slot).length })) });
  }
  if (M === 'POST' && p === '/api/bookings') {
    const b = await body(req), today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
    if (![today, tomorrow].includes(b.date)) return send(res, 400, { error: 'You can book for today or tomorrow only.' });
    if (!SLOTS.includes(b.slot) || !FLOORS.includes(b.floor) || !(b.seat >= 1 && b.seat <= SEATS)) return send(res, 400, { error: 'Choose a valid floor, seat and time.' });
    if (isPast(b.date, b.slot)) return send(res, 400, { error: 'That time slot has already passed. Pick a later slot.' });
    if (blocked(b.floor, b.seat)) return send(res, 400, { error: 'That seat is closed for maintenance. Pick another one.' });
    if (db.bookings.some(x => active(x) && x.uid === me.id && x.date === b.date && x.slot === b.slot)) return send(res, 409, { error: 'You already have a seat booked for this slot.' });
    if (db.bookings.some(x => active(x) && x.floor === b.floor && x.seat === b.seat && x.date === b.date && x.slot === b.slot)) return send(res, 409, { error: 'Someone just took that seat. Please pick another one.' });
    const nb = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), uid: me.id, name: me.name, roll: me.roll, floor: b.floor, seat: b.seat, date: b.date, slot: b.slot, status: 'booked', createdAt: new Date().toISOString() };
    db.bookings.push(nb); save(); return send(res, 201, nb);
  }
  const m = p.match(/^\/api\/bookings\/([a-z0-9]+)\/(checkin|cancel)$/);
  if (M === 'POST' && m) {
    const bk = db.bookings.find(x => x.id === m[1] && x.uid === me.id);
    if (!bk) return send(res, 404, { error: 'Booking not found.' });
    if (bk.status !== 'booked') return send(res, 400, { error: 'This booking is already ' + bk.status.replace('_', ' ') + '.' });
    if (m[2] === 'checkin') { if (Date.now() < start(bk.date, bk.slot) - GRACE * 6e4) return send(res, 400, { error: 'Check-in opens 15 minutes before your slot.' }); bk.status = 'checked_in'; }
    else { bk.status = 'cancelled'; bk.cancelledAt = Date.now(); }
    save(); return send(res, 200, bk);
  }
  if (M === 'POST' && p === '/api/prefs') { const b = await body(req); me.prefs = { size: ['m', 'l', 'xl'].includes(b.size) ? b.size : 'm', contrast: !!b.contrast, motion: !!b.motion }; save(); return send(res, 200, pub(me)); }
  if (M === 'POST' && p === '/api/profile') { const b = await body(req), name = String(b.name || '').trim(); if (name.length < 2 || name.length > 40) return send(res, 400, { error: 'Enter your full name (2 to 40 characters).' }); me.name = name; save(); return send(res, 200, pub(me)); }
  if (M === 'POST' && p === '/api/password') {
    const b = await body(req), np = String(b.next || '');
    if (!crypto.timingSafeEqual(Buffer.from(hash(String(b.current || ''), me.salt), 'hex'), Buffer.from(me.pw, 'hex'))) return send(res, 400, { error: 'Current password is incorrect.' });
    if (np.length < 8) return send(res, 400, { error: 'New password must be at least 8 characters.' });
    me.salt = crypto.randomBytes(16).toString('hex'); me.pw = hash(np, me.salt); save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/sus' && M === 'GET') return send(res, 200, db.sus[me.id] || null);
  if (p === '/api/sus' && M === 'POST') {
    const b = await body(req), a = b.answers;
    if (!Array.isArray(a) || a.length !== 10 || a.some(x => !Number.isInteger(x) || x < 1 || x > 5)) return send(res, 400, { error: 'Please answer all 10 statements.' });
    const score = a.reduce((t, x, i) => t + (i % 2 === 0 ? x - 1 : 5 - x), 0) * 2.5;
    db.sus[me.id] = { score, answers: a, comment: String(b.comment || '').slice(0, 500), at: new Date().toISOString() }; save(); return send(res, 200, db.sus[me.id]);
  }
  const m2 = p.match(/^\/api\/bookings\/([a-z0-9]+)\/(undo|extend)$/);
  if (M === 'POST' && m2) {
    const bk = db.bookings.find(x => x.id === m2[1] && x.uid === me.id);
    if (!bk) return send(res, 404, { error: 'Booking not found.' });
    const clash = (slot) => blocked(bk.floor, bk.seat) || db.bookings.some(x => x !== bk && active(x) && x.date === bk.date && x.slot === slot && (x.uid === me.id || (x.floor === bk.floor && x.seat === bk.seat)));
    if (m2[2] === 'undo') {
      if (bk.status !== 'cancelled' || Date.now() - (bk.cancelledAt || 0) > 15000) return send(res, 400, { error: 'Undo is only available for a few seconds after cancelling.' });
      if (clash(bk.slot)) return send(res, 409, { error: 'That seat was taken in the meantime, so the booking cannot be restored.' });
      bk.status = 'booked'; delete bk.cancelledAt; save(); return send(res, 200, bk);
    }
    if (!active(bk)) return send(res, 400, { error: 'Only active bookings can be extended.' });
    const next = SLOTS[SLOTS.indexOf(bk.slot) + 1];
    if (!next || isPast(bk.date, next)) return send(res, 400, { error: 'There is no later slot to extend into on that day.' });
    if (clash(next)) return send(res, 409, { error: 'The seat is not free in the next slot, or you already have a booking then.' });
    const nb = Object.assign({}, bk, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), slot: next, status: 'booked', createdAt: new Date().toISOString() }); delete nb.cancelledAt;
    db.bookings.push(nb); save(); return send(res, 201, nb);
  }
  if (p.startsWith('/api/admin/')) {
    if (me.role !== 'admin') return send(res, 403, { error: 'Admin access only.' });
    if (M === 'GET' && p === '/api/admin/stats') {
      const live = db.bookings.filter(b => b.status !== 'cancelled'), today = ymd(new Date());
      let date = today, slot = SLOTS.find(s => !isPast(today, s)); if (!slot) { date = ymd(new Date(Date.now() + 864e5)); slot = SLOTS[0]; }
      const days = [-5, -4, -3, -2, -1, 0, 1].map(o => { const d = ymd(new Date(Date.now() + o * 864e5)); return { d, n: live.filter(b => b.date === d).length }; });
      const sc = Object.values(db.sus).map(x => x.score);
      return send(res, 200, { users: db.users.length, total: db.bookings.length, date, slot, days, slots: SLOTS.map(t => ({ t, n: live.filter(b => b.slot === t).length })),
        floors: FLOORS.map(f => ({ floor: f, total: SEATS, taken: db.bookings.filter(b => active(b) && b.floor === f && b.date === date && b.slot === slot).length })),
        sus: { n: sc.length, avg: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length * 10) / 10 : 0 }, blocked: db.blocked,
        recent: db.bookings.slice(-15).reverse().map(b => ({ name: b.name, roll: b.roll, floor: b.floor, seat: b.seat, date: b.date, slot: b.slot, status: b.status })) });
    }
    if (M === 'POST' && (p === '/api/admin/block' || p === '/api/admin/unblock')) {
      const b = await body(req); if (!FLOORS.includes(b.floor) || !(b.seat >= 1 && b.seat <= SEATS)) return send(res, 400, { error: 'Enter a floor (1 to 3) and a seat (1 to 30).' });
      db.blocked = db.blocked.filter(x => !(x.floor === b.floor && x.seat === b.seat));
      if (p === '/api/admin/block') { db.blocked.push({ floor: b.floor, seat: b.seat }); db.bookings.forEach(x => { if (active(x) && x.floor === b.floor && x.seat === b.seat && !isPast(x.date, x.slot)) x.status = 'cancelled'; }); }
      save(); return send(res, 200, { blocked: db.blocked });
    }
  }
  send(res, 404, { error: 'Not found' });
}).listen(PORT, () => console.log('LibSeat running at http://localhost:' + PORT));
