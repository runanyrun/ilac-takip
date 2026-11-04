// Legacy MVP safeguards. This is not the unavailable live Cloudflare Worker.
(() => {
  const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const id = value => Number.isSafeInteger(value) && value > 0;
  function validDrugs(value) {
    if (!Array.isArray(value) || value.length > 1000) return false;
    const ids = new Set();
    return value.every(d => {
      if (!record(d) || !id(d.id) || ids.has(d.id)) return false;
      ids.add(d.id);
      return typeof d.name === 'string' && !!d.name.trim() && d.name.length <= 500 &&
        Number.isSafeInteger(d.stock) && d.stock >= 0 &&
        Number.isSafeInteger(d.daily) && d.daily >= 1 && d.daily <= 10 &&
        Array.isArray(d.times) && d.times.every(time) && new Set(d.times).size === d.times.length &&
        ['omur_boyu', 'sure', 'adet'].includes(d.duration) &&
        (d.duration !== 'sure' || (/^\d+$/.test(String(d.days)) && Number(d.days) > 0)) &&
        ['photo', 'purpose', 'usageNote', 'doctor', 'hospital', 'date'].every(k => d[k] == null || typeof d[k] === 'string') &&
        (d.alarm === undefined || typeof d.alarm === 'boolean');
    });
  }
  function validLog(value) {
    return record(value) && Object.entries(value).every(([key, stamp]) =>
      /^\d{4}-\d{2}-\d{2}_\d+_([01]\d|2[0-3]):[0-5]\d$/.test(key) &&
      (stamp === 'skipped' || stamp === true || (typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)))));
  }
  function validHistory(value) {
    return Array.isArray(value) && value.every(h => record(h) &&
      typeof h.name === 'string' && typeof h.action === 'string' &&
      typeof h.ts === 'string' && Number.isFinite(Date.parse(h.ts)));
  }
  function backup(value) {
    if (!record(value) || (value.format !== undefined && value.format !== 'ilac-takip-backup') ||
      (value.version !== undefined && value.version !== 2) || !validDrugs(value.drugs) ||
      !value.drugs.every(d => d.times.length === d.daily) ||
      !validLog(value.takenLog) || (value.history !== undefined && !validHistory(value.history)))
      throw new Error('Geçersiz veya desteklenmeyen yedek. Mevcut veriler değiştirilmedi.');
    return value;
  }
  const html = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const photo = value => typeof value === 'string' &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
  function storage(store, specs) {
    const journalKey = 'ilac_transaction_v1';
    let recoveryFailed = false;
    // Before-images survive a tab/process crash between legacy-key writes.
    // Never overwrite a divergent value: retain the journal for manual recovery.
    try {
      const raw = store.getItem(journalKey);
      if (raw !== null) {
        const journal = JSON.parse(raw);
        if (!record(journal) || journal.version !== 1 || !record(journal.before) || !record(journal.after) ||
            !Object.keys(journal.before).length || Object.keys(journal.before).length !== Object.keys(journal.after).length) throw new Error('invalid journal');
        for (const key of Object.keys(journal.before)) {
          if (!specs[key] || !(key in journal.after)) throw new Error('unknown journal key');
          const old = journal.before[key], next = journal.after[key];
          if ((old !== null && (typeof old !== 'string' || !specs[key].valid(JSON.parse(old)))) ||
              typeof next !== 'string' || !specs[key].valid(JSON.parse(next))) throw new Error('invalid journal value');
          const current = store.getItem(key);
          if (current !== old && current !== next) throw new Error('divergent journal');
        }
        for (const [key, old] of Object.entries(journal.before)) old === null ? store.removeItem(key) : store.setItem(key, old);
        store.removeItem(journalKey);
      }
    } catch (_) { recoveryFailed = true; }
    const expected = new Map(), faults = new Set();
    function read(key) {
      try {
        if (recoveryFailed) throw new Error('recovery blocked');
        const raw = store.getItem(key);
        if (!expected.has(key)) expected.set(key, raw);
        const value = raw === null ? specs[key].empty() : JSON.parse(raw);
        if (!specs[key].valid(value)) throw new Error('invalid stored data');
        return value;
      } catch (_) { faults.add(key); return specs[key].empty(); }
    }
    function commit(values) {
      for (const key of Object.keys(specs)) read(key);
      if (faults.size) throw new Error('Yerel veriler okunamadı. Kayıtlar korunuyor; yazma durduruldu. Ham yedeği dışa aktarın.');
      const before = new Map(), encoded = new Map();
      for (const key of Object.keys(values)) {
        if (!specs[key] || !specs[key].valid(values[key])) throw new Error('Geçersiz kayıt; veriler değiştirilmedi.');
        const raw = store.getItem(key);
        if (raw !== expected.get(key)) throw new Error('Başka sekmede veri değişti. Önce sayfayı yeniden yükleyin.');
        before.set(key, raw); encoded.set(key, JSON.stringify(values[key]));
      }
      if (store.getItem(journalKey) !== null) throw new Error('Bekleyen işlem var. Önce sayfayı yeniden yükleyin.');
      const written = [];
      try {
        store.setItem(journalKey, JSON.stringify({version:1, before:Object.fromEntries(before), after:Object.fromEntries(encoded)}));
        for (const [key, raw] of encoded) { store.setItem(key, raw); written.push(key); }
        store.removeItem(journalKey);
      } catch (_) {
        let restored = true;
        for (const key of written.reverse()) {
          try { const old = before.get(key); old === null ? store.removeItem(key) : store.setItem(key, old); }
          catch (_) { restored = false; faults.add(key); }
        }
        if (restored) { try { store.removeItem(journalKey); } catch (_) { restored = false; } }
        if (!restored) { recoveryFailed = true; Object.keys(specs).forEach(key => faults.add(key)); }
        throw new Error(restored ? 'Depolama dolu veya kullanılamıyor. Değişiklik geri alındı.' :
          'Depolama hatası; geri alma tamamlanamadı. Yazma durduruldu; ham yedeği dışa aktarın.');
      }
      for (const [key, raw] of encoded) expected.set(key, raw);
    }
    return { read, commit, faults };
  }
  globalThis.IlacSafety = { validDrugs, validLog, validHistory, backup, html, photo, storage };
})();
