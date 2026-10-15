// Smart tv weergave. ES5 + XMLHttpRequest voor maximale compatibiliteit met tv browsers.
(function () {
  'use strict';

  var state = null;
  var pagina = 0;
  var autoIndex = 0;
  var laatsteContact = 0;
  var tickTimer = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function haal() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/state?v=' + (state ? state.version : 0) + '&t=' + new Date().getTime(), true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        laatsteContact = new Date().getTime();
        try {
          var data = JSON.parse(xhr.responseText);
          if (!data.unchanged) { state = data; render(); }
        } catch (e) { /* negeer en probeer opnieuw */ }
      }
      toonStatus();
    };
    xhr.send();
  }

  function deelnemer(id) {
    if (!state || !id) return null;
    for (var i = 0; i < state.deelnemers.length; i++) if (state.deelnemers[i].id === id) return state.deelnemers[i];
    return null;
  }

  function proevenMetDeelnemers() {
    var lijst = [];
    for (var i = 0; i < state.proeven.length; i++) {
      for (var j = 0; j < state.deelnemers.length; j++) {
        if (state.deelnemers[j].proefId === state.proeven[i].id) { lijst.push(state.proeven[i]); break; }
      }
    }
    return lijst;
  }

  // Welke proef staat op het scherm, en roteren we automatisch tussen proeven?
  function keuze() {
    var disp = state.display || {};
    if (disp.proefId && disp.proefId !== 'auto') {
      var vast = KNHS.vindProef(state, disp.proefId);
      if (vast) return { proef: vast, roteer: false };
    }
    var actief = deelnemer(disp.actiefId);
    if (actief) {
      var p = KNHS.vindProef(state, actief.proefId);
      if (p) return { proef: p, roteer: false };
    }
    var lijst = proevenMetDeelnemers();
    if (!lijst.length) return { proef: null, roteer: false };
    return { proef: lijst[autoIndex % lijst.length], roteer: lijst.length > 1, aantal: lijst.length };
  }

  function rijenPerPagina() {
    var vw = window.innerWidth / 100;
    var beschikbaar = $('tabel').clientHeight - 3 * vw;
    return Math.max(3, Math.floor(beschikbaar / (4.4 * vw)));
  }

  function renderLive(proef) {
    var disp = state.display || {};
    var d = deelnemer(disp.actiefId);
    if (!d || !proef || d.proefId !== proef.id) { $('live').innerHTML = ''; return; }
    var r = KNHS.resultaat(state, d);
    var n = proef.onderdelen.length || 1;
    var scoreHtml;
    if (r.uitgesloten) {
      scoreHtml = '<div class="perc">U</div><div class="sub">uitgesloten</div>';
    } else if (r.compleet) {
      scoreHtml = '<div class="perc">' + KNHS.fmt(r.perc, 3) + '%</div><div class="sub">' + KNHS.fmt(r.totaal, 1) + ' punten</div>';
    } else if (disp.toonLive && r.gestart) {
      scoreHtml = '<div class="perc">' + KNHS.fmt(r.livePerc, 2) + '%</div><div class="sub">' + KNHS.fmt(r.totaal, 1) + ' punten tot nu toe</div>';
    } else {
      scoreHtml = '<div class="sub">score volgt</div>';
    }
    $('live').innerHTML =
      '<div class="live">' +
        '<div class="nr">' + esc(d.startnr) + '</div>' +
        '<div class="wie">' +
          '<div class="label">' + (r.compleet || r.uitgesloten ? 'Zojuist gereden' : 'Nu in de baan') + '</div>' +
          '<div class="ruiter">' + esc(d.ruiter) + '</div>' +
          '<div class="paard">' + esc(d.paard) + (d.vereniging ? ' &middot; ' + esc(d.vereniging) : '') + '</div>' +
          (r.compleet || r.uitgesloten ? '' : '<div class="balk"><div style="width:' + Math.round((r.ingevuld / n) * 100) + '%"></div></div>') +
        '</div>' +
        '<div class="score">' + scoreHtml + '</div>' +
      '</div>';
  }

  function statusTekst(x, actiefId) {
    if (x.r.uitgesloten) return '<span class="badge">Uitgesloten</span>';
    if (x.d.status === 'nietGestart') return '<span class="badge">Niet gestart</span>';
    if (x.d.id === actiefId || x.r.gestart) return '<span class="badge">In de baan</span>';
    return '<span class="zacht">volgt</span>';
  }

  function renderTabel(proef, rp) {
    var rijen = KNHS.klassement(state, proef.id);
    var actiefId = (state.display || {}).actiefId;
    if (!rijen.length) { $('tabel').innerHTML = '<div class="leeg">Nog geen deelnemers voor deze proef</div>'; return 1; }

    var paginas = Math.max(1, Math.ceil(rijen.length / rp));
    if (pagina >= paginas) pagina = 0;
    var start = pagina * rp;
    var multi = proef.aantalJury > 1;
    var toonLive = (state.display || {}).toonLive;

    var h = '<table><colgroup>' +
      '<col style="width:6%"><col style="width:6%"><col style="width:' + (multi ? 22 : 27) + '%"><col style="width:' + (multi ? 20 : 25) + '%">' +
      '<col style="width:' + (multi ? 12 : 16) + '%">';
    for (var j = 0; j < (multi ? proef.aantalJury : 0); j++) h += '<col style="width:' + Math.floor(16 / proef.aantalJury) + '%">';
    h += '<col style="width:9%"><col style="width:11%"></colgroup><thead><tr>' +
      '<th class="c">Pl</th><th class="c">Nr</th><th>Ruiter</th><th>Paard</th><th>Vereniging</th>';
    for (j = 0; j < (multi ? proef.aantalJury : 0); j++) h += '<th class="r">Jury ' + (j + 1) + '</th>';
    h += '<th class="r">Punten</th><th class="r">%</th></tr></thead><tbody>';

    for (var i = start; i < Math.min(rijen.length, start + rp); i++) {
      var x = rijen[i];
      var cls = (i % 2 ? 'alt' : '') + (x.d.id === actiefId ? ' actief' : '');
      var pl = x.plaats ? '<span class="pl' + (x.plaats <= 3 ? ' pl' + x.plaats : '') + '">' + x.plaats + '</span>' : '';
      h += '<tr class="' + cls + '"><td class="c pl">' + pl + '</td>' +
        '<td class="c">' + esc(x.d.startnr) + '</td>' +
        '<td class="vet">' + esc(x.d.ruiter) + '</td>' +
        '<td>' + esc(x.d.paard) + '</td>' +
        '<td class="klein">' + esc(x.d.vereniging) + '</td>';
      var toon = x.r.compleet || (toonLive && x.r.gestart && !x.r.uitgesloten);
      for (j = 0; j < (multi ? proef.aantalJury : 0); j++) {
        var pj = x.r.perJury[j];
        h += '<td class="r klein">' + (x.r.compleet ? KNHS.fmt(pj.perc, 2) : '') + '</td>';
      }
      if (x.r.compleet) {
        h += '<td class="r">' + KNHS.fmt(x.r.totaal, 1) + '</td><td class="r vet">' + KNHS.fmt(x.r.perc, 3) + '</td>';
      } else if (toon) {
        h += '<td class="r zacht">' + KNHS.fmt(x.r.totaal, 1) + '</td><td class="r zacht">' + statusTekst(x, actiefId) + '</td>';
      } else {
        h += '<td></td><td class="r">' + statusTekst(x, actiefId) + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    $('tabel').innerHTML = h;
    return paginas;
  }

  var paginasNu = 1;
  var keuzeNu = null;

  function render() {
    if (!state) return;
    document.title = state.wedstrijd.naam || 'Uitslagen';
    $('wedstrijd').innerHTML = esc([state.wedstrijd.naam, state.wedstrijd.locatie].filter(function (s) { return s; }).join(' · '));
    keuzeNu = keuze();
    var proef = keuzeNu.proef;
    if (!proef) {
      $('proef').innerHTML = 'Uitslagen';
      $('rubriek').innerHTML = '';
      $('live').innerHTML = '';
      $('tabel').innerHTML = '<div class="leeg">Wachten op de jury</div>';
      $('pagina').innerHTML = '';
      return;
    }
    $('proef').innerHTML = esc(proef.naam);
    $('rubriek').innerHTML = esc(proef.rubriek) + (proef.aantalJury > 1 ? (proef.rubriek ? ' · ' : '') + proef.aantalJury + ' juryleden' : '');
    renderLive(proef);
    paginasNu = renderTabel(proef, rijenPerPagina());
    $('pagina').innerHTML = paginasNu > 1 ? 'Pagina ' + (pagina + 1) + ' van ' + paginasNu : '';
  }

  function tick() {
    if (state) {
      if (pagina + 1 < paginasNu) {
        pagina++;
      } else {
        pagina = 0;
        if (keuzeNu && keuzeNu.roteer) autoIndex = (autoIndex + 1) % keuzeNu.aantal;
      }
      render();
    }
    var sec = (state && state.display && state.display.rotatieSec) || 12;
    tickTimer = setTimeout(tick, sec * 1000);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toonStatus() {
    var oud = new Date().getTime() - laatsteContact > 10000;
    $('status').innerHTML = oud ? '<span class="offline">Geen verbinding met de server</span>' : 'Live';
  }

  function klok() {
    var d = new Date();
    $('klok').innerHTML = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  window.onresize = render;
  klok();
  setInterval(klok, 5000);
  haal();
  setInterval(haal, 2000);
  setInterval(toonStatus, 3000);
  tickTimer = setTimeout(tick, 12000);

  // Directe updates waar de tv browser dit ondersteunt; anders is er de polling hierboven.
  if (window.EventSource) {
    try {
      var es = new EventSource('/api/events');
      es.onmessage = function (e) {
        try {
          var v = JSON.parse(e.data).version;
          if (!state || v !== state.version) haal();
        } catch (err) { /* negeer */ }
      };
    } catch (e) { /* polling blijft werken */ }
  }
})();
