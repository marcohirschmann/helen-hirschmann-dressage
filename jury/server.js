// KNHS Jury Scoring server
// Zero dependencies: start with `node server.js` and open
//   http://<ip>:3000/jury  (invoer voor de jury)
//   http://<ip>:3000/tv    (weergave voor de smart tv)

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const JURY_PIN = process.env.JURY_PIN || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'wedstrijd.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- state ----------

function emptyState() {
  return {
    version: 1,
    wedstrijd: { naam: 'Dressuurwedstrijd', datum: '', locatie: '' },
    proeven: [],
    deelnemers: [],
    scores: {},
    display: { proefId: 'auto', actiefId: null, toonLive: true, rotatieSec: 12 },
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Object.assign(emptyState(), parsed);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Kon data niet lezen, start met lege wedstrijd:', e.message);
    return emptyState();
  }
}

let state = loadState();
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}

const id = () => crypto.randomBytes(6).toString('hex');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v) => (v == null ? '' : String(v).trim());

function cleanProef(p) {
  return {
    id: p.id || id(),
    naam: str(p.naam) || 'Nieuwe proef',
    rubriek: str(p.rubriek),
    aantalJury: Math.min(5, Math.max(1, Math.round(num(p.aantalJury, 1)))),
    foutAftrek: (Array.isArray(p.foutAftrek) ? p.foutAftrek : [2, 4]).map((n) => num(n)).filter((n) => n >= 0),
    onderdelen: (p.onderdelen || []).map((o) => ({
      tekst: str(o.tekst),
      coef: Math.max(1, Math.round(num(o.coef, 1))),
    })).filter((o) => o.tekst),
  };
}

function cleanDeelnemer(d) {
  return {
    id: d.id || id(),
    startnr: str(d.startnr),
    ruiter: str(d.ruiter),
    paard: str(d.paard),
    vereniging: str(d.vereniging),
    proefId: str(d.proefId),
    status: ['gepland', 'gestart', 'klaar', 'uitgesloten', 'nietGestart'].includes(d.status) ? d.status : 'gepland',
  };
}

function cleanScore(s) {
  return {
    punten: (s.punten || []).map((v) => {
      if (v === null || v === '' || v === undefined) return null;
      const n = Math.round(num(v, NaN) * 2) / 2;
      return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : null;
    }),
    fouten: Math.max(0, Math.round(num(s.fouten))),
    overigeAftrek: Math.max(0, num(s.overigeAftrek)),
    opmerking: str(s.opmerking).slice(0, 500),
    juryNaam: str(s.juryNaam).slice(0, 80),
  };
}

function applyAction(a) {
  switch (a.type) {
    case 'wedstrijd':
      state.wedstrijd = { naam: str(a.naam), datum: str(a.datum), locatie: str(a.locatie) };
      break;
    case 'proef.save': {
      const p = cleanProef(a.proef || {});
      const i = state.proeven.findIndex((x) => x.id === p.id);
      if (i >= 0) state.proeven[i] = p; else state.proeven.push(p);
      break;
    }
    case 'proef.delete':
      state.proeven = state.proeven.filter((p) => p.id !== a.id);
      break;
    case 'deelnemer.save': {
      const d = cleanDeelnemer(a.deelnemer || {});
      const i = state.deelnemers.findIndex((x) => x.id === d.id);
      if (i >= 0) state.deelnemers[i] = d; else state.deelnemers.push(d);
      break;
    }
    case 'deelnemers.import':
      (a.deelnemers || []).forEach((raw) => state.deelnemers.push(cleanDeelnemer(raw)));
      break;
    case 'deelnemer.delete':
      state.deelnemers = state.deelnemers.filter((d) => d.id !== a.id);
      delete state.scores[a.id];
      if (state.display.actiefId === a.id) state.display.actiefId = null;
      break;
    case 'deelnemer.status': {
      const d = state.deelnemers.find((x) => x.id === a.id);
      if (!d) throw new Error('Deelnemer niet gevonden');
      d.status = cleanDeelnemer({ status: a.status }).status;
      break;
    }
    case 'score': {
      if (!state.deelnemers.some((d) => d.id === a.deelnemerId)) throw new Error('Deelnemer niet gevonden');
      const jury = String(Math.max(1, Math.round(num(a.jury, 1))));
      state.scores[a.deelnemerId] = state.scores[a.deelnemerId] || {};
      state.scores[a.deelnemerId][jury] = cleanScore(a.score || {});
      break;
    }
    case 'score.reset':
      delete state.scores[a.deelnemerId];
      break;
    case 'display':
      state.display = {
        proefId: str(a.proefId) || 'auto',
        actiefId: a.actiefId || null,
        toonLive: a.toonLive !== false,
        rotatieSec: Math.min(120, Math.max(5, Math.round(num(a.rotatieSec, 12)))),
      };
      break;
    case 'import': {
      const next = Object.assign(emptyState(), a.data || {});
      next.proeven = (next.proeven || []).map(cleanProef);
      next.deelnemers = (next.deelnemers || []).map(cleanDeelnemer);
      state = next;
      break;
    }
    case 'reset':
      state = emptyState();
      break;
    default:
      throw new Error('Onbekende actie: ' + a.type);
  }
  state.version += 1;
  persist();
  broadcast();
}

// ---------- live updates (Server Sent Events) ----------

const clients = new Set();

function broadcast() {
  const msg = 'data: ' + JSON.stringify({ version: state.version }) + '\n\n';
  for (const res of clients) res.write(msg);
}

setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const ROUTES = { '/': '/index.html', '/jury': '/jury.html', '/tv': '/tv.html' };

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) { reject(new Error('Te groot')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Ongeldige JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/state' && req.method === 'GET') {
    const since = Number(url.searchParams.get('v'));
    if (since && since === state.version) return sendJson(res, 200, { version: state.version, unchanged: true });
    return sendJson(res, 200, state);
  }

  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n');
    res.write('data: ' + JSON.stringify({ version: state.version }) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/auth' && req.method === 'GET') {
    return sendJson(res, 200, { pinNodig: !!JURY_PIN, ok: !JURY_PIN || req.headers['x-jury-pin'] === JURY_PIN });
  }

  if (p === '/api/action' && req.method === 'POST') {
    if (JURY_PIN && req.headers['x-jury-pin'] !== JURY_PIN) return sendJson(res, 401, { error: 'Onjuiste pincode' });
    try {
      const body = await readBody(req);
      applyAction(body);
      return sendJson(res, 200, { ok: true, version: state.version });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Methode niet toegestaan' });

  const file = path.normalize(path.join(PUBLIC_DIR, ROUTES[p] || p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Niet gevonden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  }
  const hosts = ips.length ? ips : ['localhost'];
  console.log('\nKNHS Jury Scoring draait.\n');
  hosts.forEach((ip) => {
    console.log('  Jury invoer : http://' + ip + ':' + PORT + '/jury');
    console.log('  Smart tv    : http://' + ip + ':' + PORT + '/tv\n');
  });
  console.log(JURY_PIN ? '  Pincode voor jury is ingesteld.\n' : '  Geen pincode ingesteld (zet JURY_PIN om te beveiligen).\n');
  console.log('  Data wordt opgeslagen in ' + DATA_FILE + '\n');
});

process.on('SIGINT', () => {
  clearTimeout(saveTimer);
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  process.exit(0);
});
