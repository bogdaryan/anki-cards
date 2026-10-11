// Level Up: карточки. Простое интервальное повторение без сервера: прогресс — в localStorage
// телефона. Ответы: «Не помню» — карточка вернётся в этой же сессии; «Помню» — интервал
// растёт в 2,5 раза (первый — 1 день); «Легко» — в 4 раза (первый — 3 дня).
// «Сказать» по выражению становится доступна, когда его «Понять» уже выучено (интервал ≥ 1 дня).
// Новых в день — 10, 20 или 30, выбирается на главной. Когда норма пройдена: «Ещё 10 новых»
// добавляет разово на сегодня, «Потренироваться» гоняет знакомые карточки, не трогая расписание.
// Серия — дни подряд, в которые была хотя бы одна оценка; кольцо — сколько пройдено сегодня.
// «∞» — без лимита: новые идут порциями по 20, пока не надоест.
// Уровни: B1–B2 включён, C1–C2 по умолчанию выключен; включается на главной.
// Доступ по коду: карточки лежат зашифрованными (cards.enc, AES-256-GCM, ключ — PBKDF2 из кода).
// Самого кода в приложении нет: верный код просто расшифровывает данные. Ключ, полученный из
// верного кода, запоминается на устройстве; «Заблокировать» в профилях его стирает.
// Аккаунты: у каждого свой прогресс (свой ключ в localStorage). Прогресс живёт только на этом
// устройстве: на другом телефоне — свой, никуда не уходит.
// Режимы: «Фразы» (выражения в предложениях) и «Слова» (отдельные слова, 5000 B1–B2 + 5000 C1–C2).
// У каждого режима свой счётчик новых за день; прогресс карточек общий файл, но id разные (w:…).
(() => {
  const OLD_KEY = 'levelup-cards-v1';
  const PROFILES_KEY = 'levelup-profiles';
  const LIMITS = [10, 20, 30, 0]; // 0 — без лимита
  const PORTION = 20;
  const LEVELS = { b: ['A2', 'B1', 'B2'], c: ['C1', 'C2'] }; // A2 — база, которую надо закрыть по пути к B2
  const DAY = 86400000;
  const TOPIC_COLORS = ['--violet', '--coral', '--mint', '--sun', '--sky', '--pink'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const app = document.getElementById('app');

  let all = [];
  let allWords = [];
  let cards = [];
  const topicIndex = {};
  let profiles = { list: [], current: null };
  let state = null; // читается после объявления всех функций — см. загрузку внизу
  let session = null;
  let confirmReset = false;

  // ——— зум запрещён: щипок и двойной тап ———
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  // ——— хранение ———
  function blank() { return { cards: {}, newDay: '', newCount: 0, newCountW: 0, limit: 10, bonus: 0, bonusW: 0, days: [], doneDay: '', doneCount: 0, levels: { b: true, c: false }, mode: 'phrases' }; }
  // ——— профили ———
  function loadProfiles() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROFILES_KEY)); } catch { /* нет памяти */ }
    if (p && p.list && p.list.length) return p;
    // первый запуск после обновления: старый прогресс становится первым профилем
    let old = null;
    try { old = localStorage.getItem(OLD_KEY); } catch { /* нет памяти */ }
    if (old) {
      p = { list: [{ id: 'p1', name: 'Мой аккаунт', admin: true, created: Date.now() }], current: 'p1' };
      try { localStorage.setItem(`${OLD_KEY}:p1`, old); localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch { /* нет памяти */ }
      return p;
    }
    return { list: [], current: null };
  }
  function saveProfiles() { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch { /* нет памяти */ } }
  const stateKey = () => `${OLD_KEY}:${profiles.current}`;
  const profileName = () => (profiles.list.find((x) => x.id === profiles.current) || {}).name || '';
  function load() {
    if (!profiles.current) return blank();
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(stateKey())) || {}); } catch { return blank(); }
  }
  function save() { if (!profiles.current) return; try { localStorage.setItem(stateKey(), JSON.stringify(state)); } catch { /* без памяти — работаем в пределах сессии */ } }
  function touch() { const a = curAcc(); if (a) { a.last = Date.now(); saveProfiles(); } }
  // ——— аккаунты: ник + пароль. Пароль не хранится: только соль и PBKDF2-хеш ———
  const PASS_ITER = 150000;
  const enc8 = (t) => new TextEncoder().encode(t);
  async function hashPass(pass, saltB64) {
    const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey('raw', enc8(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PASS_ITER, hash: 'SHA-256' }, base, 256));
    return { salt: btoa(String.fromCharCode(...salt)), hash: btoa(String.fromCharCode(...bits)) };
  }
  function sameHash(a, b) { // сравнение без раннего выхода
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }
  const findAcc = (nick) => profiles.list.find((x) => x.name.toLowerCase() === nick.trim().toLowerCase());
  const curAcc = () => profiles.list.find((x) => x.id === profiles.current);
  const isAdmin = () => !!(curAcc() || {}).admin;
  function enter(id) {
    profiles.current = id;
    const a = curAcc(); if (a) a.last = Date.now();
    saveProfiles(); state = load(); applyLevels();
  }
  async function createAccount(nick, pass) {
    const { salt, hash } = await hashPass(pass);
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    profiles.list.push({ id, name: nick.trim(), salt, hash, admin: profiles.list.length === 0, created: Date.now(), last: Date.now() });
    enter(id);
  }
  function removeAccount(id) {
    try { localStorage.removeItem(`${OLD_KEY}:${id}`); } catch { /* нет памяти */ }
    profiles.list = profiles.list.filter((x) => x.id !== id);
    saveProfiles();
  }
  function logout() { profiles.current = null; saveProfiles(); state = blank(); }

  // ——— уровни ———
  const levelsOn = () => Object.assign({ b: true, c: false }, state.levels || {});
  const isWords = () => state.mode === 'words' && allWords.length > 0;
  const W = () => (isWords() ? 'W' : ''); // суффикс счётчиков режима «Слова»
  function applyLevels() {
    const on = levelsOn();
    const allowed = [...(on.b ? LEVELS.b : []), ...(on.c ? LEVELS.c : [])];
    cards = (isWords() ? allWords : all).filter((c) => allowed.includes(c.level));
  }
  const today = () => new Date().toLocaleDateString('sv');
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function rollDay() {
    if (state.newDay !== today()) { state.newDay = today(); state.newCount = 0; state.newCountW = 0; state.bonus = 0; state.bonusW = 0; }
    if (state.doneDay !== today()) { state.doneDay = today(); state.doneCount = 0; }
  }
  const unlimited = () => state.limit === 0;
  function newLeft() {
    rollDay();
    if (unlimited()) return Infinity;
    return Math.max(0, (state.limit || 10) + (state[`bonus${W()}`] || 0) - (state[`newCount${W()}`] || 0));
  }
  function streak() {
    const set = new Set(state.days || []);
    const d = new Date(); d.setHours(12);
    if (!set.has(d.toLocaleDateString('sv'))) d.setDate(d.getDate() - 1); // сегодня ещё не занимались — считаем от вчера
    let n = 0;
    while (set.has(d.toLocaleDateString('sv'))) { n += 1; d.setDate(d.getDate() - 1); }
    return n;
  }
  function markDay() {
    const t = today();
    if (!state.days.includes(t)) state.days = [...state.days.slice(-400), t];
    rollDay();
    state.doneCount += 1;
  }

  const due = () => cards.filter((c) => state.cards[c.id] && state.cards[c.id].due <= Date.now());
  const twin = (c) => c.id.replace(/:say$/, ':understand');
  const fresh = () => {
    const ready = cards.filter((c) => c.side === 'say' && !state.cards[c.id] && state.cards[twin(c)] && state.cards[twin(c)].ivl >= 1);
    return [...ready, ...cards.filter((c) => c.side === 'understand' && !state.cards[c.id])];
  };
  const learned = () => cards.filter((c) => state.cards[c.id] && state.cards[c.id].ivl >= 1).length;

  // ——— разметка ———
  const plural = (n, one, few, many) => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  };
  const fmtN = (x) => Math.round(x).toLocaleString('ru');
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
  const days = (n) => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return `${n} день`;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} дня`;
    return `${n} дней`;
  };
  const when = (t) => {
    const d = Math.round((new Date(t).setHours(0, 0, 0, 0) - startOfDay()) / DAY);
    if (d <= 0) return 'сегодня, чуть позже';
    if (d === 1) return 'завтра';
    return new Date(t).toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const topicColor = (t) => `var(${TOPIC_COLORS[(topicIndex[t] || 0) % TOPIC_COLORS.length]})`;
  const speakIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const person = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
  const flame = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5-1.5 7.5A2.5 2.5 0 0 0 13 12c1.6 0 2.5-1.4 2.3-3 2.4 1.6 3.7 4.2 3.7 7a7 7 0 1 1-14 0c0-4.7 4-7.2 7-14z"/></svg>';

  function ring(done, goal) {
    const r = 26, len = 2 * Math.PI * r;
    const frac = goal ? Math.min(1, done / goal) : 1;
    return `<div class="ring" role="img" aria-label="Сегодня ${done} из ${goal}">
      <svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="${r}" fill="none" stroke-width="6"/>
      <circle class="fill" cx="32" cy="32" r="${r}" fill="none" stroke-width="6" stroke-dasharray="${len}" stroke-dashoffset="${len}" data-to="${len * (1 - frac)}"/></svg>
      <b>${done}/${goal}</b><small>сегодня</small></div>`;
  }

  function home() {
    session = null;
    rollDay();
    const d = due().length;
    const n = Math.min(unlimited() ? PORTION : newLeft(), fresh().length);
    const lim = state.limit ?? 10;
    const on = levelsOn();
    const total = cards.length;
    const l = learned();
    const seen = cards.filter((c) => state.cards[c.id]).length;
    const pct = (x) => (total ? (x / total) * 100 : 0);
    const nothing = d + n === 0;
    const next = Object.values(state.cards).map((s) => s.due).filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
    const s = streak();
    const fmt = (x) => x.toLocaleString('ru');
    app.className = 'screen';
    app.innerHTML = `
      <header class="head">
        <div class="head-text">
          <div class="eyebrow">LEVEL UP · АНГЛИЙСКИЙ</div>
          <h1 class="title">${isWords() ? 'Слова' : 'Фразы'}</h1>
          <div class="deck">${[on.b ? 'B1–B2' : '', on.c ? 'C1–C2' : ''].filter(Boolean).join(' + ')} · ${fmt(total / 2)} ${isWords() ? plural(total / 2, 'слово', 'слова', 'слов') : plural(total / 2, 'выражение', 'выражения', 'выражений')}, ${fmt(total)} ${plural(total, 'карточка', 'карточки', 'карточек')}</div>
        </div>
        ${ring(state.doneCount, state.doneCount + d + n)}
      </header>
      <div class="modes" role="tablist" aria-label="Режим">
        <button class="mode${isWords() ? '' : ' on'}" data-mode="phrases" role="tab" aria-selected="${!isWords()}"><b>Фразы</b><span>выражения в предложениях</span></button>
        <button class="mode${isWords() ? ' on' : ''}" data-mode="words" role="tab" aria-selected="${isWords()}"><b>Слова</b><span>отдельные слова</span></button>
      </div>
      <div class="chips-row">
        <span class="pill${s ? ' hot' : ''}">${flame}<span>серия</span><b>${days(s)}</b></span>
        <span class="pill"><span>знакомых</span><b>${fmt(seen)}</b></span>
        <button class="pill who" id="who" aria-label="Аккаунт: ${esc(profileName())}">${person}<b>${esc(profileName())}</b></button>
      </div>
      <section class="stats" aria-label="Сегодня">
        <div class="stat" style="--c: var(--coral)"><b>${d}</b><span>повторить</span></div>
        <div class="stat" style="--c: var(--violet)"><b>${n}</b><span>${unlimited() ? 'новых за заход' : 'новых сегодня'}</span></div>
        <div class="stat" style="--c: var(--mint)"><b>${fmt(l)}</b><span>в памяти</span></div>
      </section>
      <section>
        <div class="xp" aria-hidden="true"><i style="width:${pct(l)}%; background: var(--mint)"></i><i style="width:${pct(seen - l)}%; background: var(--sun)"></i></div>
        <div class="xp-label"><span>Полоса опыта</span><span>${fmt(l)} из ${fmt(total)}</span></div>
      </section>
      <div class="settings">
        <div class="limit" role="group" aria-label="Новых в день"><span>Новых в день</span>
          ${LIMITS.map((k) => `<button class="seg${lim === k ? ' on' : ''}" data-limit="${k}" aria-pressed="${lim === k}">${k || '∞'}</button>`).join('')}
        </div>
        <div class="limit" role="group" aria-label="Уровень"><span>Уровень</span>
          <button class="seg wide${on.b ? ' on' : ''}" data-level="b" aria-pressed="${on.b}">B1–B2</button>
          <button class="seg wide${on.c ? ' on c' : ''}" data-level="c" aria-pressed="${on.c}">C1–C2</button>
        </div>
      </div>
      <button class="primary" id="start" ${nothing ? 'disabled' : ''}>${nothing ? 'На сегодня всё' : 'Начать'}</button>
      ${nothing ? `<p class="note">${next ? `Следующее повторение — ${when(next)}.` : 'Все карточки пройдены.'} Хотите ещё — выбирайте:</p>
        <div class="more">
          ${fresh().length && !unlimited() ? '<button class="secondary" id="bonus"><b>Ещё 10 новых</b><span>разово, на сегодня</span></button>' : ''}
          ${seen ? '<button class="secondary" id="practice"><b>Потренироваться</b><span>знакомые, график не меняется</span></button>' : ''}
        </div>` : ''}
      <div class="spacer"></div>
      <p class="note">${isWords() ? 'Каждое слово' : 'Каждое выражение'} — две карточки: сначала «Понять», а когда ${isWords() ? 'оно выучено' : 'оно выучено'} — «Сказать». Отвечайте вслух. Прогресс хранится на этом телефоне, в вашем аккаунте.</p>
      ${confirmReset ? `
        <div class="confirm"><span>Сбросить весь прогресс? Это не отменить.</span>
          <div class="row"><button id="no">Оставить</button><button class="danger" id="yes">Сбросить</button></div></div>`
        : '<button class="link" id="reset">Сбросить прогресс</button>'}
    `;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = app.querySelector('.ring .fill');
      if (f) f.style.strokeDashoffset = f.dataset.to;
    }));
    app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { state.mode = b.dataset.mode; save(); applyLevels(); home(); }; });
    app.querySelectorAll('[data-limit]').forEach((b) => { b.onclick = () => { state.limit = +b.dataset.limit; save(); home(); }; });
    app.querySelectorAll('[data-level]').forEach((b) => {
      b.onclick = () => {
        const lv = levelsOn();
        lv[b.dataset.level] = !lv[b.dataset.level];
        if (!lv.b && !lv.c) return; // хотя бы один уровень включён
        state.levels = lv; save(); applyLevels(); home();
      };
    });
    document.getElementById('who').onclick = () => accountScreen();
    if (!nothing) document.getElementById('start').onclick = begin;
    const bonus = document.getElementById('bonus');
    if (bonus) bonus.onclick = () => { newLeft(); state[`bonus${W()}`] = (state[`bonus${W()}`] || 0) + 10; save(); begin(); };
    const pr = document.getElementById('practice');
    if (pr) pr.onclick = practice;
    const r = document.getElementById('reset');
    if (r) r.onclick = () => { confirmReset = true; home(); };
    const y = document.getElementById('yes');
    if (y) {
      y.onclick = () => { state = Object.assign(blank(), { limit: state.limit ?? 10, levels: levelsOn(), mode: state.mode }); save(); confirmReset = false; home(); };
      document.getElementById('no').onclick = () => { confirmReset = false; home(); };
    }
  }

  // ——— экраны входа ———
  let locked = null; // зашифрованные данные ждут код приглашения (новый телефон или «Заблокировать»)
  const waitLeft = () => { try { return Math.ceil(((+localStorage.getItem('levelup-wait') || 0) - Date.now()) / 1000); } catch { return 0; } };
  function failed() {
    try {
      const n = (+localStorage.getItem('levelup-fails') || 0) + 1;
      localStorage.setItem('levelup-fails', n);
      if (n >= 5) { localStorage.setItem('levelup-wait', Date.now() + 30000); localStorage.setItem('levelup-fails', 0); }
    } catch { /* нет памяти */ }
  }
  function okTry() { try { localStorage.removeItem('levelup-fails'); } catch { /* нет памяти */ } }

  async function unlock(code) {
    const key = await deriveKey(code, new Uint8Array(locked.buf).slice(3, 19));
    const [data, words] = await openAll(locked.buf, locked.wbuf, key);
    try { localStorage.setItem(KEY_STORE, b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))); } catch { /* нет памяти */ }
    locked = null;
    start(data, words, true);
  }

  // tab: 'login' | 'reg' | 'claim' (старый аккаунт без пароля — задать ник и пароль)
  function authScreen(tab, msg) {
    const invite = !!locked;
    const claim = tab === 'claim';
    app.className = 'screen';
    app.innerHTML = `
      <div class="pin-head">
        <img class="pin-icon" src="icons/icon-192.png" alt="">
        <div class="eyebrow">LEVEL UP · АНГЛИЙСКИЙ</div>
        <h1 class="title">${claim ? 'Защитите аккаунт' : tab === 'reg' ? 'Регистрация' : 'Вход'}</h1>
      </div>
      ${claim ? '<p class="note center">Придумайте ник и пароль — прогресс останется ваш, и без пароля его никто не откроет.</p>' : `
      <div class="modes" role="tablist">
        <button class="mode${tab === 'login' ? ' on' : ''}" data-tab="login" role="tab" aria-selected="${tab === 'login'}"><b>Вход</b><span>уже есть аккаунт</span></button>
        <button class="mode${tab === 'reg' ? ' on' : ''}" data-tab="reg" role="tab" aria-selected="${tab === 'reg'}"><b>Регистрация</b><span>новый аккаунт</span></button>
      </div>`}
      <form class="profile-form" id="af" autocomplete="on">
        <label for="nick">Ник</label>
        <input id="nick" name="username" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false" value="${claim ? esc((curAcc() || {}).name || '') : ''}" required>
        <label for="pass">Пароль</label>
        <input id="pass" name="password" type="password" minlength="4" maxlength="64" autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" required>
        ${tab !== 'login' ? `<label for="pass2">Пароль ещё раз</label>
        <input id="pass2" name="password2" type="password" minlength="4" maxlength="64" autocomplete="new-password" required>` : ''}
        ${invite ? `<label for="inv">Код приглашения</label>
        <input id="inv" name="invite" inputmode="numeric" maxlength="12" autocomplete="one-time-code" required>` : ''}
        <p class="note pin-msg" role="status">${esc(msg || (invite ? 'Код приглашения нужен один раз на этом телефоне.' : ''))}</p>
        <button class="primary" type="submit">${claim ? 'Сохранить' : tab === 'reg' ? 'Создать аккаунт' : 'Войти'}</button>
      </form>
      <div class="spacer"></div>
      <p class="note">Аккаунты хранятся только на этом телефоне. Пароль не сохраняется — только его хеш.</p>`;
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => authScreen(b.dataset.tab); });
    const form = document.getElementById('af');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const wait = waitLeft();
      if (wait > 0) return authScreen(tab, `Слишком много попыток. Подождите ${wait} с.`);
      const nick = document.getElementById('nick').value.trim();
      const pass = document.getElementById('pass').value;
      const pass2 = tab !== 'login' ? document.getElementById('pass2').value : pass;
      const btn = form.querySelector('button[type=submit]');
      if (nick.length < 2) return authScreen(tab, 'Ник — от 2 символов.');
      if (pass.length < 4) return authScreen(tab, 'Пароль — от 4 символов.');
      if (pass !== pass2) return authScreen(tab, 'Пароли не совпадают.');
      if (tab === 'reg' && findAcc(nick)) return authScreen(tab, 'Такой ник уже есть на этом телефоне.');
      if (claim && findAcc(nick) && findAcc(nick).id !== profiles.current) return authScreen(tab, 'Такой ник уже есть на этом телефоне.');
      btn.disabled = true; btn.textContent = 'Проверяю…';
      try {
        if (locked) {
          try { await unlock(document.getElementById('inv').value.trim()); } catch {
            failed(); return authScreen(tab, 'Неверный код приглашения.');
          }
        }
        if (tab === 'reg') { await createAccount(nick, pass); okTry(); return home(); }
        if (claim) {
          const a = curAcc(); Object.assign(a, { name: nick }, await hashPass(pass)); a.admin = a.admin !== false; enter(a.id); okTry(); return home();
        }
        const a = findAcc(nick);
        if (!a) { failed(); return authScreen(tab, 'Неверный ник или пароль.'); }
        if (!a.hash) { Object.assign(a, await hashPass(pass)); enter(a.id); okTry(); return home(); } // старый аккаунт: первый вход задаёт пароль
        const { hash } = await hashPass(pass, a.salt);
        if (!sameHash(hash, a.hash)) { failed(); return authScreen(tab, 'Неверный ник или пароль.'); }
        okTry(); enter(a.id); home();
      } catch { authScreen(tab, 'Что-то пошло не так. Попробуйте ещё раз.'); }
    };
  }

  function statsOf(id) {
    let st = {};
    try { st = JSON.parse(localStorage.getItem(`${OLD_KEY}:${id}`)) || {}; } catch { /* нет памяти */ }
    const ids = Object.keys(st.cards || {});
    const set = new Set(st.days || []);
    const d = new Date(); d.setHours(12);
    if (!set.has(d.toLocaleDateString('sv'))) d.setDate(d.getDate() - 1);
    let streakN = 0;
    while (set.has(d.toLocaleDateString('sv'))) { streakN += 1; d.setDate(d.getDate() - 1); }
    return { phrases: ids.filter((x) => !x.startsWith('w:')).length, words: ids.filter((x) => x.startsWith('w:')).length, streak: streakN, days: set.size };
  }
  const dateRu = (t) => (t ? new Date(t).toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const backBtn = '<button class="close" id="back" aria-label="Назад"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>';

  function accountScreen() {
    const a = curAcc();
    const st = statsOf(a.id);
    app.className = 'screen';
    app.innerHTML = `
      <div class="bar">${backBtn}<div class="eyebrow">АККАУНТ</div></div>
      <div class="pick acc-card">${person}<span><b>${esc(a.name)}</b><small>${a.admin ? 'админ · ' : ''}с ${dateRu(a.created)}</small></span></div>
      <section class="stats">
        <div class="stat" style="--c: var(--violet)"><b>${fmtN(st.phrases)}</b><span>фраз знакомо</span></div>
        <div class="stat" style="--c: var(--mint)"><b>${fmtN(st.words)}</b><span>слов знакомо</span></div>
        <div class="stat" style="--c: var(--sun)"><b>${st.streak}</b><span>дней подряд</span></div>
      </section>
      ${a.admin ? '<button class="secondary" id="users"><b>Все пользователи</b><span>кто заходил на этом телефоне и их прогресс</span></button>' : ''}
      <button class="secondary-btn" id="out">Выйти из аккаунта</button>
      <div class="spacer"></div>
      ${a.admin ? '<button class="link" id="lock">Заблокировать телефон: снова спросить код приглашения</button>' : ''}
      <p class="note">Прогресс хранится только на этом телефоне.</p>`;
    document.getElementById('back').onclick = home;
    document.getElementById('out').onclick = () => { logout(); authScreen('login'); };
    const u = document.getElementById('users'); if (u) u.onclick = () => usersScreen();
    const l = document.getElementById('lock'); if (l) l.onclick = () => { forgetKey(); logout(); location.reload(); };
  }

  let confirmDel = null;
  function usersScreen() {
    if (!isAdmin()) return home();
    app.className = 'screen';
    app.innerHTML = `
      <div class="bar">${backBtn}<div class="eyebrow">ПОЛЬЗОВАТЕЛИ · ${profiles.list.length}</div></div>
      <div class="plist">
        ${profiles.list.map((x) => {
          const st = statsOf(x.id);
          const me = x.id === profiles.current;
          return `<div class="urow${me ? ' cur' : ''}">
            <div class="uhead">${person}<b>${esc(x.name)}</b>${x.admin ? '<span class="tag">админ</span>' : ''}${me ? '<span class="tag me">вы</span>' : ''}${x.hash ? '' : '<span class="tag warn">без пароля</span>'}</div>
            <div class="ustats"><span>фраз <b>${fmtN(st.phrases)}</b></span><span>слов <b>${fmtN(st.words)}</b></span><span>серия <b>${st.streak}</b></span><span>дней <b>${st.days}</b></span></div>
            <div class="umeta">создан ${dateRu(x.created)} · заходил ${dateRu(x.last)}</div>
            ${me ? '' : confirmDel === x.id
              ? `<button class="del sure" data-del="${x.id}">Точно удалить ${esc(x.name)}</button>`
              : `<button class="link left" data-ask="${x.id}">Удалить</button>`}
          </div>`;
        }).join('')}
      </div>
      <p class="note">Видно аккаунты этого телефона. Пароли не видны никому — хранится только их хеш.</p>`;
    document.getElementById('back').onclick = () => { confirmDel = null; accountScreen(); };
    app.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { confirmDel = b.dataset.ask; usersScreen(); }; });
    app.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { removeAccount(b.dataset.del); confirmDel = null; usersScreen(); }; });
  }

  function begin() {
    const queue = [...due(), ...fresh().slice(0, unlimited() ? PORTION : newLeft())];
    session = { queue, done: 0, total: queue.length, again: 0, shown: false };
    show();
  }

  // Тренировка: до 20 знакомых карточек вперемешку; ответы не меняют расписание.
  function practice() {
    const pool = cards.filter((c) => state.cards[c.id]);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const queue = pool.slice(0, 20);
    session = { queue, done: 0, total: queue.length, again: 0, shown: false, practice: true };
    show();
  }

  function speak(text, btn) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.92;
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang === 'en-US') || voices.find((x) => x.lang.startsWith('en'));
    if (v) u.voice = v;
    if (btn) { btn.classList.add('playing'); u.onend = u.onerror = () => btn.classList.remove('playing'); }
    speechSynthesis.speak(u);
  }

  function nextIvl(c, grade) {
    const s = state.cards[c.id];
    const ivl = s ? s.ivl : 0;
    if (grade === 'good') return ivl ? Math.round(ivl * 2.5) : 1;
    return ivl ? Math.round(ivl * 4) : 3;
  }

  function show(revealing) {
    const c = session.queue[0];
    if (!c) return finish();
    const understand = c.side === 'understand';
    const pct = (session.done / session.total) * 100;
    const word = c.kind === 'word';
    const front = word && understand
      ? `<div class="word">${esc(c.expr)}</div><div class="ipa">/${esc(c.ipa)}/</div>
         <div class="hint">Как переводится? Сначала скажите вслух.</div>
         <button class="speak" id="say">${speakIcon}Послушать</button>`
      : word
        ? `<div class="sentence">${esc(c.tr)}</div>
         <div class="hint">Как это по-английски? Подсказка: <b>${esc(c.hint)}</b></div>`
        : understand
      ? `<div class="sentence">${c.en}</div>
         <div class="hint">Что значит выделенное? Сначала скажите вслух.</div>
         <button class="speak" id="say">${speakIcon}Послушать</button>`
      : `<div class="sentence">${esc(c.ru)}</div>
         <div class="hint">Скажите по-английски вслух. Подсказка: <b>${esc(c.hint)}</b></div>`;
    const back = word && understand
      ? `<div class="answer"><div class="expr tr-big">${esc(c.tr)}</div>
           <div class="ex"><small>ПРИМЕР</small>${esc(c.ex)}</div>
           <button class="speak" id="say3">${speakIcon}Послушать пример</button></div>`
      : word
        ? `<div class="answer"><div class="word">${esc(c.expr)}</div><div class="ipa">/${esc(c.ipa)}/</div>
           <button class="speak" id="say2">${speakIcon}Послушать</button>
           <div class="ex"><small>ПРИМЕР</small>${esc(c.ex)}</div></div>`
        : understand
      ? `<div class="answer"><div class="expr">${esc(c.expr)}</div><div>${c.meaning}</div><div class="tr">${esc(c.tr)}</div>
           <div class="ex"><small>ЕЩЁ ПРИМЕР</small>${esc(c.ex)}</div></div>`
      : `<div class="answer"><div class="sentence">${c.en}</div><div class="expr">${esc(c.expr)}</div>
           <button class="speak" id="say2">${speakIcon}Послушать</button></div>`;
    app.className = '';
    app.innerHTML = `
      <div class="bar">
        <button class="close" id="close" aria-label="Закончить"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <div class="count">${session.done}/${session.total}</div>
      </div>
      <article class="card ${c.level}"${revealing ? ' style="animation:none"' : ''}>
        <div class="orb"></div>
        <div class="chips"><span class="chip">${c.level}</span><span class="chip side">${understand ? 'ПОНЯТЬ' : 'СКАЗАТЬ'}</span>${session.practice ? '<span class="chip side">ТРЕНИРОВКА</span>' : ''}</div>
        <div class="topic" style="--tc:${topicColor(c.topic)}"><i></i>${esc(c.topic || '')}</div>
        ${front}
        ${session.shown ? back : ''}
      </article>
      <div class="spacer"></div>
      ${session.shown && session.practice ? `
        <div class="grades two">
          <button class="grade g-again" data-p="again"><b>Не помню</b><span>ещё раз в конце</span></button>
          <button class="grade g-good" data-p="ok"><b>Помню</b><span>дальше</span></button>
        </div>` : session.shown ? `
        <div class="grades">
          <button class="grade g-again" data-g="again"><b>Не помню</b><span>сейчас ещё раз</span></button>
          <button class="grade g-good" data-g="good"><b>Помню</b><span>через ${days(nextIvl(c, 'good'))}</span></button>
          <button class="grade g-easy" data-g="easy"><b>Легко</b><span>через ${days(nextIvl(c, 'easy'))}</span></button>
        </div>` : '<button class="primary" id="reveal">Показать ответ</button>'}
    `;
    document.getElementById('close').onclick = home;
    const say = document.getElementById('say') || document.getElementById('say2');
    if (say) say.onclick = () => speak(plain(c.en), say);
    const say3 = document.getElementById('say3');
    if (say3) say3.onclick = () => speak(c.ex, say3);
    if (!session.shown) {
      document.getElementById('reveal').onclick = () => {
        session.shown = true;
        show(true); // карточка остаётся на месте, выезжает только ответ
        if (!understand) speak(plain(c.en), document.getElementById('say2'));
      };
    } else if (session.practice) {
      app.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => leave(() => drill(c, b.dataset.p)); });
    } else {
      app.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => leave(() => grade(c, b.dataset.g)); });
    }
  }

  // карточка уезжает влево, потом въезжает следующая
  function leave(then) {
    const card = app.querySelector('.card');
    app.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    if (!card || reduced) return then();
    card.classList.add('leave');
    setTimeout(then, 180);
  }

  function drill(c, p) {
    session.queue.shift();
    session.shown = false;
    if (p === 'again') { session.queue.push(c); session.again += 1; } else session.done += 1;
    show();
  }

  function grade(c, g) {
    if (!state.cards[c.id]) state[`newCount${W()}`] = (state[`newCount${W()}`] || 0) + 1;
    session.queue.shift();
    session.shown = false;
    if (g === 'again') {
      state.cards[c.id] = { ivl: 0, due: Date.now() + 60000 };
      session.queue.push(c);
      session.again += 1;
    } else {
      const ivl = nextIvl(c, g);
      state.cards[c.id] = { ivl, due: startOfDay() + ivl * DAY };
      session.done += 1;
      markDay();
    }
    save();
    show();
  }

  function burst() {
    if (reduced) return;
    const box = document.createElement('div');
    box.className = 'burst';
    for (let i = 0; i < 26; i++) {
      const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
      const dist = 90 + Math.random() * 110;
      const p = document.createElement('i');
      p.style.cssText = `--c:var(${TOPIC_COLORS[i % TOPIC_COLORS.length]});--x:${Math.cos(a) * dist}px;--y:${Math.sin(a) * dist + 60}px;--rot:${Math.random() * 540 - 270}deg;animation-delay:${Math.random() * 0.08}s`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1500);
  }

  function countUp(el, to) {
    if (reduced) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      el.textContent = Math.round(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function finish() {
    const s = streak();
    app.className = 'screen';
    app.innerHTML = `
      <div class="done">
        <div class="eyebrow">${session.practice ? 'ТРЕНИРОВКА ЗАВЕРШЕНА' : 'СЕССИЯ ЗАВЕРШЕНА'}</div>
        <div class="big"><span>${session.practice ? '' : '+'}</span><span id="n">0</span></div>
        <p>Карточек пройдено: ${session.total}. ${session.again ? `Повторов внутри сессии: ${session.again}.` : 'Без единой ошибки.'}</p>
        ${session.practice ? '' : `<p class="note">Серия: ${days(s)} подряд. Сегодня пройдено: ${state.doneCount}.</p>`}
      </div>
      <div class="spacer"></div>
      <button class="primary" id="home">На главную</button>`;
    countUp(document.getElementById('n'), session.total);
    if (session.total) burst();
    document.getElementById('home').onclick = home;
  }

  // ——— доступ по коду ———
  const KEY_STORE = 'levelup-key';
  const ITER = 600000;
  const AAD = new TextEncoder().encode('levelup-v1');
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  function forgetKey() { try { localStorage.removeItem(KEY_STORE); } catch { /* нет памяти */ } }
  async function deriveKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decrypt(buf, key) {
    const u = new Uint8Array(buf);
    const iv = u.slice(19, 31);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, u.slice(31));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }

  function start(data, words, silent) { // silent — данные открыты при входе, экран рисует форма
    // режим «Слова»: каждое слово — две карточки, «понять» (EN→RU) и «сказать» (RU→EN)
    allWords = [];
    if (words) {
      for (const side of ['understand', 'say']) {
        for (const [w, pos, ipa, level, tr, ex, hint] of words.items) {
          allWords.push({ id: `w:${w}:${side}`, kind: 'word', side, expr: w, en: w, level, ipa, tr, ex, hint, topic: pos });
        }
      }
    }
    // в файле каждое выражение один раз — здесь из него получаются две карточки
    all = [];
    for (const side of ['understand', 'say']) {
      for (const [id, expr, level, en, ru, meaning, tr, ex, hint, code] of data.items) {
        all.push({ id: `${id}:${side}`, side, expr, level, en, ru, meaning, tr, ex, hint, topic: data.topics[code] || '' });
      }
    }
    profiles = loadProfiles();
    state = load();
    Object.values(data.topics).forEach((t, i) => { topicIndex[t] = i; });
    applyLevels();
    if (silent) return;
    const a = curAcc();
    if (a && a.hash) { touch(); home(); } else if (a) authScreen('claim'); else authScreen(profiles.list.length ? 'login' : 'reg');
  }

  async function openAll(buf, wbuf, key) {
    const data = await decrypt(buf, key);
    const words = wbuf ? await decrypt(wbuf, key) : null;
    return [data, words];
  }

  async function boot() {
    app.innerHTML = '<div class="loading" aria-label="Загрузка"><div class="sk" style="width:40%"></div><div class="sk" style="width:70%;height:26px"></div><div class="sk"></div><div class="sk" style="width:85%"></div></div>';
    let buf;
    try { buf = await (await fetch('cards.enc')).arrayBuffer(); } catch {
      app.innerHTML = '<p class="note">Не удалось загрузить карточки. Откройте приложение один раз с интернетом.</p>';
      return;
    }
    let wbuf = null;
    try { const r = await fetch('words.enc'); if (r.ok) wbuf = await r.arrayBuffer(); } catch { /* слов нет — работает только режим «Фразы» */ }
    let saved = null;
    try { saved = localStorage.getItem(KEY_STORE); } catch { /* нет памяти */ }
    if (saved) {
      try {
        const key = await crypto.subtle.importKey('raw', unb64(saved), 'AES-GCM', false, ['decrypt']);
        const [data, words] = await openAll(buf, wbuf, key);
        return start(data, words);
      } catch { forgetKey(); }
    }
    locked = { buf, wbuf };
    profiles = loadProfiles();
    const cur = profiles.list.find((x) => x.id === profiles.current);
    authScreen(cur && !cur.hash ? 'claim' : profiles.list.length ? 'login' : 'reg');
  }
  boot();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); // iOS подгружает голоса не сразу
})();
