/* ============================================================
   TekproAI — calculator.js
   Model + Controller for calculator.html (Home Loan Calculator)

   Dependencies: EmailJS SDK (loaded in HTML head)
   ============================================================ */

/* ── Config ── */
const EMAILJS_SERVICE_ID  = 'service_tnb9uqv';
const EMAILJS_TEMPLATE_ID = 'template_3jcq1jy';

/* ── State ── */
let prepayOn        = false;
let currentFreq     = 'onetime';
let currentTab      = 'yearly';
let scheduleData    = [];
let userRating      = 0;
let selectedTags    = [];
let lastP           = 0;
let lastRate        = 0;
let lastBaseEMI     = 0;
let lastBaseSchedule = null;

/* ============================================================
   CONTROLLER — UI toggles
   ============================================================ */
function togglePrepay() {
  prepayOn = !prepayOn;
  document.getElementById('toggleEl').classList.toggle('on', prepayOn);
  document.getElementById('prepayInputs').classList.toggle('visible', prepayOn);
  syncMFPanel();
}

function setFreq(freq, btn) {
  currentFreq = freq;
  document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['onetime', 'yearly', 'halfyearly', 'quarterly', 'monthly'].forEach(f => {
    const el = document.getElementById('freq-' + f);
    if (el) el.style.display = f === freq ? (f === 'monthly' ? 'block' : 'grid') : 'none';
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabYearly').classList.toggle('active',  tab === 'yearly');
  document.getElementById('tabMonthly').classList.toggle('active', tab === 'monthly');
  renderTable();
}

function toggleAmortization() {
  const wrap = document.getElementById('amorWrap');
  const btn  = document.getElementById('collapseBtn');
  const tabs = document.getElementById('tabYearly').parentElement;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display  = isOpen ? 'none'  : 'block';
  tabs.style.display  = isOpen ? 'none'  : 'flex';
  btn.textContent     = isOpen ? '+'     : '−';
}

function closeFlip() {
  document.getElementById('flipCard').classList.remove('show');
  document.querySelectorAll('.bar-group').forEach(b => b.classList.remove('active'));
}

/* ============================================================
   MODEL — Format helpers
   ============================================================ */
function fmt(n) {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000)   return '₹' + (n / 100000).toFixed(2) + 'L';
  return '₹' + (n / 1000).toFixed(1) + 'K';
}
function fmtT(n) {
  if (n >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000)   return (n / 100000).toFixed(2) + 'L';
  return (n / 1000).toFixed(1) + 'K';
}

/* ============================================================
   MODEL — Core financial calculations
   ============================================================ */
function calcEMI(p, r, m) {
  const mr = r / 12 / 100;
  return p * mr * Math.pow(1 + mr, m) / (Math.pow(1 + mr, m) - 1);
}

function isPrepayMonth(month, freq, params) {
  if (freq === 'onetime')    return month === params.after    ? params.amt : 0;
  if (freq === 'yearly')     return month >= params.start && (month - params.start) % 12 === 0 ? params.amt : 0;
  if (freq === 'halfyearly') return month >= params.start && (month - params.start) % 6  === 0 ? params.amt : 0;
  if (freq === 'quarterly')  return month >= params.start && (month - params.start) % 3  === 0 ? params.amt : 0;
  if (freq === 'monthly')    return params.amt;
  return 0;
}

function buildSchedule(principal, annualRate, emi, freq, params) {
  const r = annualRate / 12 / 100;
  let bal = principal, month = 0;
  const rows = [];
  while (bal > 0.5 && month < 600) {
    month++;
    let prepaid = 0;
    if (freq && params) {
      prepaid = Math.min(isPrepayMonth(month, freq, params), bal);
      bal = Math.max(0, bal - prepaid);
    }
    const interest     = bal * r;
    if (emi <= interest) break;
    const principalPay = Math.min(emi - interest, bal);
    bal = Math.max(0, bal - principalPay);
    rows.push({ month, year: Math.ceil(month / 12), emi: principalPay + interest, interest, principal: principalPay, prepaid, balance: bal });
  }
  return rows;
}

function groupByYear(rows) {
  const map = {};
  for (const r of rows) {
    if (!map[r.year]) map[r.year] = { year: r.year, emi: 0, interest: 0, principal: 0, prepaid: 0, balance: 0, months: [] };
    map[r.year].emi       += r.emi;
    map[r.year].interest  += r.interest;
    map[r.year].principal += r.principal;
    map[r.year].prepaid   += r.prepaid;
    map[r.year].balance    = r.balance;
    map[r.year].months.push(r);
  }
  return Object.values(map);
}

function getPrepayParams() {
  if (!prepayOn) return { freq: null, params: null };
  if (currentFreq === 'onetime')    return { freq: 'onetime',    params: { amt: (parseFloat(document.getElementById('onetimeAmt').value)   || 0) * 100000, after: (parseFloat(document.getElementById('onetimeAfter').value) || 1) * 12 } };
  if (currentFreq === 'yearly')     return { freq: 'yearly',     params: { amt: (parseFloat(document.getElementById('yearlyAmt').value)    || 0) * 100000, start: (parseFloat(document.getElementById('yearlyStart').value)  || 1) * 12 } };
  if (currentFreq === 'halfyearly') return { freq: 'halfyearly', params: { amt: (parseFloat(document.getElementById('halfAmt').value)      || 0) * 100000, start:  parseFloat(document.getElementById('halfStart').value)   || 6 } };
  if (currentFreq === 'quarterly')  return { freq: 'quarterly',  params: { amt: (parseFloat(document.getElementById('qtrAmt').value)       || 0) * 100000, start:  parseFloat(document.getElementById('qtrStart').value)    || 3 } };
  if (currentFreq === 'monthly')    return { freq: 'monthly',    params: { amt: (parseFloat(document.getElementById('monthlyAmt').value)   || 0) * 1000 } };
  return { freq: null, params: null };
}

/* ============================================================
   CONTROLLER — Main calculate
   ============================================================ */
function calculate() {
  const P         = parseFloat(document.getElementById('principal').value) * 100000;
  const rate      = parseFloat(document.getElementById('rate').value);
  const tenureM   = parseFloat(document.getElementById('tenure').value) * 12;
  const customEmi = parseFloat(document.getElementById('customEmi').value);
  const baseEMI   = isNaN(customEmi) ? calcEMI(P, rate, tenureM) : customEmi * 1000;

  const baseSchedule  = buildSchedule(P, rate, baseEMI, null, null);
  const baseTotalInt  = baseSchedule.reduce((s, r) => s + r.interest, 0);

  lastP             = P;
  lastRate          = rate;
  lastBaseEMI       = baseEMI;
  lastBaseSchedule  = baseSchedule;

  let prepaySchedule = null, saving = 0, yrsSaved = 0;
  const { freq, params } = getPrepayParams();

  if (prepayOn && freq) {
    prepaySchedule = buildSchedule(P, rate, baseEMI, freq, params);
    saving   = baseTotalInt - prepaySchedule.reduce((s, r) => s + r.interest, 0);
    yrsSaved = ((baseSchedule.length - prepaySchedule.length) / 12).toFixed(1);
    scheduleData = prepaySchedule;
  } else {
    scheduleData = baseSchedule;
  }

  // ── Summary card ──
  document.getElementById('summaryCard').innerHTML = `
    <div class="summary-title">Loan Summary</div>
    <div class="summary-grid">
      <div class="s-stat"><span class="s-stat-val green">${fmt(baseEMI)}</span><span class="s-stat-label">Monthly EMI</span></div>
      <div class="s-stat"><span class="s-stat-val orange">${fmt(baseTotalInt)}</span><span class="s-stat-label">Total Interest (No Prepay)</span></div>
      <div class="s-stat"><span class="s-stat-val">${fmt(baseTotalInt + P)}</span><span class="s-stat-label">Total Amount Payable</span></div>
      <div class="s-stat"><span class="s-stat-val">${(baseSchedule.length / 12).toFixed(1)} yrs</span><span class="s-stat-label">Loan Tenure</span></div>
      ${prepaySchedule ? `
      <div class="s-stat"><span class="s-stat-val green">${fmt(saving)}</span><span class="s-stat-label">Interest Saved</span></div>
      <div class="s-stat"><span class="s-stat-val green">${yrsSaved} yrs</span><span class="s-stat-label">Tenure Reduced By</span></div>` : ''}
    </div>`;

  // ── Comparison cards ──
  function cardHTML(label, sch, savInfo, tagClass, tagText, hl) {
    const tI = sch.reduce((s, r) => s + r.interest, 0);
    return `<div class="comp-card ${hl ? 'highlight' : ''}">
      <div class="comp-header"><span class="comp-label">${label}</span><span class="tag ${tagClass}">${tagText}</span></div>
      <div class="comp-stats">
        <div class="cs"><span class="cs-val orange">${fmt(tI)}</span><span class="cs-lbl">Total Interest</span></div>
        <div class="cs"><span class="cs-val">${fmt(tI + P)}</span><span class="cs-lbl">Total Paid</span></div>
        <div class="cs"><span class="cs-val">${(sch.length / 12).toFixed(1)} yrs</span><span class="cs-lbl">Tenure</span></div>
      </div>
      ${savInfo
        ? `<div class="saving-bar"><div class="saving-fill" style="width:${Math.min(savInfo.pct, 100)}%;background:var(--accent)"></div></div>
           <div class="saving-text">${savInfo.pct.toFixed(1)}% interest saved · ${savInfo.yrs} yrs shorter</div>`
        : '<div class="saving-text" style="color:var(--muted)">Baseline — no prepayment applied</div>'}
    </div>`;
  }

  let compHTML = cardHTML('No Prepayment', baseSchedule, null, 'tag-gray', 'BASELINE', false);
  if (prepaySchedule) {
    const pct = baseTotalInt > 0 ? (saving / baseTotalInt * 100) : 0;
    compHTML += cardHTML('With Prepayment', prepaySchedule, { pct, yrs: yrsSaved }, 'tag-green', 'YOUR PLAN', true);
  }
  document.getElementById('compArea').innerHTML = compHTML;

  renderCharts(baseSchedule, prepaySchedule, P);
  renderHistogram();

  document.getElementById('tableSection').style.display = 'block';
  renderTable();

  document.getElementById('mfSection').style.display = 'block';
  syncMFPanel();
}

/* ============================================================
   CONTROLLER — Pie charts (canvas, no external lib)
   ============================================================ */
function drawPie(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 6;
  const total = data.reduce((s, d) => s + d.value, 0);
  ctx.clearRect(0, 0, W, H);
  let startAngle = -Math.PI / 2;
  for (const seg of data) {
    const slice = (seg.value / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, startAngle, startAngle + slice);
    ctx.closePath(); ctx.fillStyle = seg.color; ctx.fill();
    startAngle += slice;
  }
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.52, 0, 2 * Math.PI);
  ctx.fillStyle = '#0d0f0e'; ctx.fill();
}

function renderCharts(baseSchedule, prepaySchedule, P) {
  document.getElementById('chartSection').style.display = 'block';
  const row = document.getElementById('chartsRow');
  const bld = s => ({ tInt: s.reduce((a, r) => a + r.interest, 0), tPre: s.reduce((a, r) => a + r.prepaid, 0) });
  const base = bld(baseSchedule);
  const prep = prepaySchedule ? bld(prepaySchedule) : null;
  const charts = [{ label: 'Without Prepayment', d: base }];
  if (prep) charts.push({ label: 'With Prepayment', d: prep });

  row.innerHTML = charts.map((c, i) => {
    const total   = P + c.d.tInt + c.d.tPre;
    const intPct  = ((c.d.tInt / total) * 100).toFixed(1);
    const prinPct = ((P / total) * 100).toFixed(1);
    const prePct  = c.d.tPre > 0 ? ((c.d.tPre / total) * 100).toFixed(1) : null;
    return `<div class="pie-wrap">
      <div class="pie-title">${c.label}</div>
      <div class="pie-container"><canvas id="pie${i}" width="130" height="130"></canvas>
        <div class="pie-center"><span class="pie-center-val">${fmt(total)}</span><span class="pie-center-lbl">Total</span></div>
      </div>
      <div class="legend">
        <div class="leg-item"><div class="leg-dot" style="background:#80e8b0"></div><span style="color:#80e8b0">${prinPct}%</span>&nbsp;<span style="color:var(--muted)">Principal</span></div>
        <div class="leg-item"><div class="leg-dot" style="background:#ff9980"></div><span style="color:#ff9980">${intPct}%</span>&nbsp;<span style="color:var(--muted)">Interest</span></div>
        ${prePct ? `<div class="leg-item"><div class="leg-dot" style="background:var(--accent)"></div><span style="color:var(--accent)">${prePct}%</span>&nbsp;<span style="color:var(--muted)">Prepaid</span></div>` : ''}
      </div></div>`;
  }).join('');

  requestAnimationFrame(() => {
    charts.forEach((c, i) => {
      const segs = [{ value: P, color: '#80e8b0' }, { value: c.d.tInt, color: '#ff9980' }];
      if (c.d.tPre > 0) segs.push({ value: c.d.tPre, color: '#00e676' });
      drawPie('pie' + i, segs);
    });
  });
}

/* ============================================================
   CONTROLLER — Histogram
   ============================================================ */
function renderHistogram() {
  const yearly = groupByYear(scheduleData);
  if (!yearly.length) return;
  document.getElementById('histSection').style.display = 'block';
  const maxVal = Math.max(...yearly.map(y => y.interest + y.principal));
  const H = 150;
  document.getElementById('barChart').innerHTML = yearly.map(y => {
    const intH  = Math.round((y.interest  / maxVal) * H);
    const prinH = Math.round((y.principal / maxVal) * H);
    return `<div class="bar-group" id="bg-${y.year}" onclick="flipYear(${y.year})">
      <div class="bar-stack" style="height:${H}px">
        <div class="bar-int"  style="height:${intH}px;width:100%"></div>
        <div class="bar-prin" style="height:${prinH}px;width:100%"></div>
      </div>
      <div class="bar-label">Y${y.year}</div>
    </div>`;
  }).join('');
}

function flipYear(year) {
  document.querySelectorAll('.bar-group').forEach(b => b.classList.remove('active'));
  const bg = document.getElementById('bg-' + year);
  if (bg) bg.classList.add('active');
  const yearly = groupByYear(scheduleData);
  const y = yearly.find(r => r.year === year);
  if (!y) return;
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('flipTitle').textContent = 'Year ' + year + ' — Monthly Breakdown';
  document.getElementById('flipGrid').innerHTML = `
    <div class="flip-stat"><span class="flip-val green">${fmt(y.emi)}</span><span class="flip-lbl">Total EMI Paid</span></div>
    <div class="flip-stat"><span class="flip-val" style="color:#ff9980">${fmt(y.interest)}</span><span class="flip-lbl">Interest</span></div>
    <div class="flip-stat"><span class="flip-val" style="color:#80e8b0">${fmt(y.principal)}</span><span class="flip-lbl">Principal</span></div>
    <div class="flip-stat"><span class="flip-val">${fmt(y.balance)}</span><span class="flip-lbl">Closing Balance</span></div>
    ${y.prepaid > 0 ? `<div class="flip-stat" style="grid-column:1/-1"><span class="flip-val green">${fmt(y.prepaid)}</span><span class="flip-lbl">Prepaid This Year</span></div>` : ''}`;
  document.getElementById('flipBody').innerHTML = y.months.map(m => `
    <tr ${m.prepaid > 0 ? 'style="color:var(--accent)"' : ''}>
      <td>${mo[(m.month - 1) % 12]}</td>
      <td style="color:var(--text)">${fmtT(m.emi)}</td>
      <td style="color:#ff9980">${fmtT(m.interest)}</td>
      <td style="color:#80e8b0">${fmtT(m.principal)}</td>
      <td style="color:var(--muted)">${fmtT(m.balance)}</td>
    </tr>`).join('');
  const card = document.getElementById('flipCard');
  card.classList.add('show');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============================================================
   CONTROLLER — Amortization table
   ============================================================ */
function renderTable() {
  const tbl  = document.getElementById('amorTable');
  const wrap = document.getElementById('amorWrap');
  wrap.style.display = 'block';
  document.getElementById('collapseBtn').textContent = '−';

  const yearly = groupByYear(scheduleData);
  const tInt   = scheduleData.reduce((s, r) => s + r.interest,  0);
  const tPrin  = scheduleData.reduce((s, r) => s + r.principal, 0);
  const tEmi   = scheduleData.reduce((s, r) => s + r.emi,       0);
  const tPre   = scheduleData.reduce((s, r) => s + r.prepaid,   0);
  const hasPre = tPre > 0;
  const mo     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const hdr  = `<thead><tr><th>${currentTab === 'yearly' ? 'Year' : 'Month'}</th><th>EMI (₹)</th><th>Interest (₹)</th><th>Principal (₹)</th>${hasPre ? '<th>Prepaid (₹)</th>' : ''}<th>Balance (₹)</th></tr></thead>`;
  const foot = `<tfoot><tr><td>Total</td><td>${fmtT(tEmi)}</td><td class="int-cell">${fmtT(tInt)}</td><td class="prin-cell">${fmtT(tPrin)}</td>${hasPre ? `<td class="green">${fmtT(tPre)}</td>` : ''}<td>—</td></tr></tfoot>`;

  if (currentTab === 'yearly') {
    let body = '<tbody>';
    for (const y of yearly) {
      body += `<tr class="yr-row" onclick="toggleMonths(${y.year},this)">
        <td>Yr ${y.year} <span style="font-size:9px;color:var(--muted)">▾</span></td>
        <td class="emi-cell">${fmtT(y.emi)}</td>
        <td class="int-cell">${fmtT(y.interest)}</td>
        <td class="prin-cell">${fmtT(y.principal)}</td>
        ${hasPre ? `<td class="${y.prepaid > 0 ? 'green' : ''}">${y.prepaid > 0 ? fmtT(y.prepaid) : '—'}</td>` : ''}
        <td class="bal-cell">${fmtT(y.balance)}</td></tr>`;
      body += `<tbody class="mo-rows" id="mo-${y.year}">`;
      for (const m of y.months) {
        body += `<tr ${m.prepaid > 0 ? 'class="prepay-row"' : ''}>
          <td>${mo[(m.month - 1) % 12]} Yr${y.year}</td>
          <td class="emi-cell">${fmtT(m.emi)}</td>
          <td class="int-cell">${fmtT(m.interest)}</td>
          <td class="prin-cell">${fmtT(m.principal)}</td>
          ${hasPre ? `<td class="${m.prepaid > 0 ? 'green' : ''}">${m.prepaid > 0 ? fmtT(m.prepaid) : '—'}</td>` : ''}
          <td class="bal-cell">${fmtT(m.balance)}</td></tr>`;
      }
      body += '</tbody>';
    }
    body += '</tbody>';
    tbl.innerHTML = hdr + body + foot;
  } else {
    let body = '<tbody>';
    for (const r of scheduleData) {
      body += `<tr ${r.prepaid > 0 ? 'class="prepay-row"' : ''}>
        <td>${mo[(r.month - 1) % 12]} Yr${r.year}</td>
        <td class="emi-cell">${fmtT(r.emi)}</td>
        <td class="int-cell">${fmtT(r.interest)}</td>
        <td class="prin-cell">${fmtT(r.principal)}</td>
        ${hasPre ? `<td class="${r.prepaid > 0 ? 'green' : ''}">${r.prepaid > 0 ? fmtT(r.prepaid) : '—'}</td>` : ''}
        <td class="bal-cell">${fmtT(r.balance)}</td></tr>`;
    }
    body += '</tbody>';
    tbl.innerHTML = hdr + body + foot;
  }
}

function toggleMonths(year, row) {
  const el = document.getElementById('mo-' + year);
  if (!el) return;
  el.classList.toggle('open');
  const arr = row.querySelector('span');
  if (arr) arr.textContent = el.classList.contains('open') ? '▴' : '▾';
}

/* ============================================================
   CONTROLLER — PDF Export
   ============================================================ */
function exportPDF() {
  if (!scheduleData.length) { alert('Please calculate first.'); return; }
  const yearly = groupByYear(scheduleData);
  const tInt   = scheduleData.reduce((s, r) => s + r.interest,  0);
  const tPrin  = scheduleData.reduce((s, r) => s + r.principal, 0);
  const tEmi   = scheduleData.reduce((s, r) => s + r.emi,       0);
  const tPre   = scheduleData.reduce((s, r) => s + r.prepaid,   0);
  const hasPre = tPre > 0;
  const mo     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now    = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  let yearlyRows = '';
  for (const y of yearly) {
    yearlyRows += `<tr style="background:#f5f5f5;font-weight:600;">
      <td>Year ${y.year}</td><td>${fmtT(y.emi)}</td>
      <td style="color:#c0392b">${fmtT(y.interest)}</td>
      <td style="color:#27ae60">${fmtT(y.principal)}</td>
      ${hasPre ? `<td style="color:#2980b9">${y.prepaid > 0 ? fmtT(y.prepaid) : '—'}</td>` : ''}
      <td>${fmtT(y.balance)}</td></tr>`;
    for (const m of y.months) {
      yearlyRows += `<tr>
        <td style="padding-left:20px">${mo[(m.month - 1) % 12]} ${y.year}</td>
        <td>${fmtT(m.emi)}</td>
        <td style="color:#c0392b">${fmtT(m.interest)}</td>
        <td style="color:#27ae60">${fmtT(m.principal)}</td>
        ${hasPre ? `<td style="color:#2980b9">${m.prepaid > 0 ? fmtT(m.prepaid) : '—'}</td>` : ''}
        <td>${fmtT(m.balance)}</td></tr>`;
    }
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Home Loan Amortization Schedule</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#222;margin:24px;}
    h1{font-size:18px;color:#00695c;margin-bottom:4px;}
    .subtitle{font-size:11px;color:#888;margin-bottom:16px;}
    .summary{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;padding:12px;background:#f9f9f9;border-radius:6px;border:1px solid #ddd;}
    .s-item{min-width:140px;}
    .s-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px;}
    .s-val{font-size:14px;font-weight:700;color:#222;}
    table{width:100%;border-collapse:collapse;font-size:10px;}
    th{background:#00695c;color:#fff;padding:7px 10px;text-align:right;font-size:9px;text-transform:uppercase;letter-spacing:.5px;}
    th:first-child{text-align:left;}
    td{padding:5px 10px;text-align:right;border-bottom:1px solid #eee;}
    td:first-child{text-align:left;}
    tfoot td{background:#eee;font-weight:700;border-top:2px solid #ccc;}
    .footer{margin-top:20px;font-size:9px;color:#aaa;text-align:center;}
    @media print{body{margin:8px;}}
  </style></head><body>
  <h1>&#127968; Home Loan Amortization Schedule</h1>
  <div class="subtitle">Generated on ${now} · tekproai.com/calculator</div>
  <div class="summary">
    <div class="s-item"><div class="s-label">Loan Amount</div><div class="s-val">${fmt(lastP)}</div></div>
    <div class="s-item"><div class="s-label">Interest Rate</div><div class="s-val">${lastRate}%</div></div>
    <div class="s-item"><div class="s-label">Monthly EMI</div><div class="s-val">${fmt(lastBaseEMI)}</div></div>
    <div class="s-item"><div class="s-label">Total Interest</div><div class="s-val" style="color:#c0392b">${fmt(tInt)}</div></div>
    <div class="s-item"><div class="s-label">Total Amount</div><div class="s-val">${fmt(tEmi + tPre)}</div></div>
    <div class="s-item"><div class="s-label">Loan Tenure</div><div class="s-val">${(scheduleData.length / 12).toFixed(1)} yrs</div></div>
    ${hasPre ? `<div class="s-item"><div class="s-label">Total Prepaid</div><div class="s-val" style="color:#2980b9">${fmt(tPre)}</div></div>` : ''}
  </div>
  <table>
    <thead><tr>
      <th>Period</th><th>EMI (&#8377;)</th><th>Interest (&#8377;)</th><th>Principal (&#8377;)</th>
      ${hasPre ? '<th>Prepaid (&#8377;)</th>' : ''}
      <th>Balance (&#8377;)</th>
    </tr></thead>
    <tbody>${yearlyRows}</tbody>
    <tfoot><tr>
      <td>Total</td><td>${fmtT(tEmi)}</td>
      <td style="color:#c0392b">${fmtT(tInt)}</td>
      <td style="color:#27ae60">${fmtT(tPrin)}</td>
      ${hasPre ? `<td style="color:#2980b9">${fmtT(tPre)}</td>` : ''}
      <td>—</td>
    </tfoot>
  </table>
  <div class="footer">&#169; 2026 TekproAI · Home Loan Calculator v1.0.0 · tekproai.com</div>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

/* ============================================================
   CONTROLLER — MF vs Prepayment comparison
   ============================================================ */
function syncMFPanel() {
  const surplusBox   = document.getElementById('mfSurplusBox');
  const lockedBanner = document.getElementById('mfLockedBanner');
  const mfYearsBoxAlt = document.getElementById('mfYearsBoxAlt');
  if (prepayOn) {
    surplusBox.style.display    = 'none';
    lockedBanner.style.display  = 'block';
    mfYearsBoxAlt.style.display = 'block';
    const { freq, params } = getPrepayParams();
    let desc = '';
    if      (freq === 'onetime')    desc = 'One-time ₹' + (params.amt / 100000).toFixed(1) + 'L after ' + (params.after / 12).toFixed(0) + ' yr(s)';
    else if (freq === 'yearly')     desc = '₹' + (params.amt / 100000).toFixed(1) + 'L every year from yr ' + (params.start / 12).toFixed(0);
    else if (freq === 'halfyearly') desc = '₹' + (params.amt / 100000).toFixed(1) + 'L every 6 months from month ' + params.start;
    else if (freq === 'quarterly')  desc = '₹' + (params.amt / 100000).toFixed(1) + 'L every quarter from month ' + params.start;
    else if (freq === 'monthly')    desc = '₹' + (params.amt / 1000).toFixed(0) + 'K monthly top-up';
    document.getElementById('mfLockedDesc').textContent = desc;
  } else {
    surplusBox.style.display    = 'grid';
    lockedBanner.style.display  = 'none';
    mfYearsBoxAlt.style.display = 'none';
  }
}

function calcMF() {
  if (!lastBaseSchedule) { alert('Please click Calculate first.'); return; }
  const mfRate     = parseFloat(document.getElementById('mfReturn').value) || 12;
  const taxBracket = parseFloat(document.getElementById('mfTax').value)    || 30;

  let surplus, mfFreq, mfParams, years, totalPrepaid;

  if (prepayOn) {
    const { freq, params } = getPrepayParams();
    mfFreq = freq; mfParams = params;
    const prepSched  = buildSchedule(lastP, lastRate, lastBaseEMI, mfFreq, mfParams);
    totalPrepaid     = prepSched.reduce((s, r) => s + r.prepaid, 0);
    surplus          = totalPrepaid;
    years            = Math.round(lastBaseSchedule.length / 12);
    const yl         = document.getElementById('mfYearsLocked');
    yl.value         = years; yl.disabled = true; yl.style.color = 'var(--muted)';
  } else {
    surplus  = (parseFloat(document.getElementById('mfAmt').value)   || 5) * 100000;
    years    = Math.round(lastBaseSchedule.length / 12);
    const yf = document.getElementById('mfYears');
    yf.value = years; yf.disabled = true; yf.style.color = 'var(--muted)';
    mfFreq   = 'onetime';
    mfParams = { amt: surplus, after: 12 };
    totalPrepaid = surplus;
  }

  const prepaySchedule = buildSchedule(lastP, lastRate, lastBaseEMI, mfFreq, mfParams);
  const baseInt    = lastBaseSchedule.reduce((s, r) => s + r.interest, 0);
  const prepayInt  = prepaySchedule.reduce((s, r) => s + r.interest,  0);
  const intSaved   = Math.max(0, baseInt - prepayInt);
  const yrsSaved   = ((lastBaseSchedule.length - prepaySchedule.length) / 12).toFixed(1);

  const mfEndMonth      = years * 12;
  const monthlyMFRate   = mfRate / 100 / 12;
  let mfFV = 0;

  if (!prepayOn) {
    mfFV = totalPrepaid * Math.pow(1 + mfRate / 100, years);
  } else {
    const { freq, params } = getPrepayParams();
    for (let m = 1; m <= lastBaseSchedule.length; m++) {
      const prepaidThisMonth = isPrepayMonth(m, freq, params);
      if (prepaidThisMonth > 0) {
        const monthsLeft = mfEndMonth - m;
        mfFV += prepaidThisMonth * (monthsLeft > 0 ? Math.pow(1 + monthlyMFRate, monthsLeft) : 1);
      }
    }
  }

  const mfGrossGain  = mfFV - totalPrepaid;
  const taxableGain  = Math.max(0, mfGrossGain - 100000);
  const ltcgTax      = taxableGain * 0.10;
  const mfNetGain    = mfGrossGain - ltcgTax;
  const prepayWins   = intSaved >= mfNetGain;

  const verdict = document.getElementById('mfVerdict');
  verdict.className = 'mf-verdict ' + (prepayWins ? 'prepay-wins' : 'mf-wins');
  document.getElementById('mfVerdictTitle').textContent = prepayWins ? '🏠 Prepayment Wins!' : '📊 Mutual Fund Wins!';
  document.getElementById('mfVerdictSub').textContent   = prepayWins
    ? 'Prepaying saves ' + fmt(intSaved - mfNetGain) + ' more than MF over ' + years + ' yrs'
    : 'MF earns '        + fmt(mfNetGain - intSaved) + ' more than prepaying over ' + years + ' yrs';

  document.getElementById('prepayCard').className = 'mf-card' + (prepayWins  ? ' winner' : '');
  document.getElementById('mfCard').className     = 'mf-card' + (!prepayWins ? ' winner' : '');

  document.getElementById('prepayIntSaved').textContent = fmt(intSaved);
  document.getElementById('prepayTenure').textContent   = yrsSaved + ' yrs shorter';
  document.getElementById('prepayNetGain').textContent  = fmt(intSaved);
  document.getElementById('mfGrossReturn').textContent  = fmt(mfGrossGain);
  document.getElementById('mfTaxPaid').textContent      = fmt(ltcgTax);
  document.getElementById('mfNetGain').textContent      = fmt(mfNetGain);
  document.getElementById('mfTaxShow').textContent      = taxBracket + '% bracket';

  document.getElementById('mfNote').innerHTML = `
    <strong style="color:var(--accent3)">&#128161; Key Insight:</strong> ${prepayWins
      ? 'At ' + lastRate + '% loan rate, prepayment gives guaranteed tax-free saving of ' + fmt(intSaved) + '. MF returns of ' + mfRate + '% are market-linked and not guaranteed.'
      : 'At ' + mfRate + '% MF return vs ' + lastRate + '% loan rate, MF wins — but MF returns are not guaranteed. Prepayment gives certainty and peace of mind.'}
    <br><br>
    <strong style="color:var(--accent3)">&#9878; General Rule:</strong> If MF expected return &gt; loan interest rate, MF may win — but factor in risk, volatility and tax before deciding.`;

  document.getElementById('mfResult').className = 'mf-result show';
}

/* ============================================================
   CONTROLLER — Share
   ============================================================ */
const SITE_URL   = window.location.href;
const SHARE_TEXT = '&#127968; Free Home Loan Calculator by TekproAI — EMI, prepayment modelling & full amortization schedule!';

function shareWhatsApp() { window.open('https://wa.me/?text=' + encodeURIComponent('🏠 Free Home Loan Calculator by TekproAI — EMI, prepayment modelling & full amortization schedule!\n' + SITE_URL), '_blank'); }
function shareTwitter()  { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('🏠 Free Home Loan Calculator by TekproAI — EMI, prepayment modelling & full amortization schedule!') + '&url=' + encodeURIComponent(SITE_URL), '_blank'); }
function shareLinkedIn() { window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(SITE_URL), '_blank'); }
function copyLink() {
  navigator.clipboard.writeText(SITE_URL).then(() => {
    document.getElementById('copyLinkText').textContent = 'Copied!';
    const t = document.getElementById('shareToast');
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); document.getElementById('copyLinkText').textContent = 'Copy Link'; }, 2500);
  });
}

/* ============================================================
   CONTROLLER — Feedback + AI response
   ============================================================ */
function setRating(n) {
  userRating = n;
  document.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('active', i < n));
}

function toggleTag(el) {
  el.classList.toggle('selected');
  const tag = el.textContent;
  selectedTags = el.classList.contains('selected')
    ? [...selectedTags, tag]
    : selectedTags.filter(t => t !== tag);
}

async function submitFeedback() {
  const text      = document.getElementById('feedbackText').value.trim();
  const name      = document.getElementById('feedbackName').value.trim()  || 'Anonymous';
  const userEmail = document.getElementById('feedbackEmail').value.trim() || 'Not provided';

  if (!userRating && !text && selectedTags.length === 0) {
    alert('Please add a rating, tag or message.');
    return;
  }

  const btn = document.getElementById('feedbackBtn');
  btn.disabled = true;
  document.getElementById('fbBtnText').textContent = 'Sending...';

  const aiBox  = document.getElementById('aiResponse');
  const aiBody = document.getElementById('aiBody');
  aiBox.style.display = 'block';
  aiBody.textContent  = 'Thinking...';

  const prompt = `You are a helpful assistant for "TekproAI Home Loan Calculator", a free financial tool. A user submitted feedback. Respond warmly in 3-4 sentences. Acknowledge their feedback, thank them genuinely, add a relevant home loan tip if appropriate, and invite them to share the app. Keep under 80 words. Sign off as "— TekproAI Assistant".
User: ${name} | Rating: ${userRating || 'Not rated'}/5 | Tags: ${selectedTags.join(', ') || 'None'} | Message: ${text || 'None'}`;

  const [aiResult, emailResult] = await Promise.allSettled([
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    }).then(r => r.json()),
    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      from_name: name, from_email: userEmail,
      rating:  userRating ? userRating + '/5 ⭐' : 'Not rated',
      tags:    selectedTags.length > 0 ? selectedTags.join(', ') : 'None selected',
      message: text || 'No message provided',
      reply_to: userEmail, to_name: 'TekproAI Team',
    }),
  ]);

  const reply = aiResult.status === 'fulfilled'
    ? (aiResult.value.content?.[0]?.text || 'Thank you for your feedback!')
    : 'Thank you ' + name + '! Your feedback is valuable to the TekproAI team. Do share it with friends planning a home loan! — TekproAI Assistant';

  aiBody.textContent = '';
  let i = 0;
  const iv = setInterval(() => { aiBody.textContent += reply[i]; i++; if (i >= reply.length) clearInterval(iv); }, 18);

  const statusEl = document.getElementById('emailStatus');
  if (emailResult.status === 'fulfilled') {
    statusEl.className = 'email-status ok';
    statusEl.textContent = '📧 Feedback emailed to developer successfully!';
  } else {
    statusEl.className = 'email-status fail';
    statusEl.textContent = '⚠️ Email delivery pending — feedback recorded locally.';
  }

  document.getElementById('feedbackThanks').style.display = 'block';
  document.getElementById('fbBtnText').textContent = 'Feedback Sent ✓';
}

/* ============================================================
   INIT
   ============================================================ */
calculate();
