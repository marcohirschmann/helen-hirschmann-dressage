// Gedeelde rekenregels voor jury en tv.
// Bewust in ES5 geschreven zodat ook oudere smart tv browsers dit kunnen draaien.
(function (root) {
  'use strict';

  function vindProef(state, id) {
    for (var i = 0; i < state.proeven.length; i++) if (state.proeven[i].id === id) return state.proeven[i];
    return null;
  }

  function maxPunten(proef) {
    var m = 0;
    for (var i = 0; i < proef.onderdelen.length; i++) m += 10 * proef.onderdelen[i].coef;
    return m;
  }

  function foutPunten(proef, fouten) {
    var t = 0;
    for (var i = 0; i < fouten && i < proef.foutAftrek.length; i++) t += proef.foutAftrek[i];
    return t;
  }

  // Resultaat van een jurylid voor een deelnemer.
  function juryResultaat(proef, s) {
    var bruto = 0, ingevuld = 0, maxIngevuld = 0;
    var punten = (s && s.punten) || [];
    for (var i = 0; i < proef.onderdelen.length; i++) {
      var v = punten[i];
      if (v !== null && v !== undefined && v !== '') {
        bruto += v * proef.onderdelen[i].coef;
        maxIngevuld += 10 * proef.onderdelen[i].coef;
        ingevuld++;
      }
    }
    var fouten = (s && s.fouten) || 0;
    var aftrek = foutPunten(proef, fouten) + ((s && s.overigeAftrek) || 0);
    var netto = Math.max(0, bruto - aftrek);
    var max = maxPunten(proef);
    return {
      bruto: bruto,
      aftrek: aftrek,
      netto: netto,
      fouten: fouten,
      ingevuld: ingevuld,
      compleet: proef.onderdelen.length > 0 && ingevuld === proef.onderdelen.length,
      uitgesloten: proef.foutAftrek.length > 0 && fouten > proef.foutAftrek.length,
      perc: max ? (netto / max) * 100 : 0,
      livePerc: maxIngevuld ? (Math.max(0, bruto - aftrek) / maxIngevuld) * 100 : 0,
    };
  }

  // Gecombineerd resultaat over alle juryleden.
  function resultaat(state, d) {
    var proef = vindProef(state, d.proefId);
    if (!proef) return null;
    var per = [], totaal = 0, percSom = 0, liveSom = 0, liveN = 0, compleet = true, uitgesloten = d.status === 'uitgesloten';
    var ingevuld = 0;
    var sc = state.scores[d.id] || {};
    for (var j = 1; j <= proef.aantalJury; j++) {
      var r = juryResultaat(proef, sc[String(j)]);
      per.push(r);
      totaal += r.netto;
      percSom += r.perc;
      ingevuld = Math.max(ingevuld, r.ingevuld);
      if (r.ingevuld) { liveSom += r.livePerc; liveN++; }
      if (!r.compleet) compleet = false;
      if (r.uitgesloten) uitgesloten = true;
    }
    return {
      proef: proef,
      perJury: per,
      totaal: totaal,
      perc: percSom / proef.aantalJury,
      livePerc: liveN ? liveSom / liveN : 0,
      ingevuld: ingevuld,
      gestart: ingevuld > 0,
      compleet: compleet && !uitgesloten,
      uitgesloten: uitgesloten,
      maxTotaal: maxPunten(proef) * proef.aantalJury,
    };
  }

  // Klassement voor een proef: geklasseerde deelnemers eerst, op percentage.
  function klassement(state, proefId) {
    var rijen = [];
    for (var i = 0; i < state.deelnemers.length; i++) {
      var d = state.deelnemers[i];
      if (d.proefId !== proefId) continue;
      rijen.push({ d: d, r: resultaat(state, d) });
    }
    function startNr(x) { var n = parseFloat(x.d.startnr); return isNaN(n) ? 1e9 : n; }
    function groep(x) {
      if (x.r.compleet) return 0;
      if (x.r.gestart && !x.r.uitgesloten) return 1;
      if (x.d.status === 'gepland' || x.d.status === 'gestart') return 2;
      return 3;
    }
    rijen.sort(function (a, b) {
      var ga = groep(a), gb = groep(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0 && Math.abs(b.r.perc - a.r.perc) > 1e-9) return b.r.perc - a.r.perc;
      return startNr(a) - startNr(b);
    });
    var plaats = 0, vorige = null;
    for (var k = 0; k < rijen.length; k++) {
      var x = rijen[k];
      if (!x.r.compleet) { x.plaats = null; continue; }
      var key = x.r.perc.toFixed(3);
      if (key !== vorige) plaats = k + 1;
      vorige = key;
      x.plaats = plaats;
    }
    return rijen;
  }

  function fmt(n, dec) {
    return n.toFixed(dec).replace('.', ',');
  }

  root.KNHS = {
    vindProef: vindProef,
    maxPunten: maxPunten,
    juryResultaat: juryResultaat,
    resultaat: resultaat,
    klassement: klassement,
    fmt: fmt,
  };
})(this);
