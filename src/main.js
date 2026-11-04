// ── STORAGE: localStorage ──
const LS_DRUGS   = 'ilac_drugs_v2';
const LS_LOG     = 'ilac_log_v2';
const LS_HISTORY = 'ilac_history_v2';
const LS_FCM_TOKEN = 'ilac_fcm_token_v1';
const LS_PHOTO_SIZE = 'ilac_focus_photo_size_v1';
function focusPhotoSize() { const v=localStorage.getItem(LS_PHOTO_SIZE); return ['small','hidden'].includes(v) ? v : 'large'; }
let mainSettingsOpen = false;
let settingsPreviousFocus = null;
function updateMainSettings() {
  const panel = document.getElementById('main-settings-panel');
  const trigger = document.getElementById('main-settings-trigger');
  if (panel) panel.hidden = !mainSettingsOpen;
  const backdrop = document.getElementById('settings-backdrop');
  if (backdrop) backdrop.hidden = !mainSettingsOpen;
  document.body.classList.toggle('settings-open', mainSettingsOpen);
  if (trigger) trigger.setAttribute('aria-expanded', String(mainSettingsOpen));
  document.querySelectorAll('[data-photo-size]').forEach(button => {
    const selected = button.dataset.photoSize === focusPhotoSize();
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
function toggleMainSettings() {
  const opening = !mainSettingsOpen;
  if (opening) settingsPreviousFocus = document.activeElement;
  mainSettingsOpen = opening;
  updateMainSettings();
  if (opening) (window.matchMedia('(max-width:600px)').matches ? document.querySelector('.settings-mobile-back') : document.querySelector('.settings-close'))?.focus();
  else if (settingsPreviousFocus && typeof settingsPreviousFocus.focus === 'function') settingsPreviousFocus.focus();
}
document.addEventListener('keydown', event => {
  if (!mainSettingsOpen) return;
  if (event.key === 'Escape') { event.preventDefault(); toggleMainSettings(); return; }
  if (event.key !== 'Tab') return;
  const panel = document.getElementById('main-settings-panel');
  const focusable = [...panel.querySelectorAll('button:not([disabled])')].filter(el => getComputedStyle(el).display !== 'none');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
function setFocusPhotoSize(size) {
  localStorage.setItem(LS_PHOTO_SIZE, ['small','hidden'].includes(size) ? size : 'large');
  renderToday();
  updateMainSettings();
}

function loadDrugs()   { try { const value = JSON.parse(localStorage.getItem(LS_DRUGS)); return Array.isArray(value) ? value.filter(d => d && typeof d === 'object' && typeof d.name === 'string') : []; } catch(e){ return []; } }
function loadLog()     { try { return JSON.parse(localStorage.getItem(LS_LOG))     || {}; } catch(e){ return {}; } }
function loadHistory() { try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch(e){ return []; } }

function saveDrugs(d)   { localStorage.setItem(LS_DRUGS,   JSON.stringify(d)); }
function saveLog(l)     { localStorage.setItem(LS_LOG,     JSON.stringify(l)); }
function saveHistory(h) { localStorage.setItem(LS_HISTORY, JSON.stringify(h)); }

function normalizeUsageCondition(v) {
  return ['ac','tok','farketmez','ozel','belirtilmedi'].includes(v) ? v : 'belirtilmedi';
}

function usageConditionLabel(v) {
  return ({ ac:'Aç', tok:'Tok', farketmez:'Aç / tok fark etmez', ozel:'Özel talimat', belirtilmedi:'Belirtilmedi' })[normalizeUsageCondition(v)];
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
const expandedDrugNotes = new Set();
function toggleDrugNote(id) { const k=String(id); if(expandedDrugNotes.has(k)) expandedDrugNotes.delete(k); else expandedDrugNotes.add(k); renderToday(); }
function safeDrugText(value) { return String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

const PUSH_PUBLIC_KEY = window.__PUSH_PUBLIC_KEY__ || '';
const PUSH_SERVER_BASE_URL = window.__PUSH_SERVER_BASE_URL__ || '';
const FIREBASE_CONFIG = window.__FIREBASE_CONFIG__ || {};
const FCM_VAPID_KEY = 'BOFQ_64qgW2NEoJRSWXTA3KbOaN3R-P2ztpaXRfuHuKD8BdCGkAPyMO5AetHyVgZbdKAOpWY5obK3cls6T2Yf5o';
const APP_VERSION = '20261104-final';
let fcmSwRegistrationPromise = null;
let fcmOnMessageBound = false;

// ── INIT ──
updateHeaderDate();
renderAll();
openDefaultTab();
scheduleAlarms();
checkNotifBanner();
setInterval(() => {
  updateHeaderDate();
  renderToday();
  renderStats();
}, 60000);
window.addEventListener('focus', () => {
  updateHeaderDate();
  renderAll();
  scheduleAlarms();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    updateHeaderDate();
    renderAll();
    scheduleAlarms();
  }
});
setTimeout(() => {
  if ('Notification' in window && Notification.permission === 'granted') {
    setupWebPush().catch(()=>{});
    setupFirebaseMessaging().catch(()=>{});
  }
}, 1200);

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
  const addButton = document.getElementById('add-drug-fab');
  if (addButton) addButton.hidden = name !== 'ilaclar';
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
      items.push({ drug:d, time:t, key, done: !!takenLog[key] && takenLog[key] !== 'skipped', skipped: takenLog[key] === 'skipped', isTaking: !!takingState[key], mins, diff });
    });
  });
  items.sort((a,b) => a.mins - b.mins);
  if (!items.length) { cont.innerHTML = `<div class="empty-state"><div class="emoji">🎉</div><h3>Bugün alarm yok</h3></div>`; return; }
  const pending = items.filter(i=>!i.done && !i.skipped).map(i => ({ ...i, overdue: i.diff < 0 }));
  const done = items.filter(i=>i.done || i.skipped);

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
  return `<div class="focus-heading"><div class="alarm-section-title alarm-section-title-focus">İLAÇ ZAMANI</div></div>${alarmHTML(item, 'focus')}`;
}

function renderList(pending, done) {
  let html = '';
  if (pending.length) {
    html += `<div class="alarm-section-title">SONRAKİ DOZLAR <span class="mono-count">${pending.length}</span></div>`;
    html += pending.map(i => alarmHTML(i, 'list')).join('');
  } else {
    html += `<div class="alarm-section-title">SONRAKİ DOZLAR</div><div class="empty-list-note">Başka bekleyen doz yok.</div>`;
  }
  if (done.length) {
    html += `<div class="alarm-section-title">GÜNLÜK KAYITLAR <span class="mono-count">${done.length}</span></div>`;
    html += done.map(i => alarmHTML(i, 'list')).join('');
  }
  return html;
}

function alarmHTML(i, variant='list') {
  const classes = [
    'alarm-item',
    i.skipped ? 'dose-skipped' : (i.done ? 'dose-taken' : (i.overdue ? 'dose-overdue' : 'dose-upcoming')),
    variant === 'focus' ? 'focus photo-' + focusPhotoSize() : 'compact',
    i.done || i.skipped ? 'done' : 'pending',
    i.isTaking ? 'taking' : '',
    i.isNow ? 'now' : '',
    (!i.done && i.overdue) ? 'overdue' : '',
  ].filter(Boolean).join(' ');
  const topTags = !i.done ? `
    <div class="alarm-item-top-tags">

      ${''}
    </div>
  ` : '';
  const doneOverlay = i.skipped ? '<div class="alarm-done-overlay">ATLANDI</div>' : (i.done ? '<div class="alarm-done-overlay">✓ ALINDI</div>' : '');
  const takenAt = typeof takenLog[i.key] === 'string' ? new Date(takenLog[i.key]) : null;
  const takenText = takenAt && !isNaN(takenAt.getTime()) ? takenAt.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}) : null;
  const overdueInfo = (!i.done && i.overdue)
    ? `<div class="alarm-overdue-text" role="status">GECİKTİ · ${formatDelayText(i.diff)}</div>`
    : (!i.done && !i.skipped ? '<div class="alarm-waiting-text" role="status">BEKLİYOR</div>' : '');
  const usageCondition = normalizeUsageCondition(i.drug.usageCondition);
  const usageDisplay = ({tok:'TOK KARNINA',ac:'AÇ KARNINA',farketmez:'AÇ / TOK FARK ETMEZ',ozel:'ÖZEL TALİMAT',belirtilmedi:'TALİMAT BELİRTİLMEDİ'})[usageCondition];
  const remaining = parseInt(i.drug.stock, 10) || 0;
  const dailyDose = Math.max(1, parseInt(i.drug.daily, 10) || 1);
  const daysLeft = Math.floor(remaining / dailyDose);
  const stockInfo = remaining <= 0
    ? '<div class="alarm-stock-warning stock-empty">Stok bitti · İlacını yenile</div>'
    : (daysLeft <= 3 ? `<div class="alarm-stock-warning stock-empty">İlacını yenile · Yaklaşık ${daysLeft} gün kaldı</div>` :
       daysLeft <= 7 ? `<div class="alarm-stock-warning stock-low">İlacın azalıyor · Yaklaşık ${daysLeft} gün kaldı</div>` : '');
  return `<div class="${classes}">
    ${topTags}
    ${doneOverlay}
    <div class="alarm-image-wrap">
      ${i.drug.photo ? `<img class="alarm-photo" src="${i.drug.photo}" alt="${i.drug.name} kutu fotoğrafı">` : `<div class="alarm-photo-placeholder">💊</div>`}
    </div>
    <div class="alarm-name">${i.drug.purpose ? `<button type="button" class="alarm-name-toggle" aria-expanded="${expandedDrugNotes.has(String(i.drug.id))}" onclick="toggleDrugNote('${i.drug.id}')">${safeDrugText(i.drug.name)} ⌄</button>` : safeDrugText(i.drug.name)}</div>
    ${i.drug.purpose && expandedDrugNotes.has(String(i.drug.id)) ? `<div class="alarm-purpose-note">${safeDrugText(i.drug.purpose)}</div>` : ''}
    <div class="alarm-time">${i.done && takenText ? takenText : i.time}</div>
    ${i.skipped ? `<div class="dose-time-detail">Atlandı · Planlanan ${i.time}</div>` : i.done ? `<div class="dose-time-detail">${takenText ? 'Alındığı saat · Planlanan '+i.time : 'Alındı · Planlanan '+i.time}</div>` : ''}
    ${overdueInfo}
    <div class="alarm-dose-tags"><span class="alarm-usage-badge ${usageCondition}" aria-label="Kullanım durumu: ${usageDisplay}">${usageDisplay}</span><span class="alarm-dose-tag">${i.drug.daily} ADET</span></div>
    ${i.drug.usageNote ? `<div class="alarm-purpose-note">${safeDrugText(i.drug.usageNote)}</div>` : ""}
    <div class="alarm-support">
      <div class="alarm-dose">${i.drug.duration==='omur_boyu'?'Ömür boyu':(i.drug.duration==='sure'?i.drug.days+' günlük':'Kutu bitince')}</div>
      ${stockInfo}
    </div>
    <div class="alarm-action-wrap">
      <button class="alarm-action" ${i.isTaking ? 'disabled' : ''} onclick="toggleTaken('${i.key}')">${i.done || i.skipped ? 'GERİ AL' : (i.isTaking ? '✓ ALINDI' : 'ALDIM')}</button>
      ${!i.done && !i.skipped ? `<button type="button" class="alarm-skip-action" onclick="skipDose('${i.key}')">ATLADIM</button>` : ''}
    </div>
  </div>`;
}

function toggleTaken(key) {
  const parts = key.split('_');
  const id = parts[1];
  const d = drugs.find(x => x.id == id);
  if (takenLog[key]) {
    if (!confirm('Bu dozun kaydını geri almak istiyor musunuz?')) return;
    const wasTaken = takenLog[key] !== 'skipped';
    delete takenLog[key];
    if (d && wasTaken) { d.stock = (d.stock||0)+1; logHistory(d.id,'İlaç iadesi'); }
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
    takenLog[key] = new Date().toISOString();
    if (d && d.stock > 0) { d.stock = Math.max(0,(d.stock||0)-1); logHistory(d.id,'İlaç alındı'); }
    saveDrugs(drugs); saveLog(takenLog);
    renderToday();
    renderDrugs();
    syncPushSchedule();
  }, 650);
}

function skipDose(key) {
  if (takenLog[key] || takingState[key]) return;
  if (!confirm('Bu dozu atlandı olarak kaydetmek istiyor musunuz? İlaç alınmış sayılmayacak.')) return;
  const nextLog = { ...takenLog, [key]: 'skipped' };
  try { saveLog(nextLog); }
  catch (error) { alert('Doz kaydı kaydedilemedi. Cihaz depolamasını kontrol edin.'); return; }
  takenLog = nextLog;
  const d = drugs.find(x => String(x.id) === key.split('_')[1]);
  if (d) logHistory(d.id, 'Doz atlandı');
  renderToday();
  syncPushSchedule();
}

function renderStats() {
  const today = todayStr();
  let total=0, done=0;
  drugs.forEach(d => { if(d.times) d.times.forEach(t => { total++; if(takenLog[`${today}_${d.id}_${t}`] && takenLog[`${today}_${d.id}_${t}`] !== 'skipped') done++; }); });
  if (!document.getElementById('stat-total')) return;
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
  try { saveHistory(hist.slice(0,200)); }
  catch (error) { console.warn('Geçmiş kaydı depolama alanına yazılamadı.', error); }
}

// ── MODAL ──
function openAddModal(drugId=null) {
  editId = drugId;
  document.getElementById('modal-title').textContent = drugId ? 'İlaç Düzenle' : 'Yeni İlaç Ekle';
  document.getElementById('delete-btn').style.display = drugId ? 'block' : 'none';
  if (drugId) {
    const d = drugs.find(x=>x.id==drugId);
    document.getElementById('drug-name').value     = d.name||'';
    document.getElementById('drug-purpose').value = d.purpose||'';
    document.getElementById('drug-usage-note').value = d.usageNote||'';
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
    document.getElementById('drug-name').value=''; document.getElementById('drug-purpose').value=''; document.getElementById('drug-usage-note').value=''; document.getElementById('drug-doctor').value=''; document.getElementById('drug-hospital').value='';
    document.getElementById('drug-date').value=new Date().toISOString().split('T')[0];
    document.getElementById('drug-daily').value=1; document.getElementById('drug-duration').value='omur_boyu';
    document.getElementById('drug-days').value=''; document.getElementById('drug-alarm').checked=true;
    const defaultUsageEl = document.querySelector('input[name="usage-condition"][value="belirtilmedi"]');
    if (defaultUsageEl) defaultUsageEl.checked = true;
    stockVal=30;
    document.getElementById('photo-preview').style.display='none'; document.getElementById('photo-placeholder').style.display='block';
    renderTimeSlots(['08:00']);
  }
  document.getElementById('stock-val').textContent=stockVal;
  toggleDuration();
  syncDoseTimeSlots();
  document.getElementById('add-modal').classList.add('open');
  document.getElementById('detail-modal').classList.remove('open');
  const editor = document.querySelector('#add-modal .modal');
  if (editor) editor.scrollTop = 0;
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
      <input type="time" value="${t}" oninput="timeSlots[${i}]=this.value" onchange="timeSlots[${i}]=this.value">
      
    </div>`).join('');
}
function syncDoseTimeSlots() {
  const input=document.getElementById('drug-daily');
  const n=Math.max(1,Math.min(10,parseInt(input.value,10)||1));
  input.value=n;
  const existing=[...timeSlots];
  const defaults=['08:00','20:00','12:00','16:00','22:00','06:00','10:00','14:00','18:00','23:00'];
  const next=existing.slice(0,n);
  while(next.length<n) next.push(defaults.find(t=>!next.includes(t))||'08:00');
  renderTimeSlots(next);
}
function addTimeSlot() { syncDoseTimeSlots(); }
function removeTimeSlot(i){ alert('Saat sayısını değiştirmek için Günde Kaç Adet alanını düzenleyin.'); }
function toggleDuration() { document.getElementById('duration-days-wrap').style.display = document.getElementById('drug-duration').value==='sure'?'block':'none'; }
function changeStock(d)   { stockVal=Math.max(0,stockVal+d); document.getElementById('stock-val').textContent=stockVal; }

function saveDrug() {
  const name = document.getElementById('drug-name').value.trim();
  if (!name) { alert('İlaç adını yazın.'); document.getElementById('drug-name').focus(); return; }
  const prev = document.getElementById('photo-preview');
  const photo = prev.style.display!=='none' ? prev.src : null;
  const usageCondition = normalizeUsageCondition((document.querySelector('input[name="usage-condition"]:checked')||{}).value);
  const usageNote = document.getElementById('drug-usage-note').value.trim();
  if (usageCondition === 'ozel' && !usageNote) { alert('Özel talimat seçildiğinde kullanım talimatını yazın.'); document.getElementById('drug-usage-note').focus(); return; }
  const dailyInput=document.getElementById('drug-daily');
  const daily=Number(dailyInput.value);
  if (!Number.isInteger(daily)||daily<1||daily>10) { alert('Günlük doz sayısı 1 ile 10 arasında olmalı.'); dailyInput.focus(); return; }
  if (timeSlots.length!==daily || timeSlots.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || new Set(timeSlots).size!==daily) {
    alert('Her doz için farklı ve geçerli bir saat girin. Günlük doz sayısı ile saat sayısı eşit olmalı.'); return;
  }
  const drug = {
    id: editId || Date.now(),
    name, photo,
    purpose: document.getElementById('drug-purpose').value.trim(),
    usageNote,
    doctor:   document.getElementById('drug-doctor').value.trim(),
    hospital: document.getElementById('drug-hospital').value.trim(),
    date:     document.getElementById('drug-date').value,
    daily,
    duration: document.getElementById('drug-duration').value,
    days:     document.getElementById('drug-days').value,
    alarm:    document.getElementById('drug-alarm').checked,
    times:    [...timeSlots],
    stock:    stockVal,
    usageCondition,
  };
  const nextDrugs = editId
    ? drugs.map(d => d.id == editId ? normalizeDrug(drug) : d)
    : [...drugs, normalizeDrug(drug)];
  try {
    saveDrugs(nextDrugs);
  } catch (error) {
    alert('İlaç kaydedilemedi. Cihazın depolama alanı dolu olabilir. Fotoğrafı küçültüp tekrar deneyin veya Ayarlar bölümünden yedek alın.');
    return;
  }
  drugs = nextDrugs;
  if (!editId) logHistory(drug.id, 'İlaç eklendi');
  closeModal(); renderAll(); scheduleAlarms();
  syncPushSchedule();
}

function deleteDrug() {
  if (!editId || !confirm('Bu ilacı silmek istediğinden emin misin?')) return;
  const nextDrugs = drugs.filter(d=>d.id!=editId);
  try { saveDrugs(nextDrugs); }
  catch (error) { alert('Silme işlemi kaydedilemedi. Depolama alanını kontrol edin.'); return; }
  logHistory(editId,'İlaç silindi');
  drugs = nextDrugs;
  closeModal(); renderAll(); scheduleAlarms();
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
  if (!PUSH_PUBLIC_KEY && !hasFirebaseConfig(FIREBASE_CONFIG)) {
    alert('Bildirim izni verildi. Ancak arka plan bildirim servisi henüz yapılandırılmadı. Hatırlatmalar yalnızca uygulama açıkken güvenilir çalışabilir; telefonunuzun alarmını da kullanın.');
  }
  await setupWebPush();
  await setupFirebaseMessaging();
  scheduleAlarms();
}

function hasFirebaseConfig(cfg) {
  return !!(cfg && cfg.apiKey && cfg.projectId && cfg.messagingSenderId && cfg.appId);
}

async function getFirebaseMessagingSwRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  if (!fcmSwRegistrationPromise) {
    fcmSwRegistrationPromise = navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
      { scope: '/firebase-cloud-messaging-push-scope' }
    );
  }
  return fcmSwRegistrationPromise;
}

async function setupFirebaseMessaging() {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission !== 'granted') return;
    if (!window.firebase || !window.firebase.messaging) {
      console.warn('Firebase Messaging SDK yüklenmedi.');
      return;
    }
    if (!hasFirebaseConfig(FIREBASE_CONFIG)) {
      console.warn('Firebase config eksik. window.__FIREBASE_CONFIG__ değerlerini doldurun.');
      return;
    }

    if (!window.firebase.apps || !window.firebase.apps.length) {
      window.firebase.initializeApp(FIREBASE_CONFIG);
    }

    const messaging = window.firebase.messaging();
    const swReg = await getFirebaseMessagingSwRegistration();
    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (token) {
      localStorage.setItem(LS_FCM_TOKEN, token);
      console.info('FCM token alındı.');
    } else {
      console.warn('FCM token alınamadı.');
    }

    if (!fcmOnMessageBound) {
      messaging.onMessage((payload) => {
        console.log('FCM foreground message:', payload);
      });
      fcmOnMessageBound = true;
    }
  } catch (err) {
    console.warn('Firebase Messaging kurulumu başarısız:', err);
  }
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
          body: `${d.name} — planlanan ilaç saati ${t}`,
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
  const token = localStorage.getItem(CLOUD_CREDENTIAL_KEY);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Cihaz eşleştirilmemiş');
  const res = await fetch(CLOUD_API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(payload),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Push API hata: ' + res.status);
  return res.json();
}

async function setupWebPush() {
  if (!isWebPushCapable() || !isStandalonePwa()) return;
  if (!PUSH_PUBLIC_KEY || !localStorage.getItem(CLOUD_CREDENTIAL_KEY)) return;
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY)
    });
  }
  await postPushJSON('/api/push-subscriptions', subscription.toJSON());
}

// Scheduling requires a separate authenticated backend endpoint and is deliberately
// disabled until the server can safely persist and dispatch the alarm plan.
async function syncPushSchedule() {
  return;
}

// ── UTILS ──
function todayStr() { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
function formatDate(s) { return s ? new Date(s).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}) : ''; }

// Full, local-only backup. No medication data is sent to a server.
function downloadBackup(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function currentBackup() {
  return {
    format: 'ilac-takip-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    drugs: loadDrugs(),
    takenLog: loadLog(),
    history: loadHistory()
  };
}

function exportData() {
  downloadBackup(currentBackup(), 'ilac-yedek-' + todayStr() + '.json');
}

function importData() {
  const input = document.getElementById('import-file');
  if (!input) return;
  input.value = '';
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Yedek dosyası 5 MB sınırını aşıyor.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Accept the older {drugs,takenLog} export without erasing existing history.
        if (!parsed || !Array.isArray(parsed.drugs) || !parsed.takenLog ||
            typeof parsed.takenLog !== 'object' || Array.isArray(parsed.takenLog) ||
            (parsed.history !== undefined && !Array.isArray(parsed.history)) ||
            parsed.drugs.length > 1000 || parsed.drugs.some(d => !d || typeof d !== 'object' ||
              typeof d.name !== 'string' || !d.name.trim())) {
          alert('Geçersiz veya desteklenmeyen yedek dosyası.');
          return;
        }
        const incomingDrugs = parsed.drugs.map(normalizeDrug);
        const incomingHistory = parsed.history !== undefined ? parsed.history : loadHistory();
        if (!confirm('Mevcut ilaçlar ve ALDIM kayıtları bu yedekle değiştirilecek. Önce mevcut verilerin yedeği indirilecek. Devam edilsin mi?')) return;
        // Download an undo backup before any local data is overwritten.
        downloadBackup(currentBackup(), 'ilac-geri-al-' + todayStr() + '.json');
        saveDrugs(incomingDrugs);
        saveLog(parsed.takenLog);
        if (parsed.history !== undefined) saveHistory(incomingHistory);
        drugs = incomingDrugs;
        takenLog = parsed.takenLog;
        renderAll();
        renderHistoryPage();
        scheduleAlarms();
        syncPushSchedule();
        alert('Yedek yüklendi. Önceki verilerin geri alma dosyasını saklayın.');
      } catch (err) {
        alert('Dosya okunamadı veya yükleme tamamlanamadı. Mevcut yedeğinizi kontrol edin.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

const CLOUD_API = 'https://ilac-takip-api.runanyrun.workers.dev';
const CLOUD_CREDENTIAL_KEY = 'ilac_test_device_token_v1';

function openCloudSetup() {
  const modal = document.getElementById('cloud-modal');
  document.getElementById('cloud-invite').value = '';
  document.getElementById('cloud-status').textContent =
    localStorage.getItem(CLOUD_CREDENTIAL_KEY)
      ? 'Bu tarayıcıda test cihazı anahtarı bulunuyor. Yeniden eşleştirmek mevcut anahtarı değiştirebilir.'
      : 'Henüz eşleştirilmedi. Mevcut ilaç kayıtlarınız yalnızca bu cihazda kalır.';
  modal.classList.add('open');
}

function closeCloudSetup() {
  document.getElementById('cloud-invite').value = '';
  document.getElementById('cloud-modal').classList.remove('open');
}

async function connectCloudDevice() {
  const input = document.getElementById('cloud-invite');
  const status = document.getElementById('cloud-status');
  const button = document.getElementById('cloud-connect-btn');
  const invite = input.value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(invite)) {
    status.textContent = 'Davet kodu 64 karakterlik onaltılık değer olmalı.';
    return;
  }
  if (localStorage.getItem(CLOUD_CREDENTIAL_KEY) &&
      !confirm('Mevcut test cihazı bağlantısı değiştirilecek. Devam edilsin mi?')) return;
  button.disabled = true;
  status.textContent = 'Eşleştirme deneniyor…';
  try {
    const response = await fetch(CLOUD_API + '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite }),
      cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok || !/^[a-f0-9]{64}$/.test(result.token || '')) {
      status.textContent = response.status === 403
        ? 'Kod geçersiz veya daha önce kullanılmış.'
        : 'Eşleştirme başarısız (' + response.status + ').';
      return;
    }
    localStorage.setItem(CLOUD_CREDENTIAL_KEY, result.token);
    input.value = '';
    status.textContent = 'Test cihazı eşleştirildi. Bildirim gönderimi henüz etkin değil.';
  } catch {
    status.textContent = 'Sunucuya bağlanılamadı. İnternet bağlantısını kontrol edin.';
  } finally {
    button.disabled = false;
  }
}

document.getElementById('add-modal').addEventListener('click',function(e){if(e.target===this)closeModal();});
document.getElementById('detail-modal').addEventListener('click',function(e){if(e.target===this)closeModal();});
