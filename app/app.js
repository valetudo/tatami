/* tatami — visualizzatore del gioco (MVP).
   Carica grafo.json, disegna il grafo 3D, pannello dettaglio, filtro moduli.
   Zero build lato pagina: questo file gira cosi' com'e' nel browser. */
'use strict';

// ---- colori del dominio ----
const C_NODO = {
  posizione_sotto: '#4aa3df',
  posizione_sopra: '#2f6fb0',
  svantaggio:      '#e8833a',
  sottomissione:   '#e74c3c',
  esito:           '#2ecc71',
};
const C_ARCO = {
  normale: '#7f8c9b',
  conquista: '#f5c518',  // oro: l'arco OTTIENE una conquista
  richiede: '#9b59b6',   // viola: l'arco e' sbloccato da una conquista
  negativo: '#ff453a',   // rosso: esito negativo
};

function coloreNodo(n){
  if (n.tipo === 'sottomissione') return C_NODO.sottomissione;
  if (n.tipo === 'esito') return C_NODO.esito;
  if (n.svantaggio) return C_NODO.svantaggio;
  return n.ruolo === 'sopra' ? C_NODO.posizione_sopra : C_NODO.posizione_sotto;
}
function coloreArco(l){
  if (l.esito_negativo) return C_ARCO.negativo;
  if (l.conquista) return C_ARCO.conquista;
  if (l.richiede) return C_ARCO.richiede;
  return C_ARCO.normale;
}

// ---- utilita' ----
const $ = (s) => document.querySelector(s);
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function idDi(x){ return (x && typeof x === 'object') ? x.id : x; }

// ---- media: foto/video da URL (Drive / YouTube) ----
function driveId(url){
  const m = String(url).match(/\/d\/([-\w]{20,})/) || String(url).match(/[?&]id=([-\w]{20,})/);
  return m ? m[1] : null;
}
function youtubeId(url){
  const m = String(url).match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([-\w]{11})/);
  return m ? m[1] : null;
}
function fotoSrc(url){
  const id = driveId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1200` : url;
}
function videoEmbed(url){
  const yt = youtubeId(url); if (yt) return `https://www.youtube.com/embed/${yt}`;
  const gd = driveId(url);   if (gd) return `https://drive.google.com/file/d/${gd}/preview`;
  return url;
}
function mediaHTML(media){
  if (!media || (!media.foto && !media.video)) return '<div class="muted">nessun media collegato</div>';
  let h = '';
  if (media.foto){
    h += `<div class="media"><img loading="lazy" referrerpolicy="no-referrer" alt="foto" src="${esc(fotoSrc(media.foto))}">`
       + `<a class="open" href="${esc(media.foto)}" target="_blank" rel="noopener">apri foto ↗</a></div>`;
  }
  if (media.video){
    h += `<div class="media"><div class="vwrap"><iframe src="${esc(videoEmbed(media.video))}" `
       + `allow="autoplay; fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`
       + `<a class="open" href="${esc(media.video)}" target="_blank" rel="noopener">apri video ↗</a></div>`;
  }
  return h;
}

// ---- etichette del tipo nodo ----
function tipoLabel(n){
  if (n.tipo === 'sottomissione') return 'Sottomissione (terminale)';
  if (n.tipo === 'esito') return 'Esito (terminale)';
  if (n.svantaggio) return 'Svantaggio · prigione';
  return 'Posizione';
}

let G = null;            // istanza ForceGraph3D
let DATI = { nodes: [], links: [] };  // grafo completo (pristino)
let NODI_BY_ID = {};
let adattato = false;

// ================= avvio =================
init();

async function init(){
  if (typeof ForceGraph3D === 'undefined'){
    return mostraErrore('Impossibile caricare la libreria del grafo (3d-force-graph). Controlla la connessione.');
  }
  let data;
  try{
    const r = await fetch('grafo.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  }catch(e){
    return mostraErrore('Non riesco a leggere grafo.json — lancia prima <code>python build.py</code>. (' + esc(e.message) + ')');
  }

  DATI = { nodes: data.nodes || [], links: data.links || [] };
  NODI_BY_ID = Object.fromEntries(DATI.nodes.map((n) => [n.id, n]));
  const meta = data.meta || {};

  $('#conta').textContent =
    `${meta.n_nodi ?? DATI.nodes.length} nodi · ${meta.n_archi ?? DATI.links.length} archi · ${(meta.moduli||[]).length} moduli`;

  costruisciFiltro(meta.moduli || elencoModuli());
  costruisciAvvisi(meta.avvisi || []);
  costruisciGrafo();
  applicaFiltro();
  collegaUI();
}

function elencoModuli(){
  const s = new Set();
  DATI.nodes.forEach((n) => (n.moduli || []).forEach((m) => s.add(m)));
  DATI.links.forEach((l) => l.modulo && s.add(l.modulo));
  return [...s].sort();
}

// ---- etichette 3D opzionali (degradano senza rompere) ----
const USA_ETICHETTE = (typeof SpriteText !== 'undefined');
function etichetta3D(n){
  try{
    const s = new SpriteText(n.nome);
    s.color = '#eef4fb';
    s.textHeight = 3.4;
    s.fontWeight = '600';
    s.backgroundColor = coloreNodo(n) + 'dd';
    s.padding = 1.6;
    s.borderRadius = 2;
    s.position.set(0, 7, 0);
    // sempre DAVANTI ai nodi: niente depth-test, disegnate per ultime
    s.material.depthTest = false;
    s.material.depthWrite = false;
    s.renderOrder = 10;
    return s;
  }catch(e){ return null; }
}

function costruisciGrafo(){
  G = ForceGraph3D()($('#graph'))
    .backgroundColor('#0b0e13')
    .nodeId('id')
    .nodeColor(coloreNodo)
    .nodeRelSize(3)
    .nodeVal((n) => (n.tipo === 'posizione' ? 2.2 : 3))
    .nodeOpacity(0.9)
    .nodeResolution(14)
    .nodeLabel((n) => `<div class="tt"><b>${esc(n.nome)}</b><div class="sub">${tipoLabel(n)}${n.ruolo ? ' · ruolo '+esc(n.ruolo) : ''}</div></div>`)
    .linkColor(coloreArco)
    .linkOpacity(0.75)
    .linkWidth((l) => (l.esito_negativo ? 2.5 : 1.2))
    .linkCurvature((l) => (idDi(l.source) === idDi(l.target) ? 0.6 : 0))
    .linkDirectionalArrowLength(5)
    .linkDirectionalArrowRelPos(0.82)
    .linkDirectionalArrowColor(coloreArco)
    .linkDirectionalParticles((l) => (l.esito_negativo ? 2 : 0))
    .linkDirectionalParticleWidth(2.2)
    .linkLabel(arcoTooltip)
    .onNodeClick(mostraNodo)
    .onLinkClick(mostraArco)
    .onBackgroundClick(chiudiPannello)
    .onEngineStop(() => { if (!adattato){ adattato = true; try{ G.zoomToFit(600, 40); }catch(e){} } });

  if (USA_ETICHETTE){
    G.nodeThreeObjectExtend(true).nodeThreeObject(etichetta3D);
  }

  // piu' "aria" tra i nodi: con le etichette accese si legge molto meglio
  try{
    G.d3Force('charge').strength(-170);
    if (G.d3Force('link')) G.d3Force('link').distance(80);
    G.d3VelocityDecay(0.28);
  }catch(e){}

  window.addEventListener('resize', () => { G.width(window.innerWidth); G.height(window.innerHeight); });
  G.width(window.innerWidth).height(window.innerHeight);
}

function arcoTooltip(l){
  let sub = '';
  if (l.se_lui) sub += `se lui: ${esc(l.se_lui)}`;
  const flag = [];
  if (l.conquista) flag.push('ottiene: ' + esc(l.conquista));
  if (l.richiede) flag.push('richiede: ' + esc(l.richiede));
  if (l.perdo_conquista) flag.push('perde: ' + esc(l.perdo_conquista));
  if (l.esito_negativo) flag.push('esito negativo');
  if (flag.length) sub += (sub ? '<br>' : '') + flag.join(' · ');
  return `<div class="tt"><b>${esc(l.mossa || '(mossa non indicata)')}</b>${sub ? '<div class="sub">'+sub+'</div>' : ''}</div>`;
}

// ================= filtro moduli =================
function costruisciFiltro(moduli){
  const box = $('#filtro-lista');
  box.innerHTML = '';
  moduli.forEach((m) => {
    const id = 'mod_' + m.replace(/\W/g, '_');
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" id="${id}" value="${esc(m)}" checked> <span>${esc(m)}</span>`;
    box.appendChild(lab);
  });
  box.addEventListener('change', applicaFiltro);
}

function moduliSelezionati(){
  return new Set([...document.querySelectorAll('#filtro-lista input:checked')].map((i) => i.value));
}

function applicaFiltro(){
  const sel = moduliSelezionati();
  const nodes = DATI.nodes.filter((n) => (n.moduli || []).some((m) => sel.has(m)));
  const vis = new Set(nodes.map((n) => n.id));
  const links = DATI.links.filter((l) => sel.has(l.modulo) && vis.has(idDi(l.source)) && vis.has(idDi(l.target)));
  adattato = false;
  G.graphData({ nodes, links });
}

// ================= pannello dettaglio =================
function tag(txt, cls){ return `<span class="tag ${cls || ''}">${esc(txt)}</span>`; }

function mostraNodo(n){
  let b = `<div class="p-nome">${esc(n.nome)}</div><div class="p-badges">`;
  b += tag(n.tipo, 'tipo-' + n.tipo);
  if (n.ruolo) b += tag('ruolo: ' + n.ruolo, 'ruolo');
  if (n.svantaggio) b += tag('prigione', 'svantaggio');
  b += '</div>';

  if (n.nomi && (n.nomi.sotto || n.nomi.sopra)){
    b += `<div class="p-sez">Due facce · stessa posizione</div><div class="chips">`;
    if (n.nomi.sotto) b += `<span class="chip">👁 da sotto: ${esc(n.nomi.sotto)}</span>`;
    if (n.nomi.sopra) b += `<span class="chip">👁 da sopra: ${esc(n.nomi.sopra)}</span>`;
    b += '</div>';
  }

  if (n.conquiste_possibili && n.conquiste_possibili.length){
    b += `<div class="p-sez">Conquiste possibili qui</div><div class="chips">`
       + n.conquiste_possibili.map((c) => `<span class="chip">🔑 ${esc(c)}</span>`).join('') + '</div>';
  }
  if (n.note){ b += `<div class="p-sez">Note</div><div class="p-testo">${esc(n.note.trim())}</div>`; }
  b += `<div class="p-sez">Media</div>${mediaHTML(n.media)}`;
  if (n.moduli && n.moduli.length){
    b += `<div class="p-sez">Moduli</div><div class="chips">` + n.moduli.map((m) => `<span class="chip">${esc(m)}</span>`).join('') + '</div>';
  }
  apriPannello(b);
}

function mostraArco(l){
  const da = NODI_BY_ID[idDi(l.source)], a = NODI_BY_ID[idDi(l.target)];
  let b = `<div class="p-arco">${esc(da ? da.nome : idDi(l.source))}<span class="freccia">→</span>${esc(a ? a.nome : idDi(l.target))}</div>`;
  b += `<div class="p-badges">`;
  if (l.esito_negativo) b += tag('esito negativo', 'neg');
  if (l.conquista) b += tag('ottiene: ' + l.conquista, 'oro');
  if (l.richiede) b += tag('richiede: ' + l.richiede, 'viola');
  if (l.perdo_conquista) b += tag('perde: ' + l.perdo_conquista, 'neg');
  if (l.persiste) b += tag('persistente', 'oro');
  b += '</div>';

  b += `<div class="p-sez">Mossa</div><div class="p-testo">${esc(l.mossa || '—')}</div>`;
  if (l.se_lui){ b += `<div class="p-sez">Se lui…</div><div class="p-testo">${esc(l.se_lui)}</div>`; }
  if (l.mantieni_se){ b += `<div class="p-sez">Si mantiene se</div><div class="p-testo">${esc(l.mantieni_se)}</div>`; }
  if (l.note){ b += `<div class="p-sez">Note</div><div class="p-testo">${esc(l.note.trim())}</div>`; }
  b += `<div class="p-sez">Media</div>${mediaHTML(l.media)}`;
  apriPannello(b);
}

function apriPannello(html){
  $('#pannello-corpo').innerHTML = html;
  $('#pannello').classList.remove('nascosto');
  $('#avvisi-box').classList.add('nascosto');
}
function chiudiPannello(){ $('#pannello').classList.add('nascosto'); }

// ================= avvisi (buchi) =================
function costruisciAvvisi(avvisi){
  const btn = $('#avvisi-btn');
  if (!avvisi.length){ btn.classList.add('nascosto'); return; }
  $('#avvisi-n').textContent = avvisi.length;
  btn.classList.remove('nascosto');
  $('#avvisi-lista').innerHTML = avvisi.map((a) => `<li>${esc(a)}</li>`).join('');
}

// ================= collegamenti UI =================
function collegaUI(){
  $('#chiudi').addEventListener('click', chiudiPannello);
  $('#chiudi-avvisi').addEventListener('click', () => $('#avvisi-box').classList.add('nascosto'));
  $('#avvisi-btn').addEventListener('click', () => {
    $('#pannello').classList.add('nascosto');
    $('#avvisi-box').classList.toggle('nascosto');
  });
}

function mostraErrore(html){
  const e = $('#errore');
  e.innerHTML = html;
  e.classList.remove('nascosto');
  $('#conta').textContent = 'errore';
}
