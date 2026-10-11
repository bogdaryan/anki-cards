// Level Up: карточки. Простое интервальное повторение без сервера: прогресс — в localStorage
// телефона. Ответы: «Не помню» — карточка вернётся в этой же сессии; «Помню» — интервал
// растёт в 2,5 раза (первый — 1 день); «Легко» — в 4 раза (первый — 3 дня).
(() => {
  const KEY = 'levelup-cards-v1';
  const NEW_PER_DAY = 10;
  const DAY = 86400000;
  const app = document.getElementById('app');

  let cards = [];
  let state = load();
  let session = null;
  let confirmReset = false;

  // ——— хранение ———
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { cards: {}, newDay: '', newCount: 0 }; }
    catch { return { cards: {}, newDay: '', newCount: 0 }; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* без памяти — работаем в пределах сессии */ } }
  const today = () => new Date().toLocaleDateString('sv');
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function newLeft() {
    if (state.newDay !== today()) { state.newDay = today(); state.newCount = 0; }
    return Math.max(0, NEW_PER_DAY - state.newCount);
  }
  const due = () => cards.filter((c) => state.cards[c.id] && state.cards[c.id].due <= Date.now());
  const fresh = () => cards.filter((c) => !state.cards[c.id]);
  const learned = () => cards.filter((c) => state.cards[c.id] && state.cards[c.id].ivl >= 1).length;

  // ——— разметка ———
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
  const when = (t) => {
    const d = Math.round((new Date(t).setHours(0, 0, 0, 0) - startOfDay()) / DAY);
    if (d <= 0) return 'сегодня, чуть позже';
    if (d === 1) return 'завтра';
    return new Date(t).toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const days = (n) => (n === 1 ? '1 день' : n < 5 ? `${n} дня` : `${n} дн.`);
  const speakIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

  function home() {
    session = null;
    const d = due().length;
    const n = Math.min(newLeft(), fresh().length);
    const total = cards.length;
    const l = learned();
    const seen = Object.keys(state.cards).length;
    const pct = (x) => (total ? (x / total) * 100 : 0);
    const nothing = d + n === 0;
    const next = Object.values(state.cards).map((s) => s.due).filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
    app.innerHTML = `
      <header>
        <div class="eyebrow">LEVEL UP · АНГЛИЙСКИЙ</div>
        <h1 class="title">Карточки</h1>
        <div class="deck">B1–B2, набор 1 · ${total / 2} выражений, ${total} карточек</div>
      </header>
      <section class="stats" aria-label="Сегодня">
        <div class="stat" style="--c: var(--coral)"><b>${d}</b><span>повторить</span></div>
        <div class="stat" style="--c: var(--violet)"><b>${n}</b><span>новых сегодня</span></div>
        <div class="stat" style="--c: var(--mint)"><b>${l}</b><span>в памяти</span></div>
      </section>
      <section>
        <div class="xp" aria-hidden="true"><i style="width:${pct(l)}%; background: var(--mint)"></i><i style="width:${pct(seen - l)}%; background: var(--sun)"></i></div>
        <div class="xp-label"><span>Полоса опыта</span><span>${l} из ${total}</span></div>
      </section>
      <button class="primary" id="start" ${nothing ? 'disabled' : ''}>${nothing ? 'На сегодня всё' : 'Начать'}</button>
      ${nothing ? `<p class="note">${next ? `Следующее повторение — ${when(next)}.` : 'Все карточки пройдены.'}</p>` : ''}
      <div class="spacer"></div>
      <p class="note">Сначала идут карточки «Понять», потом «Сказать». Отвечайте вслух — в этом весь смысл. Прогресс хранится на этом телефоне.</p>
      ${confirmReset ? `
        <div class="confirm"><span>Сбросить весь прогресс? Это не отменить.</span>
          <div class="row"><button id="no">Оставить</button><button class="danger" id="yes">Сбросить</button></div></div>`
        : '<button class="link" id="reset">Сбросить прогресс</button>'}
    `;
    const start = document.getElementById('start');
    if (!nothing) start.onclick = begin;
    const r = document.getElementById('reset');
    if (r) r.onclick = () => { confirmReset = true; home(); };
    const y = document.getElementById('yes');
    if (y) {
      y.onclick = () => { state = { cards: {}, newDay: '', newCount: 0 }; save(); confirmReset = false; home(); };
      document.getElementById('no').onclick = () => { confirmReset = false; home(); };
    }
  }

  function begin() {
    const queue = [...due(), ...fresh().slice(0, newLeft())];
    session = { queue, done: 0, total: queue.length, again: 0, shown: false };
    show();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.92;
    const v = speechSynthesis.getVoices().find((x) => x.lang === 'en-US') || speechSynthesis.getVoices().find((x) => x.lang.startsWith('en'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  function nextIvl(c, grade) {
    const s = state.cards[c.id];
    const ivl = s ? s.ivl : 0;
    if (grade === 'good') return ivl ? Math.round(ivl * 2.5) : 1;
    return ivl ? Math.round(ivl * 4) : 3;
  }

  function show() {
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
    app.innerHTML = `
      <div class="bar">
        <button class="close" id="close" aria-label="Закончить"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <div class="count">${session.done}/${session.total}</div>
      </div>
      <article class="card ${c.level}">
        <div class="chips"><span class="chip">${c.level}</span><span class="chip side">${understand ? 'ПОНЯТЬ' : 'СКАЗАТЬ'}</span></div>
        ${front}
        ${session.shown ? back : ''}
      </article>
      <div class="spacer"></div>
      ${session.shown ? `
        <div class="grades">
          <button class="grade g-again" data-g="again"><b>Не помню</b><span>сейчас ещё раз</span></button>
          <button class="grade g-good" data-g="good"><b>Помню</b><span>через ${days(nextIvl(c, 'good'))}</span></button>
          <button class="grade g-easy" data-g="easy"><b>Легко</b><span>через ${days(nextIvl(c, 'easy'))}</span></button>
        </div>` : '<button class="primary" id="reveal">Показать ответ</button>'}
    `;
    document.getElementById('close').onclick = home;
    const say = document.getElementById('say') || document.getElementById('say2');
    if (say) say.onclick = () => speak(plain(c.en));
    if (!session.shown) document.getElementById('reveal').onclick = () => { session.shown = true; show(); if (!understand) speak(plain(c.en)); };
    else app.querySelectorAll('.grade').forEach((b) => { b.onclick = () => grade(c, b.dataset.g); });
  }

  function grade(c, g) {
    const isNew = !state.cards[c.id];
    if (isNew) state.newCount += 1;
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
    }
    save();
    show();
  }

  function finish() {
    app.innerHTML = `
      <div class="done">
        <div class="eyebrow">СЕССИЯ ЗАВЕРШЕНА</div>
        <div class="big">+${session.total}</div>
        <p>Карточек пройдено: ${session.total}. ${session.again ? `Повторов внутри сессии: ${session.again}.` : 'Без единой ошибки.'}</p>
      </div>
      <div class="spacer"></div>
      <button class="primary" id="home">На главную</button>`;
    document.getElementById('home').onclick = home;
  }

  fetch('cards.json').then((r) => r.json()).then((data) => { cards = data; home(); })
    .catch(() => { app.innerHTML = '<p class="note">Не удалось загрузить карточки. Откройте приложение один раз с интернетом.</p>'; });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); // iOS подгружает голоса не сразу
})();
