// ── STORAGE: localStorage ──
const LS_DRUGS   = 'ilac_drugs_v2';
const LS_LOG     = 'ilac_log_v2';
const LS_HISTORY = 'ilac_history_v2';

function loadDrugs()   { try { return JSON.parse(localStorage.getItem(LS_DRUGS))   || []; } catch(e){ return []; } }
function loadLog()     { try { return JSON.parse(localStorage.getItem(LS_LOG))     || {}; } catch(e){ return {}; } }
function loadHistory() { try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch(e){ return []; } }

function saveDrugs(d)   { localStorage.setItem(LS_DRUGS,   JSON.stringify(d)); }
function saveLog(l)     { localStorage.setItem(LS_LOG,     JSON.stringify(l)); }
function saveHistory(h) { localStorage.setItem(LS_HISTORY, JSON.stringify(h)); }

function normalizeUsageCondition(v) {
  return (v === 'ac' || v === 'tok' || v === 'fark_etmez') ? v : 'fark_etmez';
}

function usageConditionLabel(v) {
  return ({ ac:'Aç', tok:'Tok', fark_etmez:'Fark etmez' })[normalizeUsageCondition(v)];
}

function formatDelayText(totalMins) {
  const mins = Math.max(0, Math.abs(parseInt(totalMins, 10) || 0));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const restMins = mins % 60;
  if (days > 0) return `${days} gün ${hours} saat gecikti`;
  if (hours > 0) return `${hours} saat ${restMins} dk gecikti`;
  return `${restMins} dk gecikti`;
}

function normalizeDrug(d) {
  return { ...d, usageCondition: normalizeUsageCondition(d && d.usageCondition) };
}

// ── STATE ──
let drugs    = loadDrugs().map(normalizeDrug);
let takenLog = loadLog();
let editId   = null;
let stockVal = 30;
let timeSlots = [];
let alarmTimers = [];
let pushReady = false;
let takingState = {};

const PUSH_PUBLIC_KEY = window.__PUSH_PUBLIC_KEY__ || '';
const PUSH_SERVER_BASE_URL = window.__PUSH_SERVER_BASE_URL__ || '';
const APP_VERSION = '20260420';

// ── INIT ──
updateHeaderDate();
renderAll();
openDefaultTab();
scheduleAlarms();
checkNotifBanner();
setInterval(updateHeaderDate, 60000);
setTimeout(() => {
  if (Notification.permission === 'granted') setupWebPush().catch(()=>{});
}, 1200);

saveDrugs(drugs);

// ── SERVICE WORKER ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`)
    .then(registration => {
      pushReady = true;
      registration.update().catch(()=>{});
      setupServiceWorkerUpdateFlow(registration);
    })
    .catch(()=>{});
}

function setupServiceWorkerUpdateFlow(registration) {
  const showPrompt = () => showUpdateToast();
  if (registration.waiting) showPrompt();

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        showPrompt();
      }
    });
  });
}

function showUpdateToast() {
  if (document.getElementById('sw-update-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'sw-update-toast';
  toast.setAttribute('style',
    'position:fixed;left:12px;right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px));' +
    'z-index:150;background:#1a3a5c;color:#fff;border-radius:14px;padding:10px 12px;' +
    'display:flex;align-items:center;justify-content:space-between;gap:10px;' +
    'box-shadow:0 8px 24px rgba(26,58,92,0.3);font:700 13px/1.2 Nunito,sans-serif;'
  );
  toast.innerHTML = '<span>Uygulama güncellendi.</span><button id="sw-update-btn" style="border:none;border-radius:10px;padding:8px 10px;background:#fff;color:#1a3a5c;font:800 12px Nunito,sans-serif;cursor:pointer;">Yenile</button>';
  document.body.appendChild(toast);

  const btn = document.getElementById('sw-update-btn');
  if (btn) btn.addEventListener('click', () => window.location.reload());
}

function updateHeaderDate() {
  const now = new Date();
  document.getElementById('header-date').textContent =
    now.toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long' });
}

// ── TABS ──
function switchTab(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  const tabEl = el || document.querySelector(`.tab[data-tab="${name}"]`);
  if (tabEl) tabEl.classList.add('active');
  if (name==='bugun')  renderToday();
  if (name==='gecmis') renderHistoryPage();
  if (name==='ilaclar') renderDrugs();
}

function openDefaultTab() {
  switchTab('bugun');
}

// ── RENDER ──
function renderAll() { renderDrugs(); renderToday(); renderStats(); }

function renderDrugs() {
  const list = document.getElementById('drug-list');
  if (!drugs.length) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">💊</div><h3>Henüz ilaç eklenmedi</h3><p>Sağ alttaki + butonuna basarak ilaç ekleyebilirsin.</p></div>`;
    return;
  }
  const colors = ['#1a3a5c','#e8734a','#2ecc71','#9b59b6','#3498db','#e74c3c','#1abc9c'];
  list.innerHTML = drugs.map((d,i) => {
    const color = colors[i % colors.length];
    const remaining = d.stock || 0;
    const dailyDose = parseInt(d.daily) || 1;
    const daysLeft = Math.floor(remaining / dailyDose);
    const stockClass = remaining <= 0 ? 'stock-empty' : (daysLeft <= 7 ? 'stock-low' : 'stock-ok');
    const stockText  = remaining <= 0 ? '❌ Bitti' : (daysLeft <= 7 ? `⚠️ ${daysLeft}g` : `✅ ${daysLeft}g`);
    const durText = d.duration === 'omur_boyu' ? '∞ Ömür boyu' : (d.duration === 'sure' ? `${d.days} gün` : 'Kutu bitince');
    const usageCondition = normalizeUsageCondition(d.usageCondition);
    const usage = usageConditionLabel(usageCondition);
    const times = Array.isArray(d.times) ? d.times.filter(Boolean) : [];
    const timeBadges = times.length
      ? times.slice(0,3).map(t => `<span class="pill-badge pill-orange">${t}</span>`).join('') +
        (times.length > 3 ? `<span class="pill-badge pill-gray">+${times.length-3} saat</span>` : '')
      : '<span class="pill-badge pill-gray">Saat yok</span>';
    return `<div class="drug-card" onclick="showDetail(${d.id})" style="animation-delay:${i*0.05}s">
      <div class="drug-card-stripe" style="background:${color}"></div>
      ${d.photo ? `<img class="drug-card-img" src="${d.photo}">` : `<div class="drug-card-img-placeholder">💊</div>`}
      <div class="drug-card-info">
        <div class="drug-card-name">${d.name}</div>
        <div class="drug-card-meta">${[d.doctor?'Dr.'+d.doctor:'', d.hospital].filter(Boolean).join(' · ')}</div>
        <div class="drug-card-pills">
          <span class="pill-badge pill-blue">Günde ${d.daily}x</span>
          <span class="pill-badge pill-usage ${usageCondition}">${usage}</span>
          ${timeBadges}
          <span class="pill-badge pill-gray">${durText}</span>
          ${d.alarm ? '<span class="pill-badge pill-green">🔔</span>' : ''}
        </div>
      </div>
      <div class="drug-card-stock ${stockClass}">${stockText}</div>
    </div>`;
  }).join('');
}

function renderToday() {
  const cont = document.getElementById('today-alarms');
  if (!drugs.length) { cont.innerHTML = `<div class="empty-state"><div class="emoji">📅</div><h3>İlaç yok</h3><p>İlaçlar sekmesinden ekle.</p></div>`; return; }
  const today = todayStr();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let items = [];
  drugs.forEach(d => {
    if (!d.times) return;
    d.times.forEach(t => {
      const key = `${today}_${d.id}_${t}`;
      const [h,m] = t.split(':').map(Number);
      const mins = (h * 60) + m;
      const diff = mins - nowMins;
      items.push({ drug:d, time:t, key, done: !!takenLog[key], isTaking: !!takingState[key], mins, diff });
    });
  });
  items.sort((a,b) => a.mins - b.mins);
  if (!items.length) { cont.innerHTML = `<div class="empty-state"><div class="emoji">🎉</div><h3>Bugün alarm yok</h3></div>`; return; }
  const pending = items.filter(i=>!i.done).map(i => ({ ...i, overdue: i.diff < 0 }));
  const done = items.filter(i=>i.done);

  const overduePending = pending
    .filter(i => i.overdue)
    .sort((a,b) => a.diff - b.diff); // en negatif diff en eski gecikmiş
  const upcomingPending = pending
    .filter(i => !i.overdue)
    .sort((a,b) => a.diff - b.diff);
  const focusItem = overduePending[0] || upcomingPending[0] || null;

  pending.forEach(i => { i.isNow = !!focusItem && i.key === focusItem.key; });

  const otherPending = pending.filter(i => !i.isNow)
    .sort((a,b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.diff - b.diff;
    });

  let html = '';
  html += renderFocusCard(focusItem);
  html += renderList(otherPending, done);
  cont.innerHTML = html || `<div class="empty-state"><div class="emoji">🎉</div><h3>Bugün için bekleyen ilaç kalmadı</h3></div>`;
  renderStats();
}

function renderFocusCard(item) {
  if (!item) return '';
  const title = item.overdue ? 'Acil Alman Gereken' : 'Şimdi Alman Gereken';
  return `
    <div class="alarm-section-title alarm-section-title-focus">${title}</div>
    ${alarmHTML(item, 'focus')}
  `;
}

function renderList(pending, done) {
  let html = '';
  if (pending.length) {
    html += `<div class="alarm-section-title">Diğerleri (${pending.length})</div>`;
    html += pending.map(i => alarmHTML(i, 'list')).join('');
  } else {
    html += `<div class="alarm-section-title">Diğerleri</div><div class="empty-list-note">Başka bekleyen ilaç yok.</div>`;
  }
  if (done.length) {
    html += `<div class="alarm-section-title">Tamamlandı (${done.length})</div>`;
    html += done.map(i => alarmHTML(i, 'list')).join('');
  }
  return html;
}

function alarmHTML(i, variant='list') {
  const classes = [
    'alarm-item',
    variant === 'focus' ? 'focus' : 'compact',
    i.done ? 'done' : 'pending',
    i.isTaking ? 'taking' : '',
    i.isNow ? 'now' : '',
    (!i.done && i.overdue) ? 'overdue' : '',
  ].filter(Boolean).join(' ');
  const topTags = !i.done ? `
    <div class="alarm-item-top-tags">
      ${i.isNow ? '<span class="alarm-flag alarm-flag-now">ŞİMDİ AL</span>' : ''}
      ${i.overdue ? '<span class="alarm-flag alarm-flag-overdue">GECİKTİ</span>' : ''}
    </div>
  ` : '';
  const doneOverlay = i.done ? '<div class="alarm-done-overlay">✓ ALINDI</div>' : '';
  const overdueInfo = (variant === 'focus' && !i.done && i.overdue)
    ? `<div class="alarm-overdue-text">${formatDelayText(i.diff)}</div>`
    : '';
  const usageCondition = normalizeUsageCondition(i.drug.usageCondition);
  const usage = usageConditionLabel(usageCondition);
  return `<div class="${classes}" onclick="toggleTaken('${i.key}')">
    ${topTags}
    ${doneOverlay}
    ${i.drug.photo ? `<img class="alarm-photo" src="${i.drug.photo}" alt="${i.drug.name} kutu fotoğrafı">` : `<div class="alarm-photo-placeholder">💊</div>`}
    <div class="alarm-main">
      <div class="alarm-time">${i.time}</div>
      ${overdueInfo}
      <div class="alarm-name">${i.drug.name}</div>
      <div class="alarm-usage-badge ${usageCondition}">${usage}</div>
      <div class="alarm-dose">${i.drug.daily} adet · ${i.drug.duration==='omur_boyu'?'Ömür boyu':(i.drug.duration==='sure'?i.drug.days+' günlük':'Kutu bitince')}</div>
    </div>
    <div class="alarm-action-wrap">
      <button class="alarm-action" ${i.isTaking ? 'disabled' : ''} onclick="event.stopPropagation();toggleTaken('${i.key}')">${i.done ? 'GERİ AL' : (i.isTaking ? '✓ ALINDI' : 'ALDIM')}</button>
    </div>
  </div>`;
}

function toggleTaken(key) {
  const parts = key.split('_');
  const id = parts[1];
  const d = drugs.find(x => x.id == id);
  if (takenLog[key]) {
    delete takenLog[key];
    if (d) { d.stock = (d.stock||0)+1; logHistory(d.id,'İlaç iadesi'); }
    saveDrugs(drugs); saveLog(takenLog);
    renderToday();
    renderDrugs();
    syncPushSchedule();
    return;
  }

  if (takingState[key]) return;
  takingState[key] = true;
  renderToday();

  setTimeout(() => {
    if (!takingState[key]) return;
    delete takingState[key];
    takenLog[key] = true;
    if (d && d.stock > 0) { d.stock = Math.max(0,(d.stock||0)-1); logHistory(d.id,'İlaç alındı'); }
    saveDrugs(drugs); saveLog(takenLog);
    renderToday();
    renderDrugs();
    syncPushSchedule();
  }, 650);
}

function renderStats() {
  const today = todayStr();
  let total=0, done=0;
  drugs.forEach(d => { if(d.times) d.times.forEach(t => { total++; if(takenLog[`${today}_${d.id}_${t}`]) done++; }); });
  document.getElementById('stat-total').textContent = drugs.length;
  document.getElementById('stat-today').textContent = total;
  document.getElementById('stat-done').textContent  = done;
}

function renderHistoryPage() {
  const hist = loadHistory();
  const cont = document.getElementById('history-list');
  if (!hist.length) { cont.innerHTML = `<div class="empty-state"><div class="emoji">📋</div><h3>Henüz kayıt yok</h3></div>`; return; }
  const colors = {'İlaç alındı':'#2ecc71','İlaç eklendi':'#3498db','İlaç silindi':'#e74c3c','Stok güncellendi':'#f39c12','İlaç iadesi':'#9b59b6'};
  cont.innerHTML = hist.slice(0,60).map(h => {
    const dt = new Date(h.ts);
    const ds = dt.toLocaleDateString('tr-TR')+' '+dt.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    return `<div class="history-item">
      <div class="history-dot" style="background:${colors[h.action]||'#7a8fa0'}"></div>
      <div class="history-text"><strong>${h.name}</strong> — ${h.action}</div>
      <div class="history-date">${ds}</div>
    </div>`;
  }).join('');
}

function logHistory(drugId, action) {
  const d = drugs.find(x=>x.id==drugId);
  const hist = loadHistory();
  hist.unshift({ drugId, name:d?d.name:'?', action, ts:new Date().toISOString() });
  saveHistory(hist.slice(0,200));
}

// ── MODAL ──
function openAddModal(drugId=null) {
  editId = drugId;
  document.getElementById('modal-title').textContent = drugId ? 'İlaç Düzenle' : 'Yeni İlaç Ekle';
  document.getElementById('delete-btn').style.display = drugId ? 'block' : 'none';
  if (drugId) {
    const d = drugs.find(x=>x.id==drugId);
    document.getElementById('drug-name').value     = d.name||'';
    document.getElementById('drug-doctor').value   = d.doctor||'';
    document.getElementById('drug-hospital').value = d.hospital||'';
    document.getElementById('drug-date').value     = d.date||'';
    document.getElementById('drug-daily').value    = d.daily||1;
    document.getElementById('drug-duration').value = d.duration||'omur_boyu';
    document.getElementById('drug-days').value     = d.days||'';
    document.getElementById('drug-alarm').checked  = d.alarm!==false;
    stockVal = d.stock||0;
    const usage = normalizeUsageCondition(d.usageCondition);
    const usageEl = document.querySelector(`input[name="usage-condition"][value="${usage}"]`);
    if (usageEl) usageEl.checked = true;
    if (d.photo) { document.getElementById('photo-preview').src=d.photo; document.getElementById('photo-preview').style.display='block'; document.getElementById('photo-placeholder').style.display='none'; }
    else { document.getElementById('photo-preview').style.display='none'; document.getElementById('photo-placeholder').style.display='block'; }
    renderTimeSlots(d.times||[]);
  } else {
    document.getElementById('drug-name').value=''; document.getElementById('drug-doctor').value=''; document.getElementById('drug-hospital').value='';
    document.getElementById('drug-date').value=new Date().toISOString().split('T')[0];
    document.getElementById('drug-daily').value=1; document.getElementById('drug-duration').value='omur_boyu';
    document.getElementById('drug-days').value=''; document.getElementById('drug-alarm').checked=true;
    const defaultUsageEl = document.querySelector('input[name="usage-condition"][value="fark_etmez"]');
    if (defaultUsageEl) defaultUsageEl.checked = true;
    stockVal=30;
    document.getElementById('photo-preview').style.display='none'; document.getElementById('photo-placeholder').style.display='block';
    renderTimeSlots(['08:00']);
  }
  document.getElementById('stock-val').textContent=stockVal;
  toggleDuration();
  document.getElementById('add-modal').classList.add('open');
  document.getElementById('detail-modal').classList.remove('open');
}

function closeModal() {
  document.getElementById('add-modal').classList.remove('open');
  document.getElementById('detail-modal').classList.remove('open');
}

function handlePhoto(e) {
  const file = e.target.files[0]; if(!file) return;
  // Resize to max 400px to keep localStorage small
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const MAX = 400;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) { if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;} }
    const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
    canvas.getContext('2d').drawImage(img,0,0,w,h);
    const data = canvas.toDataURL('image/jpeg',0.7);
    document.getElementById('photo-preview').src=data;
    document.getElementById('photo-preview').style.display='block';
    document.getElementById('photo-placeholder').style.display='none';
    URL.revokeObjectURL(url);
  };
  img.src=url;
}

function renderTimeSlots(times) {
  timeSlots=[...times];
  document.getElementById('time-slots').innerHTML = timeSlots.map((t,i)=>`
    <div class="time-slot">
      <input type="time" value="${t}" onchange="timeSlots[${i}]=this.value">
      <button class="time-slot-remove" onclick="removeTimeSlot(${i})">×</button>
    </div>`).join('');
}
function addTimeSlot()    { timeSlots.push('12:00'); renderTimeSlots(timeSlots); }
function removeTimeSlot(i){ timeSlots.splice(i,1);   renderTimeSlots(timeSlots); }
function toggleDuration() { document.getElementById('duration-days-wrap').style.display = document.getElementById('drug-duration').value==='sure'?'block':'none'; }
function changeStock(d)   { stockVal=Math.max(0,stockVal+d); document.getElementById('stock-val').textContent=stockVal; }

function saveDrug() {
  const name = document.getElementById('drug-name').value.trim();
  if (!name) { alert('İlaç adı zorunlu!'); return; }
  const prev = document.getElementById('photo-preview');
  const photo = prev.style.display!=='none' ? prev.src : null;
  const usageCondition = normalizeUsageCondition((document.querySelector('input[name="usage-condition"]:checked')||{}).value);
  const drug = {
    id: editId || Date.now(),
    name, photo,
    doctor:   document.getElementById('drug-doctor').value.trim(),
    hospital: document.getElementById('drug-hospital').value.trim(),
    date:     document.getElementById('drug-date').value,
    daily:    parseInt(document.getElementById('drug-daily').value)||1,
    duration: document.getElementById('drug-duration').value,
    days:     document.getElementById('drug-days').value,
    alarm:    document.getElementById('drug-alarm').checked,
    times:    [...timeSlots],
    stock:    stockVal,
    usageCondition,
  };
  if (editId) { const idx=drugs.findIndex(d=>d.id==editId); drugs[idx]=normalizeDrug(drug); }
  else { drugs.push(normalizeDrug(drug)); logHistory(drug.id,'İlaç eklendi'); }
  saveDrugs(drugs);
  closeModal(); renderAll(); scheduleAlarms();
  syncPushSchedule();
}

function deleteDrug() {
  if (!editId || !confirm('Bu ilacı silmek istediğinden emin misin?')) return;
  logHistory(editId,'İlaç silindi');
  drugs = drugs.filter(d=>d.id!=editId);
  saveDrugs(drugs); closeModal(); renderAll();
  syncPushSchedule();
}

// ── DETAIL ──
function showDetail(id) {
  const d = drugs.find(x=>x.id==id); if(!d) return;
  const remaining = d.stock||0;
  const daysLeft = Math.floor(remaining/(parseInt(d.daily)||1));
  const today = todayStr();
  const takenToday = (d.times||[]).filter(t=>takenLog[`${today}_${d.id}_${t}`]).length;
  document.getElementById('detail-content').innerHTML = `
    <div class="modal-handle"></div>
    ${d.photo?`<img src="${d.photo}" style="width:100%;height:180px;object-fit:cover;border-radius:16px;margin-bottom:16px">`:`<div style="font-size:50px;text-align:center;margin-bottom:16px">💊</div>`}
    <div style="font-size:22px;font-weight:900;margin-bottom:4px">${d.name}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:16px">${[d.doctor?'Dr.'+d.doctor:'',d.hospital,d.date?formatDate(d.date):''].filter(Boolean).join(' · ')}</div>
    <div class="detail-grid">
      <div class="detail-stat"><div class="val">${remaining}</div><div class="key">Kalan tablet</div></div>
      <div class="detail-stat"><div class="val">${daysLeft}</div><div class="key">Kalan gün</div></div>
      <div class="detail-stat"><div class="val">${d.daily}</div><div class="key">Günlük doz</div></div>
      <div class="detail-stat"><div class="val">${takenToday}/${(d.times||[]).length}</div><div class="key">Bugün alınan</div></div>
    </div>
    <div style="background:var(--surface2);border-radius:14px;padding:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--muted)">Süre</span><span style="font-weight:800">${d.duration==='omur_boyu'?'∞ Ömür boyu':(d.duration==='sure'?d.days+' gün':'Kutu bitince')}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px"><span style="color:var(--muted)">Alım saatleri</span><span style="font-weight:800">${(d.times||[]).join(', ')||'—'}</span></div>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn-primary" style="flex:1" onclick="closeModal();openAddModal(${d.id})">✏️ Düzenle</button>
      <button style="flex:0.5;padding:16px;background:var(--bg);border:1.5px solid var(--border);border-radius:16px;font-family:'Nunito',sans-serif;font-size:15px;font-weight:800;cursor:pointer" onclick="addStockPrompt(${d.id})">📦 Stok</button>
    </div>
    <button style="width:100%;padding:14px;background:none;border:none;font-family:'Nunito',sans-serif;font-size:14px;color:var(--muted);cursor:pointer;margin-top:8px" onclick="closeModal()">Kapat</button>`;
  document.getElementById('detail-modal').classList.add('open');
}

function addStockPrompt(id) {
  const d = drugs.find(x=>x.id==id); if(!d) return;
  const n = parseInt(prompt(`"${d.name}"\nKaç tablet eklenecek? (Mevcut: ${d.stock})`));
  if (isNaN(n)) return;
  d.stock = (d.stock||0)+n;
  logHistory(d.id,'Stok güncellendi');
  saveDrugs(drugs); renderAll(); closeModal();
}

// ── NOTIFICATIONS ──
function checkNotifBanner() {
  if (!('Notification' in window)) return;
  if (!isWebPushCapable()) {
    document.getElementById('notif-prompt').innerHTML = `
      <div class="notif-banner">ℹ️ Kalıcı bildirim için uygulamayı iPhone ana ekranına ekleyin.</div>`;
    return;
  }
  if (Notification.permission==='granted') return;
  document.getElementById('notif-prompt').innerHTML = `
    <div class="notif-banner">🔔 Alarm bildirimleri için izin ver
      <button onclick="requestNotif()">İzin Ver</button>
    </div>`;
}

async function requestNotif() {
  if (!('Notification' in window)) { alert('Bu tarayıcı bildirimleri desteklemiyor.'); return; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') return;
  document.getElementById('notif-prompt').innerHTML='';
  await setupWebPush();
  scheduleAlarms();
}

function scheduleAlarms() {
  alarmTimers.forEach(t=>clearTimeout(t)); alarmTimers=[];
  if (!('Notification' in window) || Notification.permission!=='granted') return;
  const now = new Date();
  drugs.forEach(d => {
    if (!d.alarm || !d.times) return;
    d.times.forEach(t => {
      const [h,m] = t.split(':').map(Number);
      const next = new Date(); next.setHours(h,m,0,0);
      if (next<=now) next.setDate(next.getDate()+1);
      const ms = next-now;
      const timer = setTimeout(()=>{
        new Notification('💊 İlaç Zamanı!',{
          body: `${d.name} — ${d.daily} adet alınacak`,
          tag: `drug_${d.id}_${t}`
        });
        scheduleAlarms();
      }, ms);
      alarmTimers.push(timer);
    });
  });
}

function isWebPushCapable() {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function buildAlarmPlan() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';
  return drugs.flatMap(d => {
    if (!d.alarm || !Array.isArray(d.times)) return [];
    return d.times.map(t => ({
      drugId: d.id,
      name: d.name,
      time: t,
      daily: d.daily || 1,
      timezone,
    }));
  });
}

async function postPushJSON(path, payload) {
  if (!PUSH_SERVER_BASE_URL) return;
  const res = await fetch(`${PUSH_SERVER_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Push API hata: ${res.status}`);
}

async function setupWebPush() {
  if (!isWebPushCapable()) return;
  if (!isStandalonePwa()) return;
  if (!PUSH_PUBLIC_KEY || !PUSH_SERVER_BASE_URL) {
    console.warn('PUSH_PUBLIC_KEY veya PUSH_SERVER_BASE_URL ayarlı değil.');
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY),
    });
  }
  await postPushJSON('/api/push/subscriptions', {
    subscription,
    userAgent: navigator.userAgent,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul',
    standalone: isStandalonePwa(),
  });
  await syncPushSchedule();
}

async function syncPushSchedule() {
  if (!PUSH_SERVER_BASE_URL) return;
  if (!isWebPushCapable() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return;
    await postPushJSON('/api/push/schedules', {
      endpoint: subscription.endpoint,
      alarms: buildAlarmPlan(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Push schedule sync hatası:', err);
  }
}

// ── UTILS ──
function todayStr() { return new Date().toISOString().split('T')[0]; }
function formatDate(s) { return s ? new Date(s).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}) : ''; }

function exportData() {
  const blob = new Blob([JSON.stringify({drugs,takenLog},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='ilac-yedek-'+todayStr()+'.json'; a.click();
}

function importData() {
  const input = document.getElementById('import-file');
  if (!input) return;
  input.value = '';
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.drugs) || typeof parsed.takenLog !== 'object') {
          alert('Geçersiz yedek dosyası.');
          return;
        }
        drugs = parsed.drugs.map(normalizeDrug);
        takenLog = parsed.takenLog || {};
        saveDrugs(drugs);
        saveLog(takenLog);
        renderAll();
        renderHistoryPage();
        scheduleAlarms();
        syncPushSchedule();
        alert('Yedek başarıyla yüklendi.');
      } catch (err) {
        alert('Dosya okunamadı. Lütfen geçerli bir JSON dosyası seçin.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

document.getElementById('add-modal').addEventListener('click',function(e){if(e.target===this)closeModal();});
document.getElementById('detail-modal').addEventListener('click',function(e){if(e.target===this)closeModal();});
