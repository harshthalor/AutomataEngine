// =========================================================
// STATE & DATA
// =========================================================
let currentPDA = null;
let currentCFG = null;
let conversionSteps = []; 
let activeStep = 0;

// NEW AUTOPLAY VARIABLES
let autoplayTimer = null;
let isPlaying = false;

// =========================================================
// UTILITIES
// =========================================================
function switchTab(id) {
  stopAutoplay(); // Stop playing if user navigates away
  
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick').includes(id));
  });
  
  document.querySelectorAll('.input-panel').forEach(el => el.classList.remove('active'));
  document.getElementById(`${id}-input`).classList.add('active');

  document.querySelectorAll('.output-panel').forEach(el => el.classList.remove('active'));
  document.getElementById(`${id}-output`).classList.add('active');
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showErr(id,msg){ document.getElementById(id).innerHTML=`<div style="color:var(--color-danger); font-size:12px; margin-top:8px; font-weight:800;">${esc(msg)}</div>`; }
function clearErr(id){ document.getElementById(id).innerHTML=''; }

function insertSymbol(elementId, symbol) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value;
  el.value = text.substring(0, start) + symbol + text.substring(end);
  el.selectionStart = el.selectionEnd = start + symbol.length;
  el.focus();
}

// =========================================================
// CFG PARSER
// =========================================================
function parseCFG(text){
  const lines = text.trim().split('\n').filter(l => l.trim() && !l.startsWith('//'));
  const productions = []; const variables = new Set(); const terminals = new Set(); let startVar = null;
  for(const line of lines){
    const m = line.match(/^([A-Z][A-Z0-9']*)\s*[→\->]+\s*(.+)$/);
    if(!m) continue;
    const lhs = m[1].trim();
    if(!startVar) startVar = lhs;
    variables.add(lhs);
    const alts = m[2].split('|').map(s => s.trim());
    for(const alt of alts){
      const tokens = tokenizeRHS(alt);
      tokens.forEach(t => { if(t.match(/^[A-Z]/)) variables.add(t); else terminals.add(t); });
      productions.push({lhs, rhs: tokens, orig: alt.trim()});
    }
  }
  return { productions, variables: Array.from(variables), terminals: Array.from(terminals), start: startVar };
}

function tokenizeRHS(s){
  if(!s || s==='ε' || s==='eps') return [];
  // Support for 0 and 1 as terminals, along with lowercase letters
  return s.split(/\s+/).flatMap(tok => {
    if(!tok) return [];
    if(tok.match(/^[A-Z][A-Z0-9']*$/)) return [tok];
    return tok.split('').filter(c => c.trim());
  }).filter(Boolean);
}

// =========================================================
// CFG → PDA
// =========================================================
function convertCFGtoPDA(){
  clearErr('cfg-error');
  const text = document.getElementById('cfg-input').value;
  if(!text.trim()){ showErr('cfg-error','Please enter a CFG.'); return; }
  let cfg;
  try { cfg = parseCFG(text); } catch(e){ showErr('cfg-error','Parse error: '+e.message); return; }
  if(!cfg.start){ showErr('cfg-error','No productions found.'); return; }
  currentCFG = cfg;

  let ph = `<div style="font-family:var(--font-mono);font-size:14px;font-weight:800;margin-bottom:12px">Start: <span class="state-pill start">${cfg.start}</span></div>`;
  ph += `<div class="state-list" style="margin-bottom:12px"><strong style="font-size:12px">V:</strong> ${cfg.variables.map(v=>`<span class="state-pill">${v}</span>`).join('')}</div>`;
  ph += `<div class="state-list" style="margin-bottom:16px"><strong style="font-size:12px">Σ:</strong> ${cfg.terminals.map(t=>`<span class="state-pill">${t}</span>`).join('')}</div>`;
  ph += `<div style="background:var(--bg-card); border: 2px solid var(--border-dark); border-radius: var(--radius-sm); padding: 10px;">`;
  cfg.productions.forEach(p => { 
    ph += `<div style="font-family:var(--font-mono);font-size:12px;font-weight:700;padding:2px 0;">${p.lhs} → ${p.rhs.length ? p.rhs.join('') : 'ε'}</div>`; 
  });
  ph += `</div>`;
  
  const parsedOut = document.getElementById('cfg-parsed-out');
  parsedOut.innerHTML = ph;
  parsedOut.classList.remove('empty-state');

  const pda = buildPDAFromCFG(cfg);
  currentPDA = pda;
  conversionSteps = buildConversionSteps(cfg, pda);
  
  document.getElementById('cfg-empty-state').style.display = 'none';
  document.getElementById('pda-result').style.display = 'flex';

  document.getElementById('pda-formal').innerHTML = buildFormalDef(pda);
  document.getElementById('pda-trans-table').innerHTML = buildTransTable(pda);
  
  selectStep(0); 
  startAutoplay(); // Automatically start playing when generated
}

function buildPDAFromCFG(cfg){
  const transitions = [];
  transitions.push({id:'init', from:'q_initial', input:'ε', stackTop:'ε', to:'q_loop', push:cfg.start+'$', step:1, desc:`Push start var ${cfg.start} & bottom $`});
  
  cfg.productions.forEach((p,i) => {
    const pushStr = p.rhs.length ? [...p.rhs].reverse().join('') : 'ε';
    transitions.push({id:`prod_${i}`, from:'q_loop', input:'ε', stackTop:p.lhs, to:'q_loop', push:pushStr, step:2, desc:`Expand ${p.lhs} → ${p.rhs.length ? p.rhs.join('') : 'ε'}`});
  });
  
  cfg.terminals.forEach(a => {
    transitions.push({id:`term_${a}`, from:'q_loop', input:a, stackTop:a, to:'q_loop', push:'ε', step:3, desc:`Match '${a}'`});
  });
  
  transitions.push({id:'accept', from:'q_loop', input:'ε', stackTop:'$', to:'q_final', push:'ε', step:4, desc:'Accept on empty stack'});
  
  return {
    states:['q_initial','q_loop','q_final'], start:'q_initial', accept:['q_final'], 
    inputAlphabet:cfg.terminals, stackAlphabet:['$', cfg.start, ...cfg.variables, ...cfg.terminals], transitions
  };
}

function buildConversionSteps(cfg, pda){
  const steps = [];
  steps.push({
    title:'Step 1: Create States', badge:'SETUP', transIds:[],
    detail:`Create three states: q_initial (init), q_loop (computation), q_final (final).\nAll derivation logic occurs nondeterministically within q_loop.`
  });
  steps.push({
    title:'Step 2: Initialize Stack', badge:'INIT', transIds:['init'],
    detail:`δ(q_initial, ε, ε) = (q_loop, ${cfg.start}$)\nPush bottom marker ($) then start variable (${cfg.start}). Stack is now: [${cfg.start}, $]`
  });
  cfg.productions.forEach((p,i) => {
    const pushStr = p.rhs.length ? p.rhs.join('') : 'ε';
    steps.push({
      title:`Step 3.${i+1}: Rule ${p.lhs} → ${pushStr}`, badge:'EXPAND', transIds:[`prod_${i}`],
      detail:`δ(q_loop, ε, ${p.lhs}) = (q_loop, ${pushStr})\nPop variable ${p.lhs}, push RHS reversed to simulate left-most derivation.`
    });
  });
  cfg.terminals.forEach(a => {
    steps.push({
      title:`Step 4: Terminal '${a}'`, badge:'MATCH', transIds:[`term_${a}`],
      detail:`δ(q_loop, ${a}, ${a}) = (q_loop, ε)\nIf stack top matches input char, consume input and pop stack.`
    });
  });
  steps.push({
    title:'Step 5: Accept', badge:'FINISH', transIds:['accept'],
    detail:`δ(q_loop, ε, $) = (q_final, ε)\nWhen stack bottoms out ($), derivation is complete. Accept input.`
  });
  return steps;
}

// =========================================================
// NAVIGATION, VISUALS & AUTOPLAY
// =========================================================

// --- NEW AUTOPLAY FUNCTIONS ---
function startAutoplay() {
  clearInterval(autoplayTimer); // Clear any existing
  isPlaying = true;
  document.getElementById('icon-pause').style.display = 'block';
  document.getElementById('icon-play').style.display = 'none';
  
  autoplayTimer = setInterval(() => {
    if (activeStep < conversionSteps.length - 1) {
      nextStep(false); // false means 'triggered by autoplay'
    } else {
      stopAutoplay();
    }
  }, 1500); // 1.5 second interval
}

function stopAutoplay() {
  isPlaying = false;
  document.getElementById('icon-pause').style.display = 'none';
  document.getElementById('icon-play').style.display = 'block';
  clearInterval(autoplayTimer);
}

function togglePlayPause() {
  if (isPlaying) {
    stopAutoplay();
  } else {
    // If at the end, restart from 0
    if (activeStep === conversionSteps.length - 1) selectStep(0);
    startAutoplay();
  }
}
// ------------------------------

function selectStep(idx){
  activeStep = idx;
  
  document.getElementById('step-nav').innerText = `${idx + 1} / ${conversionSteps.length}`;
  document.getElementById('btn-prev').disabled = (idx === 0);
  document.getElementById('btn-next').disabled = (idx === conversionSteps.length - 1);

  const s = conversionSteps[idx];
  document.getElementById('sd-title').textContent = s.title;
  document.getElementById('sd-body').innerHTML = `<span class="step-detail-badge">${s.badge}</span><br><pre style="margin:0;white-space:pre-wrap;font-family:inherit;">${esc(s.detail)}</pre>`;
  
  const activeIds = new Set();
  for(let i=0; i<=idx; i++) conversionSteps[i].transIds.forEach(id => activeIds.add(id));
  const currentIds = new Set(s.transIds);
  
  drawPDAStep(currentPDA, 'vis-wrap-cfg', activeIds, currentIds);
  highlightTableRows(activeIds, currentIds);
}

// Modified to accept manual override
function prevStep() { 
  stopAutoplay(); // Manual control stops autoplay
  if (activeStep > 0) selectStep(activeStep - 1); 
}

function nextStep(isManual = true) { 
  if (isManual) stopAutoplay(); // Manual control stops autoplay
  if (activeStep < conversionSteps.length - 1) selectStep(activeStep + 1); 
}

function drawPDAStep(pda, wrapId, activeIds, currentIds){
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;

  const W = 850, H = 450; 
  const cLine = '#141a12'; 
  const cFaded = 'rgba(20, 26, 18, 0.15)';
  const cTeal = '#0ed78b';
  
  const grouped = {};
  pda.transitions.forEach(t => {
    const key = `${t.from}→${t.to}`;
    if(!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  });

  let out = `<defs>
  <marker id="arr-fade" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 2L8 5L1 8" fill="none" stroke="${cFaded}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>
  <marker id="arr-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 2L8 5L1 8" fill="none" stroke="${cLine}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
  <marker id="arr-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 2L8 5L1 8" fill="none" stroke="${cTeal}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></marker>
  </defs>`;

  const POS = { q_initial:{x:120,y:280}, q_loop:{x:425,y:280}, q_final:{x:730,y:280} };
  const R = 45;

  out += `<line x1="20" y1="${POS.q_initial.y}" x2="${POS.q_initial.x - R - 5}" y2="${POS.q_initial.y}" stroke="${cLine}" stroke-width="2.5" marker-end="url(#arr-solid)"/>`;

  Object.entries(grouped).forEach(([key, trans]) => {
    const [from, to] = key.split('→');
    const p1 = POS[from], p2 = POS[to];
    if(!p1 || !p2) return;

    const hasActive = trans.some(t => activeIds.has(t.id));
    const hasCurrent = trans.some(t => currentIds.has(t.id));

    const eColor = hasCurrent ? cTeal : hasActive ? cLine : cFaded;
    const eWidth = hasCurrent ? 4 : hasActive ? 2.5 : 1.5;
    const marker = hasCurrent ? 'url(#arr-active)' : hasActive ? 'url(#arr-solid)' : 'url(#arr-fade)';

    if (from === to) {
      // Loop
      const cx = p1.x, cy = p1.y, loopR = 70;
      out += `<path d="M${cx-25},${cy-R} C${cx-loopR*2},${cy-loopR*3.2} ${cx+loopR*2},${cy-loopR*3.2} ${cx+25},${cy-R}" fill="none" stroke="${eColor}" stroke-width="${eWidth}" marker-end="${marker}"/>`;
      
      const baseY = cy - R - loopR - 25; 
      trans.forEach((t, li) => {
        if(!activeIds.has(t.id) && !currentIds.has(t.id)) return;
        const isCur = currentIds.has(t.id);
        const fw = isCur ? '800' : '600';
        const bg = isCur ? `<rect x="${cx-45}" y="${baseY - li*20 - 12}" width="90" height="18" fill="${cTeal}" rx="4"/>` : '';
        out += bg + `<text x="${cx}" y="${baseY - li*20}" text-anchor="middle" style="font-size:12px;fill:${cLine};font-family:var(--font-mono);font-weight:${fw}">${t.input},${t.stackTop}/${t.push}</text>`;
      });
    } else {
      // Straight Arrow
      const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.sqrt(dx*dx + dy*dy);
      const x1 = p1.x + dx/len * R, y1 = p1.y + dy/len * R;
      const x2 = p2.x - dx/len * (R+5), y2 = p2.y - dy/len * (R+5);
      out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${eColor}" stroke-width="${eWidth}" marker-end="${marker}"/>`;
      
      const mx = (x1+x2)/2, my = (y1+y2)/2;
      trans.forEach((t, li) => {
        if(!activeIds.has(t.id) && !currentIds.has(t.id)) return;
        const isCur = currentIds.has(t.id);
        const fw = isCur ? '800' : '600';
        const bg = isCur ? `<rect x="${mx-45}" y="${my - 28 - li*20}" width="90" height="18" fill="${cTeal}" rx="4"/>` : '';
        out += bg + `<text x="${mx}" y="${my - 16 - li*20}" text-anchor="middle" style="font-size:12px;fill:${cLine};font-family:var(--font-mono);font-weight:${fw}">${t.input},${t.stackTop}/${t.push}</text>`;
      });
    }
  });

  pda.states.forEach(s => {
    const pos = POS[s];
    const isStart = s === pda.start;
    const isAcc = pda.accept.includes(s);
    out += `<circle cx="${pos.x}" cy="${pos.y}" r="${R}" fill="#ffffff" stroke="${cLine}" stroke-width="3"/>`;
    if(isAcc) out += `<circle cx="${pos.x}" cy="${pos.y}" r="${R-6}" fill="none" stroke="${cLine}" stroke-width="2"/>`;
    if(isStart) out += `<circle cx="${pos.x}" cy="${pos.y}" r="${R}" fill="${cLine}" stroke="none"/>`;
    out += `<text x="${pos.x}" y="${pos.y+4}" text-anchor="middle" dominant-baseline="central" style="font-size:16px;fill:${isStart ? '#fff' : cLine};font-family:var(--font-mono);font-weight:800">${s}</text>`;
  });

  wrap.innerHTML = `<svg class="pda-diagram" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
}

function buildTransTable(pda){
  let html = `<table class="trans-table"><thead><tr><th>ID</th><th>From</th><th>In</th><th>Top</th><th>To</th><th>Push</th></tr></thead><tbody>`;
  pda.transitions.forEach(t => {
    html += `<tr id="trow_${t.id}"><td>${t.id}</td><td>${t.from}</td><td>${t.input}</td><td>${t.stackTop}</td><td>${t.to}</td><td>${t.push}</td></tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function highlightTableRows(activeIds, currentIds){
  document.querySelectorAll('.trans-table tr[id]').forEach(row => {
    const id = row.id.replace('trow_','');
    row.classList.remove('highlight-row');
    if(currentIds.has(id)){
      row.classList.add('highlight-row');
      row.style.opacity = '1';
      const container = row.closest('.table-scroll');
      if (container) {
        const offsetTop = row.offsetTop;
        const scrollOffset = offsetTop - (container.clientHeight / 2) + (row.clientHeight / 2);
        container.scrollTo({ top: scrollOffset, behavior: 'smooth' });
      }
    } else if(activeIds.has(id)){
      row.style.opacity = '1';
    } else {
      row.style.opacity = '0.3';
    }
  });
}

function buildFormalDef(pda){
  let h = `<div style="font-family:var(--font-mono); font-size:12px; font-weight:700; line-height:1.8;">`;
  h += `<strong>Q:</strong> { ${pda.states.join(', ')} }<br>`;
  h += `<strong>Σ:</strong> { ${pda.inputAlphabet.join(', ')} }<br>`;
  h += `<strong>Γ:</strong> { ${pda.stackAlphabet.join(', ')} }<br>`;
  h += `<strong>q₀:</strong> ${pda.start}<br>`;
  h += `<strong>F:</strong> { ${pda.accept.join(', ')} }</div>`;
  return h;
}

// =========================================================
// STRING SIMULATOR
// =========================================================
function simulatePDA(){
  if(!currentPDA) return;
  const inputStr = document.getElementById('sim-input').value.trim();
  const result = runPDA(currentPDA, inputStr);
  const div = document.getElementById('sim-result');
  let html = '';
  
  if(result.accepted){
    html += `<div style="display:flex; align-items:center; gap:8px;"><span class="badge badge-green">ACCEPTED</span> <span style="font-size:13px; font-weight:800; color:var(--text-main)">Valid syntax</span></div>`;
  } else {
    html += `<div style="display:flex; align-items:center; gap:8px;"><span class="badge badge-red">REJECTED</span> <span style="font-size:13px; font-weight:800; color:var(--text-main)">Invalid syntax</span></div>`;
  }
  
  if(result.trace && result.trace.length){
    html += `<div style="max-height: 150px; overflow-y: auto; margin-top: 12px; border: 2px solid var(--border-dark); border-radius: var(--radius-sm);"><table class="sim-trace" style="margin-top: 0; border: none;"><thead><tr><th style="position: sticky; top: 0;">#</th><th style="position: sticky; top: 0;">State</th><th style="position: sticky; top: 0;">Input Rem</th><th style="position: sticky; top: 0;">Stack (top→)</th></tr></thead><tbody>`;
    result.trace.forEach((step, i) => {
      html += `<tr><td>${i+1}</td><td>${esc(step.state)}</td><td>${esc(step.input||'ε')}</td><td>${esc(step.stack.slice().reverse().join('')||'ε')}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }
  div.innerHTML = html;
}

function runPDA(pda, inputStr){
  const input = inputStr.split('');
  const init = {state:'q_initial', input:[...input], stack:[], trace:[{state:'q_initial', input:inputStr, stack:[], action:'Init'}]};
  const queue = [init]; 
  const visited = new Set();
  
  for(let iter=0; iter<5000 && queue.length; iter++){
    const cfg = queue.shift();
    const k = `${cfg.state}|${cfg.input.join('')}|${cfg.stack.join('')}`;
    if(visited.has(k)) continue; visited.add(k);
    if(pda.accept.includes(cfg.state) && cfg.input.length===0) return {accepted:true, trace:cfg.trace};
    
    for(const t of pda.transitions){
      if(t.from !== cfg.state) continue;
      if(t.input !== 'ε' && (!cfg.input.length || cfg.input[0] !== t.input)) continue;
      if(t.stackTop !== 'ε' && (!cfg.stack.length || cfg.stack[cfg.stack.length-1] !== t.stackTop)) continue;
      
      const ni = t.input !== 'ε' ? cfg.input.slice(1) : [...cfg.input];
      let ns = [...cfg.stack];
      if(t.stackTop !== 'ε') ns.pop();
      if(t.push !== 'ε'){
        const pc = t.push.split('').filter(c=>c);
        for(let i=pc.length-1; i>=0; i--) ns.push(pc[i]);
      }
      
      const action = `δ(${t.from}, ${t.input}, ${t.stackTop}) → (${t.to}, ${t.push})`;
      const nt = [...cfg.trace, {state:t.to, input:ni.join(''), stack:[...ns], action}];
      if(nt.length < 30) queue.push({state:t.to, input:ni, stack:ns, trace:nt});
    }
  }
  return {accepted:false, trace:[]};
}

// =========================================================
// PDA → CFG
// =========================================================
function convertPDAtoCFG(){
  clearErr('pda-error');
  const statesRaw = document.getElementById('pda-states').value.trim();
  const startRaw = document.getElementById('pda-start').value.trim();
  const acceptRaw = document.getElementById('pda-accept').value.trim();
  const transRaw = document.getElementById('pda-trans-input').value.trim();
  
  if(!statesRaw || !startRaw || !transRaw){ showErr('pda-error','Fill all fields.'); return; }
  
  const states = statesRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const startState = startRaw.trim();
  const acceptStates = acceptRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const trans = [];
  
  for(const line of transRaw.split('\n').filter(l=>l.trim())){
    const m = line.match(/^(\S+)\s*,\s*(\S+)\s*,\s*(\S+)\s*[→\->]+\s*(\S+)\s*,\s*(\S+)$/);
    if(!m){ showErr('pda-error',`Bad format: ${line}`); return; }
    trans.push({from:m[1], input:m[2]==='ε'?'ε':m[2], stackTop:m[3]==='ε'?'ε':m[3], to:m[4], push:m[5]==='ε'?'ε':m[5]});
  }
  
  const {productions, steps} = pdaTripleConstruction(states, startState, acceptStates, trans);
  const grouped = {};
  productions.forEach(p => { if(!grouped[p.lhs]) grouped[p.lhs]=[]; grouped[p.lhs].push(p.rhs); });
  
  let html = `<div style="font-family:var(--font-mono); font-size:13px; font-weight:700; line-height: 1.8; padding: 16px;">`;
  Object.entries(grouped).forEach(([lhs, rhss]) => {
    html += `<div style="padding:4px 0; border-bottom: 1px dashed var(--border-dark);"><strong>${esc(lhs)}</strong> → ${rhss.map(r=>esc(r||'ε')).join(' | ')}</div>`;
  });
  html += `</div>`;
  
  document.getElementById('pda2cfg-result').innerHTML = html;
  document.getElementById('pda2cfg-steps-inner').innerHTML = steps;
  
  document.getElementById('pda-empty-state').style.display = 'none';
  document.getElementById('pda2cfg-result-wrap').style.display = 'flex';
}

function pdaTripleConstruction(states, start, accepts, trans){
  const productions = [];
  accepts.forEach(acc => productions.push({lhs:'S', rhs:`A[${start},${acc}]`}));
  
  states.forEach(p => states.forEach(q => states.forEach(r => { 
    if(p!==q) productions.push({lhs:`A[${p},${q}]`, rhs:`A[${p},${r}] A[${r},${q}]`});
  })));
  
  trans.forEach(t1 => {
    if(t1.push==='ε') return;
    const sym = t1.push;
    trans.forEach(t2 => {
      if(t2.stackTop!==sym || t2.push!=='ε') return;
      const a = t1.input==='ε' ? '' : t1.input;
      const b = t2.input==='ε' ? '' : t2.input;
      const inner = `A[${t1.to},${t2.from}]`;
      const rhs = [a, inner, b].filter(Boolean).join(' ');
      productions.push({lhs:`A[${t1.from},${t2.to}]`, rhs:rhs||'ε'});
    });
  });
  states.forEach(p => productions.push({lhs:`A[${p},${p}]`, rhs:'ε'}));
  
  const stepsHtml = `
    <div style="padding: 16px;">
      <div style="font-family:var(--font-mono); font-size:12px; font-weight: 700; margin-bottom: 12px; border-bottom: 2px solid var(--border-dark); padding-bottom:8px;"><strong>1. Starts:</strong> S → A[${start}, q_acc]</div>
      <div style="font-family:var(--font-mono); font-size:12px; font-weight: 700; margin-bottom: 12px; border-bottom: 2px solid var(--border-dark); padding-bottom:8px;"><strong>2. Splits:</strong> A[p,q] → A[p,r] A[r,q]</div>
      <div style="font-family:var(--font-mono); font-size:12px; font-weight: 700; margin-bottom: 12px; border-bottom: 2px solid var(--border-dark); padding-bottom:8px;"><strong>3. Matched pairs:</strong> ${trans.length} checks</div>
      <div style="font-family:var(--font-mono); font-size:12px; font-weight: 700;"><strong>Total Productions:</strong> ${productions.length}</div>
    </div>
  `;
  return {productions, steps:stepsHtml};
}

// =========================================================
// INIT / EXAMPLES
// =========================================================
const examples = {
  default: `S → 0BB\nB → 0S | 1S | 0`,
  anbn: `S → aSb | ε`,
  palindrome: `S → aSa | bSb | a | b | ε`,
  expr: `E → E+T | T\nT → T*F | F\nF → (E) | a`,
  balanced: `S → SS | (S) | ε`,
  equalAB: `S → aSbS | bSaS | ε`
};

function loadExample(n){ document.getElementById('cfg-input').value = examples[n] || ''; }

const pdaExamples = {
  anbn: {
    states: 'q0,q1,q2', 
    start: 'q0', 
    accept: 'q2', 
    trans: `q0,a,Z → q0,AZ\nq0,a,A → q0,AA\nq0,b,A → q1,ε\nq1,b,A → q1,ε\nq1,ε,Z → q2,Z`
  },
  simple: {
    states: 'q0,q1', 
    start: 'q0', 
    accept: 'q1', 
    trans: `q0,a,ε → q0,A\nq0,ε,ε → q1,ε`
  },
  palindrome: {
    states: 'q0,q1,q2',
    start: 'q0',
    accept: 'q2',
    trans: `q0,a,ε → q0,a\nq0,b,ε → q0,b\nq0,ε,ε → q1,ε\nq0,a,ε → q1,ε\nq0,b,ε → q1,ε\nq1,a,a → q1,ε\nq1,b,b → q1,ε\nq1,ε,Z → q2,ε`
  }
};

function loadPDAExample(n){
  const ex = pdaExamples[n]; if(!ex) return;
  document.getElementById('pda-states').value = ex.states;
  document.getElementById('pda-start').value = ex.start;
  document.getElementById('pda-accept').value = ex.accept;
  document.getElementById('pda-trans-input').value = ex.trans;
}

function clearCFG(){
  stopAutoplay();
  document.getElementById('cfg-input').value = '';
  document.getElementById('cfg-parsed-out').innerHTML = 'Awaiting grammar input...';
  document.getElementById('cfg-parsed-out').classList.add('empty-state');
  document.getElementById('pda-result').style.display = 'none';
  document.getElementById('cfg-empty-state').style.display = 'flex';
  clearErr('cfg-error');
}

function clearPDA(){
  ['pda-states','pda-start','pda-accept','pda-trans-input'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pda2cfg-result-wrap').style.display = 'none';
  document.getElementById('pda-empty-state').style.display = 'flex';
  clearErr('pda-error');
}

// Initialize on page load
loadExample('default');
convertCFGtoPDA();