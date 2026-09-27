/* דן חריטה: בועת צ'אט עם סוכן AI.
 * התקנה: שורה אחת במקום גלובלי באתר (או בינתיים ב"תוכן שמאל לדף מוצר"):
 *   <script src="https://danharita.github.io/custom-fonts/chat/widget.js" async></script>
 * אפשרויות (מאפיינים על תגית ה-script):
 *   data-api="https://..."   כתובת השרת (ברירת מחדל למטה)
 *   data-side="right"        צד המסך של הבועה (ברירת מחדל: left)
 * מצב בדיקה: כל עוד LIVE=false, הבועה מופיעה רק אחרי פתיחת האתר עם #dhchat בסוף הכתובת
 * (נשמר בדפדפן; #dhchat-off מכבה).
 */
(function () {
  'use strict';
  if (window.DHChat) return;
  var LIVE = false;
  var VERSION = '1.0.0';
  var DEFAULT_API = 'https://dan-harita-api.onrender.com';
  var WHATSAPP = 'https://wa.me/972527772733';
  var TEST_KEY = 'dh-chat-test';
  var HIST_KEY = 'dh-chat-hist';
  var OPEN_KEY = 'dh-chat-open';
  var SID_KEY = 'dh-chat-sid';

  var me = document.currentScript || document.querySelector('script[src*="chat/widget.js"]');
  var API = ((me && me.getAttribute('data-api')) || DEFAULT_API).replace(/\/+$/, '');
  var SIDE = (me && me.getAttribute('data-side')) === 'right' ? 'right' : 'left';

  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function sget(k, kind) { try { var s = store(kind || 'sessionStorage'); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function sset(k, v, kind) { try { var s = store(kind || 'sessionStorage'); if (s) { if (v == null) s.removeItem(k); else s.setItem(k, v); } } catch (e) { /* ignore */ } }

  function enabled() {
    if (LIVE) return true;
    var h = location.hash || '';
    if (/dhchat-off/.test(h)) sset(TEST_KEY, null, 'localStorage');
    else if (/dhchat/.test(h)) sset(TEST_KEY, '1', 'localStorage');
    return sget(TEST_KEY, 'localStorage') === '1' || /dhchat(?!-off)/.test(h);
  }
  if (!enabled()) return;

  // ---------- state ----------
  var history = []; // [{role, content, blocks?}]
  try { history = JSON.parse(sget(HIST_KEY) || '[]') || []; } catch (e) { history = []; }
  var sid = sget(SID_KEY);
  if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); sset(SID_KEY, sid); }
  var busy = false;

  function save() { sset(HIST_KEY, JSON.stringify(history.slice(-30))); }

  function pageInfo() {
    var m = location.search.match(/[?&]prodid=(\d+)/i);
    var prodid = m ? m[1] : null;
    if (!prodid) {
      var f = document.querySelector('#FrmCatalog input[name="PicID"]');
      if (f && document.querySelector('h1.CssCatProductAdjusted_header')) prodid = f.value;
    }
    return { prodid: prodid, title: document.title.slice(0, 150) };
  }

  // ---------- DOM (shadow root keeps the site's CSS out) ----------
  var host = document.createElement('div');
  host.id = 'dh-chat-host';
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;' + SIDE + ':0;width:0;height:0;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var gold = '#8f6f33';
  var css =
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:heebo,Heebo,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}' +
    '.btn{position:fixed;bottom:18px;' + SIDE + ':18px;height:56px;min-width:56px;padding:0 18px 0 16px;border:0;border-radius:28px;' +
    'background:' + gold + ';color:#fff;display:flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22);' +
    'font-size:16px;font-weight:700;direction:rtl;transition:transform .15s}' +
    '.btn:hover{transform:translateY(-2px)}.btn svg{width:26px;height:26px;flex:none}' +
    '.btn.hidden{display:none}' +
    '.panel{position:fixed;bottom:18px;' + SIDE + ':18px;width:380px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 36px);' +
    'background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;direction:rtl;color:#1d1a16}' +
    '.panel.open{display:flex}' +
    '@media (max-width:600px){.panel{inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}' +
    '.panel{height:100dvh}.btn .lbl{display:none}.btn{padding:0;width:56px;justify-content:center}}' +
    '.head{background:' + gold + ';color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px;flex:none}' +
    '.head .t{flex:1;min-width:0}.head b{display:block;font-size:16px}.head small{font-size:12.5px;opacity:.9}' +
    '.ib{background:transparent;border:0;color:#fff;width:36px;height:36px;border-radius:8px;cursor:pointer;display:grid;place-items:center;padding:0}' +
    '.ib:hover{background:rgba(255,255,255,.15)}.ib svg{width:22px;height:22px}' +
    '.log{flex:1;overflow-y:auto;padding:14px 12px;background:#faf8f3;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}' +
    '.msg{max-width:88%;padding:9px 12px;border-radius:14px;font-size:15px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}' +
    '.bot{align-self:flex-start;background:#fff;border:1px solid #ece5d6;border-top-right-radius:4px}' +
    '.user{align-self:flex-end;background:#efe4cc;border-top-left-radius:4px}' +
    '.card{align-self:flex-start;width:88%;display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #e3d7bd;border-radius:12px;padding:8px;' +
    'text-decoration:none;color:inherit}.card:hover{border-color:' + gold + '}' +
    '.card img{width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none;background:#f1ece2}' +
    '.card .n{font-size:14px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.card .p{font-size:14px;color:' + gold + ';font-weight:700;margin-top:3px}.card .p s{color:#8a8378;font-weight:400;margin-inline-start:6px}' +
    '.card .go{font-size:12.5px;color:#6b645a;margin-top:2px}' +
    '.link{align-self:flex-start;color:' + gold + ';font-size:14.5px;font-weight:600;text-decoration:none;border:1px solid #e3d7bd;background:#fff;border-radius:10px;padding:8px 12px}' +
    '.wa{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;background:#25d366;color:#fff;text-decoration:none;font-weight:700;font-size:15px;border-radius:22px;padding:9px 16px}' +
    '.wa svg{width:20px;height:20px}' +
    '.chips{display:flex;flex-wrap:wrap;gap:8px;align-self:stretch}' +
    '.chip{border:1px solid #d9c9a5;background:#fff;color:#5d4a26;border-radius:18px;padding:7px 12px;font-size:14px;cursor:pointer}' +
    '.chip:hover{border-color:' + gold + '}' +
    '.typing{align-self:flex-start;background:#fff;border:1px solid #ece5d6;border-radius:14px;padding:10px 14px;display:flex;gap:4px}' +
    '.typing i{width:7px;height:7px;border-radius:50%;background:#b9a57a;animation:d 1s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes d{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}' +
    '.foot{flex:none;display:flex;gap:8px;padding:10px;border-top:1px solid #ece5d6;background:#fff}' +
    '.foot textarea{flex:1;resize:none;border:1px solid #d9d2c3;border-radius:12px;padding:10px 12px;font-size:16px;line-height:1.35;max-height:110px;outline:none;direction:rtl;color:#1d1a16;background:#fff}' +
    '.foot textarea:focus{border-color:' + gold + '}' +
    '.send{flex:none;width:44px;height:44px;border:0;border-radius:12px;background:' + gold + ';color:#fff;cursor:pointer;display:grid;place-items:center;align-self:flex-end}' +
    '.send:disabled{opacity:.5;cursor:default}.send svg{width:20px;height:20px;transform:scaleX(-1)}' +
    '.note{font-size:11.5px;color:#8a8378;text-align:center;padding:0 10px 8px;background:#fff;flex:none}';

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_NEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>';
  var ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.1-1.2l-.4-.2z"/></svg>';

  root.innerHTML =
    '<style>' + css + '</style>' +
    '<button class="btn" type="button" aria-label="פתיחת צ\'אט">' + ICON_CHAT + '<span class="lbl">שאלות? דברו איתנו</span></button>' +
    '<div class="panel" role="dialog" aria-label="צ\'אט עם דן חריטה">' +
    '<div class="head"><div class="t"><b>דן חריטה</b><small>עוזר דיגיטלי · עונה מיד</small></div>' +
    '<a class="ib" target="_blank" rel="noopener" href="' + WHATSAPP + '" aria-label="ווטסאפ" title="לדבר עם נציג בווטסאפ">' + ICON_WA + '</a>' +
    '<button class="ib new" type="button" aria-label="שיחה חדשה" title="שיחה חדשה">' + ICON_NEW + '</button>' +
    '<button class="ib x" type="button" aria-label="סגירה" title="סגירה">' + ICON_X + '</button></div>' +
    '<div class="log" aria-live="polite"></div>' +
    '<div class="foot"><textarea rows="1" maxlength="500" placeholder="כתבו שאלה..." aria-label="הודעה"></textarea>' +
    '<button class="send" type="button" aria-label="שליחה">' + ICON_SEND + '</button></div>' +
    '<div class="note">עוזר אוטומטי (AI). לשאלות על הזמנה קיימת — ווטסאפ.</div>' +
    '</div>';

  var $ = function (s) { return root.querySelector(s); };
  var btn = $('.btn'), panel = $('.panel'), log = $('.log'), input = $('textarea'), sendBtn = $('.send');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scroll() { log.scrollTop = log.scrollHeight; }
  function safeUrl(u) { return /^(https:\/\/|http:\/\/localhost[:/])/i.test(u || '') ? u : null; }

  function renderBlocks(blocks) {
    blocks.forEach(function (b) {
      if (b.type === 'text') log.appendChild(el('div', 'msg bot', b.text));
      else if (b.type === 'product' && safeUrl(b.url)) {
        var a = el('a', 'card'); a.href = b.url;
        if (safeUrl(b.img)) { var im = el('img'); im.src = b.img; im.alt = ''; im.loading = 'lazy'; a.appendChild(im); }
        var box = el('div'); box.appendChild(el('div', 'n', b.name));
        if (b.price && b.forSale) {
          var p = el('div', 'p', b.price + ' ₪');
          if (b.oldPrice) p.appendChild(el('s', null, b.oldPrice + ' ₪'));
          box.appendChild(p);
        }
        box.appendChild(el('div', 'go', b.forSale ? 'לצפייה ולהזמנה ←' : 'לצפייה בדוגמה ←'));
        a.appendChild(box); log.appendChild(a);
      } else if (b.type === 'page' && safeUrl(b.url)) {
        var l = el('a', 'link', b.title + ' ←'); l.href = b.url; log.appendChild(l);
      } else if (b.type === 'whatsapp' && safeUrl(b.url)) {
        var w = el('a', 'wa'); w.href = b.url; w.target = '_blank'; w.rel = 'noopener';
        w.innerHTML = ICON_WA; w.appendChild(document.createTextNode('שאלו אותנו בווטסאפ'));
        log.appendChild(w);
      }
    });
  }

  var CHIPS = ['המלצה למתנה', 'כמה זמן לוקח משלוח?', 'איך מזמינים חריטה?', 'אפשר איסוף עצמי?'];
  function renderAll() {
    log.innerHTML = '';
    log.appendChild(el('div', 'msg bot', 'היי! אני העוזר הדיגיטלי של דן חריטה.\nאפשר לשאול על המוצרים, משלוחים והזמנות, או לבקש המלצה למתנה.'));
    history.forEach(function (m) {
      if (m.role === 'user') log.appendChild(el('div', 'msg user', m.content));
      else renderBlocks(m.blocks || [{ type: 'text', text: m.content }]);
    });
    if (!history.length) {
      var c = el('div', 'chips');
      CHIPS.forEach(function (t) { var b = el('button', 'chip', t); b.type = 'button'; b.onclick = function () { ask(t); }; c.appendChild(b); });
      log.appendChild(c);
    }
    scroll();
  }

  // What the model sees of its own earlier answers.
  function blocksToText(blocks) {
    return blocks.map(function (b) {
      if (b.type === 'text') return b.text;
      if (b.type === 'product') return '[[P:' + b.id + ']]';
      if (b.type === 'page') return '(קישור: ' + b.title + ')';
      if (b.type === 'whatsapp') return '[[WHATSAPP]]';
      return '';
    }).filter(Boolean).join('\n');
  }

  function setBusy(v) { busy = v; sendBtn.disabled = v; }

  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    var chips = log.querySelector('.chips'); if (chips) chips.remove();
    history.push({ role: 'user', content: text }); save();
    log.appendChild(el('div', 'msg user', text));
    input.value = ''; grow();
    var typing = el('div', 'typing'); typing.innerHTML = '<i></i><i></i><i></i>'; log.appendChild(typing); scroll();
    setBusy(true);

    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 75000);
    fetch(API + '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sid: sid,
        page: pageInfo(),
        messages: history.map(function (m) { return { role: m.role, content: m.content }; }),
      }),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) { return r.json(); }).then(function (j) {
      var blocks = (j && j.blocks) || [];
      if (!blocks.length) throw new Error('empty');
      history.push({ role: 'assistant', content: blocksToText(blocks), blocks: blocks }); save();
      typing.remove(); renderBlocks(blocks); scroll();
    }).catch(function () {
      typing.remove();
      history.pop(); save(); // let the customer retry the same question
      renderBlocks([
        { type: 'text', text: 'לא הצלחתי להתחבר כרגע. אפשר לנסות שוב, או לשאול אותנו ישירות:' },
        { type: 'whatsapp', url: WHATSAPP + '?text=' + encodeURIComponent('היי, רציתי לשאול: ' + text) },
      ]);
      scroll();
    }).then(function () { clearTimeout(timer); setBusy(false); });
  }

  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; }

  var woke = false;
  function open() {
    panel.classList.add('open'); btn.classList.add('hidden'); sset(OPEN_KEY, '1');
    renderAll();
    if (window.matchMedia && !window.matchMedia('(max-width:600px)').matches) input.focus();
    if (!woke) { woke = true; try { fetch(API + '/health', { mode: 'cors' }).catch(function () {}); } catch (e) { /* ignore */ } }
  }
  function close() { panel.classList.remove('open'); btn.classList.remove('hidden'); sset(OPEN_KEY, null); }

  btn.addEventListener('click', open);
  $('.x').addEventListener('click', close);
  $('.new').addEventListener('click', function () { if (busy) return; history = []; save(); renderAll(); });
  sendBtn.addEventListener('click', function () { ask(input.value); });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
  });
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  function mount() {
    document.body.appendChild(host);
    // Keep the conversation open when the customer clicks a product link (desktop only).
    if (sget(OPEN_KEY) === '1' && window.matchMedia && !window.matchMedia('(max-width:600px)').matches) open();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  window.DHChat = { version: VERSION, open: open, close: close, api: API };
})();
