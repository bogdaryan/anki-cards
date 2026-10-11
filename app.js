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
// Профили: у каждого свой прогресс (свой ключ в localStorage). Прогресс живёт только на этом
// устройстве: на другом телефоне — свой, никуда не уходит.
(() => {
  const OLD_KEY = 'levelup-cards-v1';
  const PROFILES_KEY = 'levelup-profiles';
  const LIMITS = [10, 20, 30, 0]; // 0 — без лимита
  const PORTION = 20;
  const LEVELS = { b: ['B1', 'B2'], c: ['C1', 'C2'] };
  const DAY = 86400000;
  const TOPIC_COLORS = ['--violet', '--coral', '--mint', '--sun', '--sky', '--pink'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const app = document.getElementById('app');

  let all = [];
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
  function blank() { return { cards: {}, newDay: '', newCount: 0, limit: 10, bonus: 0, days: [], doneDay: '', doneCount: 0, levels: { b: true, c: false } }; }
  // ——— профили ———
  function loadProfiles() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROFILES_KEY)); } catch { /* нет памяти */ }
    if (p && p.list && p.list.length) return p;
    // первый запуск после обновления: старый прогресс становится первым профилем
    let old = null;
    try { old = localStorage.getItem(OLD_KEY); } catch { /* нет памяти */ }
    if (old) {
      p = { list: [{ id: 'p1', name: 'Профиль 1' }], current: 'p1' };
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
  function addProfile(name) {
    const id = `p${Date.now().toString(36)}`;
    profiles.list.push({ id, name: name.trim().slice(0, 24) || `Профиль ${profiles.list.length + 1}` });
    profiles.current = id;
    saveProfiles();
    state = load();
    applyLevels();
  }
  function switchProfile(id) { profiles.current = id; saveProfiles(); state = load(); applyLevels(); }
  function removeProfile(id) {
    try { localStorage.removeItem(`${OLD_KEY}:${id}`); } catch { /* нет памяти */ }
    profiles.list = profiles.list.filter((x) => x.id !== id);
    if (profiles.current === id) profiles.current = profiles.list.length ? profiles.list[0].id : null;
    saveProfiles();
    state = load();
    applyLevels();
  }

  // ——— уровни ———
  const levelsOn = () => Object.assign({ b: true, c: false }, state.levels || {});
  function applyLevels() {
    const on = levelsOn();
    const allowed = [...(on.b ? LEVELS.b : []), ...(on.c ? LEVELS.c : [])];
    cards = all.filter((c) => allowed.includes(c.level));
  }
  const today = () => new Date().toLocaleDateString('sv');
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function rollDay() {
    if (state.newDay !== today()) { state.newDay = today(); state.newCount = 0; state.bonus = 0; }
    if (state.doneDay !== today()) { state.doneDay = today(); state.doneCount = 0; }
  }
  const unlimited = () => state.limit === 0;
  function newLeft() {
    rollDay();
    if (unlimited()) return Infinity;
    return Math.max(0, (state.limit || 10) + (state.bonus || 0) - state.newCount);
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
    const seen = Object.keys(state.cards).length;
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
          <h1 class="title">Карточки</h1>
          <div class="deck">${[on.b ? 'B1–B2' : '', on.c ? 'C1–C2' : ''].filter(Boolean).join(' + ')} · ${fmt(total / 2)} ${plural(total / 2, 'выражение', 'выражения', 'выражений')}, ${fmt(total)} ${plural(total, 'карточка', 'карточки', 'карточек')}</div>
        </div>
        ${ring(state.doneCount, state.doneCount + d + n)}
      </header>
      <div class="chips-row">
        <span class="pill${s ? ' hot' : ''}">${flame}<span>серия</span><b>${days(s)}</b></span>
        <span class="pill"><span>знакомых</span><b>${fmt(seen)}</b></span>
        <button class="pill who" id="who" aria-label="Профиль: ${esc(profileName())}">${person}<b>${esc(profileName())}</b></button>
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
      <p class="note">Каждое выражение — две карточки: сначала «Понять», а когда оно выучено — «Сказать». Отвечайте вслух. Прогресс хранится на этом телефоне.</p>
      ${confirmReset ? `
        <div class="confirm"><span>Сбросить весь прогресс? Это не отменить.</span>
          <div class="row"><button id="no">Оставить</button><button class="danger" id="yes">Сбросить</button></div></div>`
        : '<button class="link" id="reset">Сбросить прогресс</button>'}
    `;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = app.querySelector('.ring .fill');
      if (f) f.style.strokeDashoffset = f.dataset.to;
    }));
    app.querySelectorAll('[data-limit]').forEach((b) => { b.onclick = () => { state.limit = +b.dataset.limit; save(); home(); }; });
    app.querySelectorAll('[data-level]').forEach((b) => {
      b.onclick = () => {
        const lv = levelsOn();
        lv[b.dataset.level] = !lv[b.dataset.level];
        if (!lv.b && !lv.c) return; // хотя бы один уровень включён
        state.levels = lv; save(); applyLevels(); home();
      };
    });
    document.getElementById('who').onclick = people;
    if (!nothing) document.getElementById('start').onclick = begin;
    const bonus = document.getElementById('bonus');
    if (bonus) bonus.onclick = () => { newLeft(); state.bonus = (state.bonus || 0) + 10; save(); begin(); };
    const pr = document.getElementById('practice');
    if (pr) pr.onclick = practice;
    const r = document.getElementById('reset');
    if (r) r.onclick = () => { confirmReset = true; home(); };
    const y = document.getElementById('yes');
    if (y) {
      y.onclick = () => { state = Object.assign(blank(), { limit: state.limit ?? 10, levels: levelsOn() }); save(); confirmReset = false; home(); };
      document.getElementById('no').onclick = () => { confirmReset = false; home(); };
    }
  }

  // ——— профили: первый запуск и переключение ———
  function welcome() {
    app.className = 'screen';
    app.innerHTML = `
      <div class="head"><div class="head-text">
        <div class="eyebrow">LEVEL UP · АНГЛИЙСКИЙ</div>
        <h1 class="title">Карточки</h1>
        <div class="deck">${fmtN(all.length / 2)} ${plural(all.length / 2, 'выражение', 'выражения', 'выражений')}: B1–B2 и C1–C2</div></div></div>
      <form class="profile-form" id="pf">
        <label for="pname">Как вас зовут?</label>
        <input id="pname" name="pname" maxlength="24" autocomplete="nickname" placeholder="Имя или ник" enterkeyhint="go">
        <button class="primary" type="submit">Начать</button>
      </form>
      <p class="note">Прогресс хранится только на этом устройстве. У каждого телефона и у каждого профиля — свой. Сменить профиль или добавить ещё один можно на главной.</p>`;
    document.getElementById('pf').onsubmit = (e) => { e.preventDefault(); addProfile(document.getElementById('pname').value); home(); };
  }

  let confirmDel = null;
  function people() {
    app.className = 'screen';
    app.innerHTML = `
      <div class="bar"><button class="close" id="back" aria-label="Назад"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button><div class="eyebrow">ПРОФИЛИ</div></div>
      <div class="plist">
        ${profiles.list.map((x) => {
          let st = {};
          try { st = JSON.parse(localStorage.getItem(`${OLD_KEY}:${x.id}`)) || {}; } catch { /* нет памяти */ }
          const known = Object.keys(st.cards || {}).length;
          const cur = x.id === profiles.current;
          return `<div class="prow${cur ? ' cur' : ''}">
            <button class="pick" data-id="${x.id}">${person}<span><b>${esc(x.name)}</b><small>${cur ? 'сейчас · ' : ''}знакомых ${fmtN(known)}</small></span></button>
            ${confirmDel === x.id
              ? `<button class="del sure" data-del="${x.id}">Удалить</button>`
              : `<button class="del" data-ask="${x.id}" aria-label="Удалить ${esc(x.name)}">×</button>`}
          </div>`;
        }).join('')}
      </div>
      ${confirmDel ? '<p class="note">Нажмите «Удалить» ещё раз: прогресс этого профиля сотрётся.</p>' : ''}
      <form class="profile-form" id="pf">
        <label for="pname">Новый профиль</label>
        <input id="pname" name="pname" maxlength="24" autocomplete="off" placeholder="Имя или ник" enterkeyhint="done">
        <button class="secondary-btn" type="submit">Добавить и перейти</button>
      </form>
      <div class="spacer"></div>
      <button class="link" id="lock">Заблокировать приложение на этом устройстве</button>
      <p class="note">Прогресс хранится только на этом устройстве и никуда не отправляется. На другом телефоне у человека будет свой.</p>`;
    document.getElementById('lock').onclick = () => { forgetKey(); location.reload(); };
    document.getElementById('back').onclick = () => { confirmDel = null; home(); };
    app.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { confirmDel = null; switchProfile(b.dataset.id); home(); }; });
    app.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { confirmDel = b.dataset.ask; people(); }; });
    app.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => { removeProfile(b.dataset.del); confirmDel = null; if (profiles.current) people(); else welcome(); };
    });
    document.getElementById('pf').onsubmit = (e) => { e.preventDefault(); confirmDel = null; addProfile(document.getElementById('pname').value); home(); };
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
    const front = understand
      ? `<div class="sentence">${c.en}</div>
         <div class="hint">Что значит выделенное? Сначала скажите вслух.</div>
         <button class="speak" id="say">${speakIcon}Послушать</button>`
      : `<div class="sentence">${esc(c.ru)}</div>
         <div class="hint">Скажите по-английски вслух. Подсказка: <b>${esc(c.hint)}</b></div>`;
    const back = understand
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
    if (!state.cards[c.id]) state.newCount += 1;
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

  function start(data) {
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
    if (profiles.current) home(); else welcome();
  }

  function pinScreen(buf) {
    let code = '';
    let busy = false;
    const pad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    const lockUntil = () => { try { return +localStorage.getItem('levelup-wait') || 0; } catch { return 0; } };
    const fails = () => { try { return +localStorage.getItem('levelup-fails') || 0; } catch { return 0; } };
    const setFails = (n) => { try { localStorage.setItem('levelup-fails', n); if (n >= 5) localStorage.setItem('levelup-wait', Date.now() + 30000); } catch { /* нет памяти */ } };
    // экран рисуется один раз; дальше меняются только точки, подпись и доступность клавиш
    app.className = 'screen pin-screen';
    app.innerHTML = `
      <div class="pin-head">
        <img class="pin-icon" src="icons/icon-192.png" alt="">
        <div class="eyebrow">LEVEL UP · АНГЛИЙСКИЙ</div>
        <h1 class="title">Введите код</h1>
      </div>
      <div class="dots">${[0, 1, 2, 3].map(() => '<i></i>').join('')}</div>
      <p class="note pin-msg" role="status"></p>
      <div class="keypad">${pad.map((k) => (k ? `<button class="key" data-k="${k}" aria-label="${k === '⌫' ? 'Стереть' : k}">${k}</button>` : '<span></span>')).join('')}</div>`;
    const dots = app.querySelector('.dots');
    const msgEl = app.querySelector('.pin-msg');
    app.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => press(b.dataset.k); });
    function draw(msg, cls) {
      const wait = Math.ceil((lockUntil() - Date.now()) / 1000);
      dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < code.length));
      dots.setAttribute('aria-label', `Введено ${code.length} из 4`);
      if (cls) { dots.classList.remove(cls); void dots.offsetWidth; dots.classList.add(cls); }
      msgEl.textContent = wait > 0 ? `Слишком много попыток. Подождите ${wait} с.` : msg || 'Код спросят один раз на этом устройстве.';
      app.querySelectorAll('[data-k]').forEach((b) => { b.disabled = wait > 0 || busy; });
      if (wait > 0) setTimeout(() => draw(), 1000);
    }
    async function press(k) {
      if (busy) return;
      dots.classList.remove('shake');
      if (k === '⌫') { code = code.slice(0, -1); return draw(); }
      if (code.length >= 4) return;
      code += k;
      if (code.length < 4) return draw();
      busy = true; draw('Проверяю…');
      try {
        const key = await deriveKey(code, new Uint8Array(buf).slice(3, 19));
        const data = await decrypt(buf, key);
        try { localStorage.setItem(KEY_STORE, b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))); localStorage.removeItem('levelup-fails'); } catch { /* нет памяти */ }
        app.querySelector('.dots').classList.add('ok');
        setTimeout(() => start(data), reduced ? 0 : 380);
      } catch {
        busy = false; code = ''; setFails(fails() + 1);
        draw('Неверный код', 'shake');
        if (navigator.vibrate) navigator.vibrate(120);
      }
    }
    draw();
  }

  async function boot() {
    app.innerHTML = '<div class="loading" aria-label="Загрузка"><div class="sk" style="width:40%"></div><div class="sk" style="width:70%;height:26px"></div><div class="sk"></div><div class="sk" style="width:85%"></div></div>';
    let buf;
    try { buf = await (await fetch('cards.enc')).arrayBuffer(); } catch {
      app.innerHTML = '<p class="note">Не удалось загрузить карточки. Откройте приложение один раз с интернетом.</p>';
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(KEY_STORE); } catch { /* нет памяти */ }
    if (saved) {
      try {
        const key = await crypto.subtle.importKey('raw', unb64(saved), 'AES-GCM', false, ['decrypt']);
        return start(await decrypt(buf, key));
      } catch { forgetKey(); }
    }
    pinScreen(buf);
  }
  boot();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); // iOS подгружает голоса не сразу
})();
