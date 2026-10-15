'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = KNHS.fmt;

let state = null;
let pin = localStorage.getItem('juryPin') || '';
const keuze = {
  proefId: localStorage.getItem('juryProef') || '',
  deelnemerId: null,
  jury: localStorage.getItem('juryPositie') || '1',
};
let concept = null;       // score die nu bewerkt wordt
let opslaanTimer = null;
let wachtOpOpslaan = false;

// ---------- server ----------

async function laad() {
  const res = await fetch('/api/state', { cache: 'no-store' });
  state = await res.json();
  renderAlles();
}

async function actie(body) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jury-Pin': pin },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { toonPin(); throw new Error('Pincode nodig'); }
  if (!res.ok) { melding(data.error || 'Er ging iets mis'); throw new Error(data.error); }
  return data;
}

function luister() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const { version } = JSON.parse(e.data);
    if (!state || version !== state.version) laad();
  };
}

function melding(tekst) {
  const m = $('melding');
  m.textContent = tekst;
  m.style.display = 'block';
  clearTimeout(melding.t);
  melding.t = setTimeout(() => { m.style.display = 'none'; }, 2500);
}

async function controleerPin() {
  const res = await fetch('/api/auth', { headers: { 'X-Jury-Pin': pin } });
  const data = await res.json();
  if (data.pinNodig && !data.ok) toonPin();
}

function toonPin() {
  $('pinScherm').style.display = 'block';
  document.querySelectorAll('.paneel').forEach((p) => { p.style.visibility = 'hidden'; });
  $('pinInvoer').focus();
}

$('pinOk').onclick = async () => {
  pin = $('pinInvoer').value.trim();
  localStorage.setItem('juryPin', pin);
  const data = await (await fetch('/api/auth', { headers: { 'X-Jury-Pin': pin } })).json();
  if (!data.ok) return melding('Onjuiste pincode');
  $('pinScherm').style.display = 'none';
  document.querySelectorAll('.paneel').forEach((p) => { p.style.visibility = ''; });
};
$('pinInvoer').onkeydown = (e) => { if (e.key === 'Enter') $('pinOk').click(); };

// ---------- tabs ----------

$('tabs').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.paneel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.tab));
};

// ---------- helpers ----------

const proefNaam = (id) => (KNHS.vindProef(state, id) || {}).naam || 'Geen proef';
const deelnemer = (id) => state.deelnemers.find((d) => d.id === id);
const startNrSort = (a, b) => (parseFloat(a.startnr) || 1e9) - (parseFloat(b.startnr) || 1e9) || a.ruiter.localeCompare(b.ruiter);

function proefOpties(sel, waarde, extra) {
  sel.innerHTML = (extra || '') + state.proeven.map((p) => `<option value="${p.id}">${esc(p.naam)}</option>`).join('');
  if (waarde && [...sel.options].some((o) => o.value === waarde)) sel.value = waarde;
}

function renderAlles() {
  $('hWedstrijd').textContent = [state.wedstrijd.naam, state.wedstrijd.datum, state.wedstrijd.locatie].filter(Boolean).join(' · ') || 'KNHS dressuur';
  renderScoren();
  renderUitslag();
  renderStartlijst();
  renderProeven();
  renderInstellingen();
}

// ---------- scoren ----------

function renderScoren() {
  if (!state.proeven.length) {
    $('sProef').innerHTML = '';
    $('sLijst').innerHTML = '<div class="leeg">Maak eerst een proef aan bij Proeven</div>';
    $('sForm').innerHTML = '<div class="leeg">Nog geen proeven</div>';
    return;
  }
  if (!KNHS.vindProef(state, keuze.proefId)) keuze.proefId = state.proeven[0].id;
  proefOpties($('sProef'), keuze.proefId);

  const lijst = state.deelnemers.filter((d) => d.proefId === keuze.proefId).sort(startNrSort);
  const actief = state.display.actiefId;
  $('sLijst').innerHTML = lijst.length ? lijst.map((d) => {
    const r = KNHS.resultaat(state, d);
    const status = r.uitgesloten ? 'uitgesloten' : r.compleet ? 'klaar' : r.gestart ? 'gestart' : d.status;
    return `<div class="ditem ${d.id === keuze.deelnemerId ? 'on' : ''}" data-id="${d.id}">
      <span class="nr">${esc(d.startnr)}</span>
      <span class="naam">${esc(d.ruiter)}<br><small>${esc(d.paard)}</small></span>
      ${d.id === actief ? '<span class="tvlabel">TV</span>' : ''}
      ${r.compleet ? `<small>${fmt(r.perc, 2)}%</small>` : ''}
      <span class="stip ${status}"></span></div>`;
  }).join('') : '<div class="leeg">Geen deelnemers in deze proef</div>';

  if (keuze.deelnemerId && !deelnemer(keuze.deelnemerId)) keuze.deelnemerId = null;
  renderScoreForm(false);
}

$('sProef').onchange = (e) => {
  keuze.proefId = e.target.value;
  localStorage.setItem('juryProef', keuze.proefId);
  keuze.deelnemerId = null;
  concept = null;
  renderScoren();
};

$('sLijst').onclick = (e) => {
  const item = e.target.closest('.ditem');
  if (!item) return;
  flushOpslaan();
  keuze.deelnemerId = item.dataset.id;
  concept = null;
  renderScoren();
};

function bestaandeScore() {
  const sc = (state.scores[keuze.deelnemerId] || {})[keuze.jury];
  return sc ? JSON.parse(JSON.stringify(sc)) : { punten: [], fouten: 0, overigeAftrek: 0, opmerking: '', juryNaam: localStorage.getItem('juryNaam') || '' };
}

// volledig: ook de invoervelden opnieuw opbouwen
function renderScoreForm(volledig) {
  const d = keuze.deelnemerId && deelnemer(keuze.deelnemerId);
  if (!d) { $('sForm').innerHTML = '<div class="leeg">Kies een deelnemer</div>'; concept = null; return; }
  const proef = KNHS.vindProef(state, d.proefId);
  if (Number(keuze.jury) > proef.aantalJury) keuze.jury = '1';

  // Een update van een ander apparaat niet over lopende invoer heen schrijven.
  const bezig = !volledig && concept && $('sForm').querySelector('.onderdelen') &&
    (wachtOpOpslaan || ($('sForm').contains(document.activeElement) && document.activeElement.tagName === 'INPUT'));
  if (bezig) { updateTotalen(); return; }
  concept = bestaandeScore();

  const isTv = state.display.actiefId === d.id;
  const juryKnoppen = proef.aantalJury > 1
    ? `<div><label>Jurylid</label><div class="juryknop">${Array.from({ length: proef.aantalJury }, (_, i) =>
        `<button data-jury="${i + 1}" class="${String(i + 1) === keuze.jury ? 'on' : ''}">${i + 1}</button>`).join('')}</div></div>`
    : '';

  $('sForm').innerHTML = `
    <div class="kop">
      <div>
        <div class="ruiter">${esc(d.startnr)}. ${esc(d.ruiter)}</div>
        <div class="paard">${esc(d.paard)}${d.vereniging ? ' · ' + esc(d.vereniging) : ''} · ${esc(proef.naam)}</div>
      </div>
      ${juryKnoppen}
    </div>
    <div class="knoppen">
      <button class="knop ${isTv ? 'licht' : 'goud'}" id="fTv">${isTv ? 'Staat op tv' : 'Zet op tv als in de baan'}</button>
      <span class="opgeslagen" id="fStatus"></span>
    </div>
    <table class="onderdelen" style="margin-top:12px">
      <thead><tr><th>#</th><th>Onderdeel</th><th class="noprint"></th><th class="c">Punt</th><th class="r">Totaal</th></tr></thead>
      <tbody>${proef.onderdelen.map((o, i) => {
        const v = concept.punten[i];
        return `<tr>
          <td>${i + 1}</td>
          <td class="tekst">${esc(o.tekst)} ${o.coef > 1 ? `<span class="coef">x${o.coef}</span>` : ''}</td>
          <td><div class="snel" data-i="${i}">${[4, 5, 6, 7, 8, 9].map((n) => `<button tabindex="-1" data-v="${n}">${n}</button>`).join('')}</div></td>
          <td class="c"><input data-i="${i}" inputmode="decimal" autocomplete="off" value="${v == null ? '' : fmt(v, v % 1 ? 1 : 0)}"></td>
          <td class="r" id="lt${i}"></td></tr>`;
      }).join('')}</tbody>
    </table>
    <div class="rij" style="margin-top:16px">
      <div><label>Fouten in het parcours</label>
        <div class="teller"><button id="fMin">&minus;</button><b id="fFouten">${concept.fouten}</b><button id="fPlus">+</button></div></div>
      <div><label>Overige aftrek (punten)</label><input id="fOverig" inputmode="decimal" value="${concept.overigeAftrek || ''}"></div>
      <div><label>Naam jurylid</label><input id="fJuryNaam" value="${esc(concept.juryNaam)}"></div>
    </div>
    <label>Opmerking</label><input id="fOpmerking" value="${esc(concept.opmerking)}">
    <div class="totaal" id="fTotaal"></div>
    <div class="knoppen">
      <button class="knop groen" id="fKlaar">Afronden</button>
      <button class="knop licht" id="fNg">Niet gestart</button>
      <button class="knop rood" id="fU">Uitsluiten</button>
      <button class="knop licht" id="fWis">Score wissen</button>
    </div>`;
  koppelForm(d, proef);
  updateTotalen();
}

function parsePunt(tekst) {
  const t = String(tekst).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 10 || Math.round(n * 2) !== n * 2) return undefined;
  return n;
}

function koppelForm(d, proef) {
  const form = $('sForm');
  const inputs = [...form.querySelectorAll('.onderdelen input')];

  inputs.forEach((inp, idx) => {
    inp.oninput = () => {
      const v = parsePunt(inp.value);
      inp.classList.toggle('fout', v === undefined);
      if (v === undefined) return;
      concept.punten[idx] = v;
      planOpslaan();
      updateTotalen();
    };
    inp.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); (inputs[idx + 1] || inp).focus(); inputs[idx + 1]?.select(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (inputs[idx - 1] || inp).focus(); inputs[idx - 1]?.select(); }
    };
    inp.onfocus = () => inp.select();
  });

  form.querySelectorAll('.snel').forEach((s) => {
    s.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = Number(s.dataset.i);
      const huidig = concept.punten[i];
      const n = Number(b.dataset.v);
      // nogmaals tikken op hetzelfde cijfer maakt er een halve punt van
      const v = huidig === n ? n + 0.5 : n;
      concept.punten[i] = v;
      inputs[i].value = fmt(v, v % 1 ? 1 : 0);
      inputs[i].classList.remove('fout');
      planOpslaan();
      updateTotalen();
    };
  });

  form.querySelectorAll('.juryknop button').forEach((b) => {
    b.onclick = () => {
      flushOpslaan();
      keuze.jury = b.dataset.jury;
      localStorage.setItem('juryPositie', keuze.jury);
      concept = null;
      renderScoreForm(true);
    };
  });

  $('fMin').onclick = () => { concept.fouten = Math.max(0, concept.fouten - 1); $('fFouten').textContent = concept.fouten; planOpslaan(); updateTotalen(); };
  $('fPlus').onclick = () => { concept.fouten += 1; $('fFouten').textContent = concept.fouten; planOpslaan(); updateTotalen(); };
  $('fOverig').oninput = (e) => { concept.overigeAftrek = Math.max(0, Number(e.target.value.replace(',', '.')) || 0); planOpslaan(); updateTotalen(); };
  $('fOpmerking').oninput = (e) => { concept.opmerking = e.target.value; planOpslaan(); };
  $('fJuryNaam').oninput = (e) => { concept.juryNaam = e.target.value; localStorage.setItem('juryNaam', e.target.value); planOpslaan(); };

  $('fTv').onclick = async () => {
    await actie({ type: 'display', ...state.display, actiefId: d.id });
    if (d.status === 'gepland') await actie({ type: 'deelnemer.status', id: d.id, status: 'gestart' });
    melding('Staat nu op de tv');
  };
  $('fKlaar').onclick = async () => {
    await flushOpslaan();
    const r = KNHS.juryResultaat(proef, concept);
    if (!r.compleet && !confirm('Niet alle onderdelen hebben een punt. Toch afronden?')) return;
    await actie({ type: 'deelnemer.status', id: d.id, status: 'klaar' });
    melding('Afgerond');
  };
  $('fNg').onclick = async () => { await actie({ type: 'deelnemer.status', id: d.id, status: 'nietGestart' }); };
  $('fU').onclick = async () => {
    if (!confirm(`${d.ruiter} uitsluiten?`)) return;
    await actie({ type: 'deelnemer.status', id: d.id, status: 'uitgesloten' });
  };
  $('fWis').onclick = async () => {
    if (!confirm('Alle punten van alle juryleden voor deze deelnemer wissen?')) return;
    clearTimeout(opslaanTimer);
    wachtOpOpslaan = false;
    await actie({ type: 'score.reset', deelnemerId: d.id });
    await actie({ type: 'deelnemer.status', id: d.id, status: 'gepland' });
    concept = null;
    renderScoreForm(true);
  };
}

function updateTotalen() {
  const d = deelnemer(keuze.deelnemerId);
  if (!d || !concept) return;
  const proef = KNHS.vindProef(state, d.proefId);
  proef.onderdelen.forEach((o, i) => {
    const v = concept.punten[i];
    const cel = $('lt' + i);
    if (cel) cel.textContent = v == null ? '' : fmt(v * o.coef, v % 1 ? 1 : 0);
    const snel = $('sForm').querySelector(`.snel[data-i="${i}"]`);
    snel?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Math.floor(v) === Number(b.dataset.v) && v != null));
  });
  const r = KNHS.juryResultaat(proef, concept);
  const max = KNHS.maxPunten(proef);
  // Combineer met de andere juryleden voor het eindcijfer
  const kopie = { ...state, scores: { ...state.scores, [d.id]: { ...(state.scores[d.id] || {}), [keuze.jury]: concept } } };
  const tot = KNHS.resultaat(kopie, d);
  $('fTotaal').innerHTML = `
    <div><span>Ingevuld</span><b>${r.ingevuld} / ${proef.onderdelen.length}</b></div>
    <div><span>Bruto</span><b>${fmt(r.bruto, 1)}</b></div>
    <div><span>Aftrek</span><b>${fmt(r.aftrek, 1)}</b></div>
    <div><span>Netto (max ${max})</span><b>${fmt(r.netto, 1)}</b></div>
    <div class="groot"><span>Percentage</span><b>${r.uitgesloten ? 'Uitgesloten' : fmt(r.compleet ? r.perc : r.livePerc, 3) + '%'}</b></div>
    ${proef.aantalJury > 1 ? `<div class="groot"><span>Gemiddeld alle jury</span><b>${tot.compleet ? fmt(tot.perc, 3) + '%' : 'volgt'}</b></div>` : ''}`;
}

function zetStatus(tekst, cls) {
  const s = $('fStatus');
  if (s) { s.textContent = tekst; s.className = 'opgeslagen ' + (cls || ''); }
}

function planOpslaan() {
  wachtOpOpslaan = true;
  zetStatus('Opslaan', 'bezig');
  clearTimeout(opslaanTimer);
  opslaanTimer = setTimeout(flushOpslaan, 400);
}

async function flushOpslaan() {
  clearTimeout(opslaanTimer);
  if (!wachtOpOpslaan || !concept || !keuze.deelnemerId) return;
  wachtOpOpslaan = false;
  try {
    await actie({ type: 'score', deelnemerId: keuze.deelnemerId, jury: keuze.jury, score: concept });
    zetStatus('Opgeslagen');
  } catch (e) {
    wachtOpOpslaan = true;
    zetStatus('Niet opgeslagen, opnieuw proberen', 'fout');
    opslaanTimer = setTimeout(flushOpslaan, 2000);
  }
}

// ---------- uitslag ----------

function renderUitslag() {
  const html = state.proeven.map((p) => {
    const rijen = KNHS.klassement(state, p.id);
    if (!rijen.length) return '';
    const multi = p.aantalJury > 1;
    return `<div class="kaart"><h2>${esc(p.naam)}</h2>${p.rubriek ? `<p class="hint">${esc(p.rubriek)}</p>` : ''}
      <table><thead><tr><th>Pl</th><th>Nr</th><th>Ruiter</th><th>Paard</th><th>Vereniging</th>
      ${multi ? Array.from({ length: p.aantalJury }, (_, i) => `<th class="r">Jury ${i + 1}</th>`).join('') : ''}
      <th class="r">Punten</th><th class="r">%</th></tr></thead><tbody>
      ${rijen.map((x) => `<tr><td><b>${x.plaats || ''}</b></td><td>${esc(x.d.startnr)}</td><td>${esc(x.d.ruiter)}</td>
        <td>${esc(x.d.paard)}</td><td>${esc(x.d.vereniging)}</td>
        ${multi ? x.r.perJury.map((j) => `<td class="r">${j.compleet ? fmt(j.perc, 3) : ''}</td>`).join('') : ''}
        <td class="r">${x.r.gestart ? fmt(x.r.totaal, 1) : ''}</td>
        <td class="r"><b>${x.r.compleet ? fmt(x.r.perc, 3) : statusLabel(x)}</b></td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');
  $('uitslagen').innerHTML = html || '<div class="kaart leeg">Nog geen uitslagen</div>';
}

function statusLabel(x) {
  if (x.r.uitgesloten) return 'U';
  if (x.d.status === 'nietGestart') return 'NG';
  if (x.r.gestart) return 'bezig';
  return '';
}

$('csvExport').onclick = () => {
  const regels = [['Proef', 'Plaats', 'Startnummer', 'Ruiter', 'Paard', 'Vereniging', 'Punten', 'Percentage', 'Status']];
  state.proeven.forEach((p) => KNHS.klassement(state, p.id).forEach((x) => {
    regels.push([p.naam, x.plaats || '', x.d.startnr, x.d.ruiter, x.d.paard, x.d.vereniging,
      x.r.gestart ? fmt(x.r.totaal, 1) : '', x.r.compleet ? fmt(x.r.perc, 3) : '', statusLabel(x) || (x.r.compleet ? 'klaar' : '')]);
  }));
  const csv = regels.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download('﻿' + csv, 'uitslag.csv', 'text/csv');
};

function download(inhoud, naam, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([inhoud], { type }));
  a.download = naam;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- startlijst ----------

function renderStartlijst() {
  proefOpties($('dProef'), $('dProef').value);
  proefOpties($('iProef'), $('iProef').value);
  const rijen = [...state.deelnemers].sort((a, b) => proefNaam(a.proefId).localeCompare(proefNaam(b.proefId)) || startNrSort(a, b));
  $('dLijst').innerHTML = rijen.length ? `<table><thead><tr><th>Nr</th><th>Ruiter</th><th>Paard</th><th>Vereniging</th><th>Proef</th><th></th></tr></thead><tbody>
    ${rijen.map((d) => `<tr><td>${esc(d.startnr)}</td><td>${esc(d.ruiter)}</td><td>${esc(d.paard)}</td><td>${esc(d.vereniging)}</td>
      <td>${esc(proefNaam(d.proefId))}</td>
      <td class="r"><button class="knop licht" data-bewerk="${d.id}">Bewerken</button> <button class="knop rood" data-wis="${d.id}">Wissen</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="leeg">Nog geen deelnemers</div>';
}

function leegDeelnemer() {
  ['dId', 'dStartnr', 'dRuiter', 'dPaard', 'dVereniging'].forEach((k) => { $(k).value = ''; });
  $('dTitel').textContent = 'Deelnemer toevoegen';
}

$('dNieuw').onclick = leegDeelnemer;
$('dOpslaan').onclick = async () => {
  if (!$('dRuiter').value.trim()) return melding('Vul de naam van de ruiter in');
  if (!$('dProef').value) return melding('Maak eerst een proef aan');
  const bestaand = deelnemer($('dId').value);
  await actie({ type: 'deelnemer.save', deelnemer: {
    ...(bestaand || {}),
    id: $('dId').value || undefined,
    startnr: $('dStartnr').value, ruiter: $('dRuiter').value, paard: $('dPaard').value,
    vereniging: $('dVereniging').value, proefId: $('dProef').value,
  } });
  const volgend = parseInt($('dStartnr').value, 10);
  leegDeelnemer();
  if (!bestaand && volgend) $('dStartnr').value = volgend + 1;
  $('dRuiter').focus();
  melding('Opgeslagen');
};

$('dLijst').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.bewerk) {
    const d = deelnemer(b.dataset.bewerk);
    $('dId').value = d.id; $('dStartnr').value = d.startnr; $('dRuiter').value = d.ruiter;
    $('dPaard').value = d.paard; $('dVereniging').value = d.vereniging; $('dProef').value = d.proefId;
    $('dTitel').textContent = 'Deelnemer bewerken';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.wis) {
    const d = deelnemer(b.dataset.wis);
    if (confirm(`${d.ruiter} en alle scores verwijderen?`)) await actie({ type: 'deelnemer.delete', id: d.id });
  }
};

$('iImport').onclick = async () => {
  if (!$('iProef').value) return melding('Maak eerst een proef aan');
  const deelnemers = $('iTekst').value.split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map((r) => {
    const [startnr, ruiter, paard, vereniging] = r.split(/\t|;/).map((s) => s.trim());
    return { startnr, ruiter, paard, vereniging, proefId: $('iProef').value };
  }).filter((d) => d.ruiter);
  if (!deelnemers.length) return melding('Geen regels gevonden');
  await actie({ type: 'deelnemers.import', deelnemers });
  $('iTekst').value = '';
  melding(`${deelnemers.length} deelnemers toegevoegd`);
};

// ---------- proeven ----------

function parseOnderdelen(tekst) {
  return tekst.split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map((r) => {
    const m = r.match(/^(.*?)\s*;\s*(\d+)\s*$/);
    return m ? { tekst: m[1], coef: Number(m[2]) || 1 } : { tekst: r, coef: 1 };
  });
}

function updateTelling() {
  const o = parseOnderdelen($('pOnderdelen').value);
  const max = o.reduce((s, x) => s + 10 * x.coef, 0);
  $('pTelling').textContent = o.length ? `${o.length} onderdelen, maximaal ${max} punten` : '';
}
$('pOnderdelen').oninput = updateTelling;

function renderProeven() {
  $('pLijst').innerHTML = state.proeven.length ? `<table><thead><tr><th>Proef</th><th>Rubriek</th><th class="c">Onderdelen</th><th class="c">Max</th><th class="c">Jury</th><th class="c">Deelnemers</th><th></th></tr></thead><tbody>
    ${state.proeven.map((p) => `<tr><td><b>${esc(p.naam)}</b></td><td>${esc(p.rubriek)}</td>
      <td class="c">${p.onderdelen.length}</td><td class="c">${KNHS.maxPunten(p)}</td><td class="c">${p.aantalJury}</td>
      <td class="c">${state.deelnemers.filter((d) => d.proefId === p.id).length}</td>
      <td class="r"><button class="knop licht" data-bewerk="${p.id}">Bewerken</button>
        <button class="knop licht" data-kopie="${p.id}">Kopie</button>
        <button class="knop rood" data-wis="${p.id}">Wissen</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="leeg">Nog geen proeven</div>';
}

function vulProef(p, kopie) {
  $('pId').value = kopie ? '' : p.id;
  $('pNaam').value = kopie ? p.naam + ' (kopie)' : p.naam;
  $('pRubriek').value = p.rubriek;
  $('pJury').value = String(p.aantalJury);
  $('pFout').value = p.foutAftrek.join(';');
  $('pOnderdelen').value = p.onderdelen.map((o) => (o.coef > 1 ? `${o.tekst}; ${o.coef}` : o.tekst)).join('\n');
  $('pTitel').textContent = kopie ? 'Proef toevoegen' : 'Proef bewerken';
  updateTelling();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function leegProef() {
  ['pId', 'pNaam', 'pRubriek', 'pOnderdelen'].forEach((k) => { $(k).value = ''; });
  $('pJury').value = '1';
  $('pFout').value = '2;4';
  $('pTitel').textContent = 'Proef toevoegen';
  updateTelling();
}

$('pNieuw').onclick = leegProef;
$('pOpslaan').onclick = async () => {
  const onderdelen = parseOnderdelen($('pOnderdelen').value);
  if (!$('pNaam').value.trim()) return melding('Geef de proef een naam');
  if (!onderdelen.length) return melding('Voeg minstens één onderdeel toe');
  const bestaand = KNHS.vindProef(state, $('pId').value);
  if (bestaand && bestaand.onderdelen.length !== onderdelen.length && Object.keys(state.scores).some((id) => deelnemer(id)?.proefId === bestaand.id)) {
    if (!confirm('Er zijn al punten gegeven in deze proef. Het aantal onderdelen wijzigen kan punten verschuiven. Doorgaan?')) return;
  }
  await actie({ type: 'proef.save', proef: {
    id: $('pId').value || undefined,
    naam: $('pNaam').value, rubriek: $('pRubriek').value,
    aantalJury: Number($('pJury').value),
    foutAftrek: $('pFout').value.split(/[;\s]+/).filter(Boolean).map((n) => Number(n.replace(',', '.'))).filter((n) => Number.isFinite(n)),
    onderdelen,
  } });
  leegProef();
  melding('Proef opgeslagen');
};

$('pLijst').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const p = KNHS.vindProef(state, b.dataset.bewerk || b.dataset.kopie || b.dataset.wis);
  if (b.dataset.bewerk) vulProef(p, false);
  if (b.dataset.kopie) vulProef(p, true);
  if (b.dataset.wis) {
    const n = state.deelnemers.filter((d) => d.proefId === p.id).length;
    if (n) return melding(`Er staan nog ${n} deelnemers in deze proef`);
    if (confirm(`Proef ${p.naam} verwijderen?`)) await actie({ type: 'proef.delete', id: p.id });
  }
};

// ---------- instellingen ----------

function renderInstellingen() {
  $('tvUrl').textContent = location.origin + '/tv';
  const actief = document.activeElement;
  if (!['tProef', 'tActief', 'tRotatie', 'tLive'].includes(actief?.id)) {
    proefOpties($('tProef'), state.display.proefId, '<option value="auto">Automatisch (volgt wie in de baan is)</option>');
    $('tProef').value = KNHS.vindProef(state, state.display.proefId) ? state.display.proefId : 'auto';
    $('tActief').innerHTML = '<option value="">Niemand</option>' + [...state.deelnemers].sort(startNrSort)
      .map((d) => `<option value="${d.id}">${esc(d.startnr)} ${esc(d.ruiter)} (${esc(proefNaam(d.proefId))})</option>`).join('');
    $('tActief').value = state.display.actiefId || '';
    $('tRotatie').value = state.display.rotatieSec;
    $('tLive').value = state.display.toonLive ? '1' : '0';
  }
  if (!['wNaam', 'wDatum', 'wLocatie'].includes(actief?.id)) {
    $('wNaam').value = state.wedstrijd.naam;
    $('wDatum').value = state.wedstrijd.datum;
    $('wLocatie').value = state.wedstrijd.locatie;
  }
}

$('tOpslaan').onclick = async () => {
  await actie({ type: 'display', proefId: $('tProef').value, actiefId: $('tActief').value || null,
    rotatieSec: Number($('tRotatie').value), toonLive: $('tLive').value === '1' });
  melding('Tv bijgewerkt');
};
$('wOpslaan').onclick = async () => {
  await actie({ type: 'wedstrijd', naam: $('wNaam').value, datum: $('wDatum').value, locatie: $('wLocatie').value });
  melding('Opgeslagen');
};
$('bExport').onclick = () => {
  const naam = (state.wedstrijd.naam || 'wedstrijd').replace(/[^\w]+/g, '_');
  download(JSON.stringify(state, null, 2), `${naam}_${state.wedstrijd.datum || 'backup'}.json`, 'application/json');
};
$('bImport').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!confirm('De huidige wedstrijd wordt vervangen door deze back up. Doorgaan?')) return;
    await actie({ type: 'import', data });
    melding('Back up teruggezet');
  } catch (err) {
    melding('Ongeldig bestand');
  } finally {
    e.target.value = '';
  }
};
$('bReset').onclick = async () => {
  if (!confirm('Alle proeven, deelnemers en scores wissen?')) return;
  if (!confirm('Weet je het zeker? Dit kan niet ongedaan worden gemaakt.')) return;
  await actie({ type: 'reset' });
};

// ---------- start ----------

window.addEventListener('beforeunload', (e) => { if (wachtOpOpslaan) { flushOpslaan(); e.preventDefault(); } });
controleerPin();
laad().then(luister);
