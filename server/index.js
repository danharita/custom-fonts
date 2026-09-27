// שרת הסוכן של דן חריטה.
// POST /chat  — מקבל את השיחה מהבועה באתר, שולח ל-Claude, ומחזיר תשובה מפורקת לבלוקים
//               (טקסט / כרטיס מוצר / קישור לדף / כפתור ווטסאפ). קישורים נבנים רק מהקטלוג,
//               כך שהסוכן לא יכול להמציא כתובת.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const catalog = require('./catalog');

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.MODEL || 'claude-haiku-4-5-20251001';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const WHATSAPP = (process.env.WHATSAPP_NUMBER || '972527772733').replace(/\D/g, '');
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://www.harita.co.il,https://harita.co.il')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 1500);     // הודעות ביום לכל האתר (הגנה על העלות)
const IP_LIMIT = Number(process.env.IP_LIMIT || 25);             // הודעות לכל גולש ב-10 דקות
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 24);
const MOCK = process.env.MOCK_MODEL === '1';                     // לבדיקות בלבד

const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const LOG_FILE = path.join(DATA_DIR, 'chats.jsonl');
const SEED_FILE = path.join(__dirname, 'catalog-seed.json');

// ---------- knowledge + catalog ----------
function readKnowledge() {
  try {
    return fs.readFileSync(path.join(__dirname, 'knowledge.md'), 'utf8')
      .split('\n').filter((l) => !/^#\s/.test(l) || /^#{2,}\s/.test(l)).join('\n').trim();
  } catch (e) { return ''; }
}
let KNOWLEDGE = readKnowledge();
let CAT = catalog.load(CATALOG_FILE) || catalog.load(SEED_FILE) || { builtAt: null, products: [], pages: [] };
let CAT_TEXT = catalog.toPromptText(CAT);
let PRODUCTS = new Map(CAT.products.map((p) => [p.id, p]));
let crawling = false;

function setCatalog(cat) {
  CAT = cat;
  CAT_TEXT = catalog.toPromptText(cat);
  PRODUCTS = new Map(cat.products.map((p) => [p.id, p]));
}

async function refreshCatalog(force) {
  if (crawling) return false;
  const age = CAT.builtAt ? (Date.now() - Date.parse(CAT.builtAt)) / 36e5 : Infinity;
  if (!force && age < REFRESH_HOURS - 1) return false;
  crawling = true;
  try {
    const cat = await catalog.crawl();
    if (cat.products.length >= Math.max(Number(process.env.MIN_PRODUCTS || 5), CAT.products.length * 0.5)) {
      setCatalog(cat);
      catalog.save(CATALOG_FILE, cat);
    } else {
      console.log('[catalog] crawl looked broken (' + cat.products.length + ' products), keeping the old one');
    }
    return true;
  } catch (e) {
    console.log('[catalog] crawl failed:', e.message);
    return false;
  } finally { crawling = false; }
}

// ---------- prompt ----------
function systemPrompt() {
  return [
    `את/ה הנציג/ה הדיגיטלי/ת באתר של "דן חריטה אומנותית" (harita.co.il) — חנות לחריטת לייזר אישית על מתנות.
תפקידך: לענות ללקוחות באתר על שאלות כלליות ועל המוצרים, ולעזור להם למצוא את המוצר המתאים.

כללים:
1. עונים רק לפי "ידע על העסק" ו"קטלוג" למטה. אסור להמציא מחירים, זמנים, מוצרים, מידות, מבצעים או מדיניות. אם המידע לא כתוב — לא יודעים.
2. כשלא יודעים, כשצריך הצעת מחיר (הזמנות עסקיות/כמויות, אירועים, חריטה על פריט של הלקוח), סטטוס הזמנה, שינוי או ביטול הזמנה, תלונה, או כשהלקוח מבקש לדבר עם אדם — כותבים משפט קצר ומוסיפים בשורה נפרדת את הסימון [[WHATSAPP]]. לא מנחשים.
3. כשממליצים על מוצר או מזכירים מוצר — חובה לצרף את הסימון שלו בדיוק כמו בקטלוג, בשורה נפרדת: [[P:מספר]]. לדף קטגוריה או מידע: [[L:מספר]]. אסור לכתוב כתובות אינטרנט בעצמך — המערכת הופכת את הסימונים לקישורים מדויקים.
4. בהמלצה: עד 3 מוצרים מתאימים, עם משפט קצר למה כל אחד מתאים. אם הבקשה כללית מדי, שואלים שאלה אחת ממקדת (למי המתנה? תקציב?).
5. עברית פשוטה, חמה ועניינית. תשובות קצרות: 1–4 משפטים לפני הסימונים. בלי כותרות ובלי טבלאות. לפנות בלשון רבים או ניטרלית.
6. מחירים: כפי שמופיעים בקטלוג (כולל מע"מ). אם יש מחיר מבצע — לציין את מחיר המבצע.
7. נושאים שלא קשורים לחנות — מסבירים בנימוס שאפשר לעזור רק בנושאי החנות.
8. אין לך גישה להזמנות, למלאי בזמן אמת או לפרטי לקוחות. אל תבקש פרטים אישיים (טלפון, כתובת, אשראי).
9. אם הלקוח כותב באנגלית או ברוסית — עונים באותה שפה.`,
    '# ידע על העסק\n' + KNOWLEDGE,
    '# קטלוג (מתעדכן אוטומטית מהאתר' + (CAT.builtAt ? ', עודכן ' + CAT.builtAt.slice(0, 10) : '') + ')\n' + CAT_TEXT,
  ].join('\n\n');
}

// ---------- Claude ----------
async function askClaude(messages, pageCtx) {
  const ctx = pageCtx ? `\n\n(הקשר: הלקוח נמצא כרגע בדף: ${pageCtx})` : '';
  const msgs = messages.map((m, i) => ({
    role: m.role,
    content: i === messages.length - 1 && m.role === 'user' ? m.content + ctx : m.content,
  }));
  if (MOCK) return mockAnswer(msgs[msgs.length - 1].content);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      temperature: 0.3,
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages: msgs,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('anthropic ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function mockAnswer(q) {
  const first = CAT.products.find((p) => p.price) || {};
  if (/סטטוס|הזמנה שלי|איפה ההזמנה/.test(q)) return 'אין לי גישה להזמנות, אבל בווטסאפ יבדקו לך מיד.\n[[WHATSAPP]]';
  return `ממליץ על זה:\n[[P:${first.id}]]\nהנה גם כל הקטגוריה:\n[[L:1]]\nוקישור שהומצא https://evil.example.com/x וגם [[P:999999]]`;
}

// ---------- turn model text into safe blocks ----------
function waLink(q) {
  const text = 'היי, הגעתי מהצ\'אט באתר' + (q ? '. רציתי לשאול: ' + q.slice(0, 300) : '');
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
}

function toBlocks(text, lastQuestion) {
  const blocks = [];
  let wa = false;
  const seen = new Set();
  const pushText = (t) => {
    t = t
      .replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '$1') // markdown links → text
      .replace(/https?:\/\/\S+/g, '')                       // bare urls (never trusted)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (t) blocks.push({ type: 'text', text: t });
  };
  const re = /\[\[\s*(P|L)\s*:\s*(\d+)\s*\]\]|\[\[\s*WHATSAPP\s*\]\]/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    last = re.lastIndex;
    if (!m[1]) { wa = true; continue; }
    const kind = m[1].toUpperCase(), id = m[2];
    if (seen.has(kind + id)) continue;
    seen.add(kind + id);
    if (kind === 'P') {
      const p = PRODUCTS.get(id);
      if (p) blocks.push({ type: 'product', id, name: p.name, price: p.price, oldPrice: p.oldPrice, url: p.url, img: p.img, forSale: !!(p.price && p.canBuy) });
    } else {
      const pg = CAT.pages[Number(id) - 1];
      if (pg) blocks.push({ type: 'page', title: pg.title, url: pg.url });
    }
  }
  pushText(text.slice(last));
  if (wa) blocks.push({ type: 'whatsapp', url: waLink(lastQuestion) });
  if (!blocks.length) blocks.push({ type: 'text', text: 'סליחה, לא הצלחתי לענות. אפשר לשאול אותנו ישירות בווטסאפ.' }, { type: 'whatsapp', url: waLink(lastQuestion) });
  return blocks;
}

// ---------- limits + logging ----------
const ipHits = new Map();
let day = new Date().toISOString().slice(0, 10), dayCount = 0;
function allow(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; ipHits.clear(); }
  if (dayCount >= DAILY_LIMIT) return 'day';
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (hits.length >= IP_LIMIT) return 'ip';
  hits.push(now); ipHits.set(ip, hits); dayCount++;
  return null;
}
function logChat(rec) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n');
  } catch (e) { /* ignore */ }
}

// ---------- http ----------
function send(res, code, obj, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}
function readBody(req, max = 40000) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > max) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); } });
  });
}
function isAdmin(u) {
  const k = u.searchParams.get('key') || '';
  return ADMIN_KEY && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  const okOrigin = origin && ORIGINS.includes(origin) ? origin : null;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': okOrigin || 'null',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    });
    return res.end();
  }

  if (u.pathname === '/' || u.pathname === '/health') {
    return send(res, 200, { ok: true, products: CAT.products.length, pages: CAT.pages.length, catalogBuiltAt: CAT.builtAt, crawling, model: MODEL, hasKey: !!API_KEY || MOCK });
  }

  if (u.pathname === '/chat' && req.method === 'POST') {
    if (!okOrigin) return send(res, 403, { error: 'origin' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'bad body' }, okOrigin); }
    let msgs = Array.isArray(body.messages) ? body.messages : [];
    msgs = msgs
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? 600 : 1500) }))
      .slice(-12);
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, 400, { error: 'no question' }, okOrigin);
    const q = msgs[msgs.length - 1].content;

    const block = allow(ip);
    if (block) {
      return send(res, 200, { blocks: [
        { type: 'text', text: 'יש כרגע עומס על הצ\'אט. אפשר לשאול אותנו ישירות בווטסאפ ונענה בשמחה.' },
        { type: 'whatsapp', url: waLink(q) }] }, okOrigin);
    }
    const page = body.page && typeof body.page === 'object' ? body.page : {};
    let pageCtx = '';
    if (page.prodid && PRODUCTS.has(String(page.prodid))) {
      const p = PRODUCTS.get(String(page.prodid));
      pageCtx = `דף המוצר P:${p.id} (${p.name})`;
    } else if (typeof page.title === 'string') pageCtx = page.title.slice(0, 120);

    try {
      const t0 = Date.now();
      const answer = await askClaude(msgs, pageCtx);
      const blocks = toBlocks(answer, q);
      logChat({ t: new Date().toISOString(), sid: String(body.sid || '').slice(0, 40), page: pageCtx, q, a: answer, ms: Date.now() - t0 });
      return send(res, 200, { blocks }, okOrigin);
    } catch (e) {
      console.log('[chat] error', e.message);
      return send(res, 200, { blocks: [
        { type: 'text', text: 'אופס, משהו השתבש אצלנו. אפשר לשאול ישירות בווטסאפ:' },
        { type: 'whatsapp', url: waLink(q) }] }, okOrigin);
    }
  }

  // ---- admin (needs ADMIN_KEY) ----
  if (u.pathname.startsWith('/admin/')) {
    if (!isAdmin(u)) return send(res, 403, { error: 'key' });
    if (u.pathname === '/admin/catalog') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(`עודכן: ${CAT.builtAt}\n\n` + CAT_TEXT);
    }
    if (u.pathname === '/admin/refresh') {
      refreshCatalog(true).then(() => {});
      return send(res, 200, { started: true });
    }
    if (u.pathname === '/admin/chats') {
      let lines = [];
      try { lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-Number(u.searchParams.get('n') || 200)); } catch (e) { /* none */ }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const rows = lines.reverse().map((l) => { try { const r = JSON.parse(l); return `<tr><td>${esc(r.t.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.page || '')}</td><td>${esc(r.q)}</td><td>${esc(r.a).replace(/\n/g, '<br>')}</td></tr>`; } catch (e) { return ''; } }).join('');
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>שיחות הצ'אט</title><style>body{font-family:system-ui;direction:rtl;margin:16px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:8px;vertical-align:top;font-size:14px}td:nth-child(3){font-weight:600}</style><h2>שיחות אחרונות</h2><table>${rows}</table>`);
    }
    if (u.pathname === '/admin/reload-knowledge') { KNOWLEDGE = readKnowledge(); return send(res, 200, { ok: true }); }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}, model ${MODEL}, ${CAT.products.length} products cached${MOCK ? ' (MOCK)' : ''}`);
  if (!API_KEY && !MOCK) console.log('[server] WARNING: ANTHROPIC_API_KEY is not set');
  if (process.env.NO_CRAWL !== '1') {
    setTimeout(() => refreshCatalog(false), 3000);
    setInterval(() => refreshCatalog(false), 60 * 60e3);
  }
});

module.exports = { toBlocks, systemPrompt };
