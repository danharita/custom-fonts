// קטלוג המוצרים: נבנה אוטומטית מה-sitemap של האתר ומדפי המוצרים עצמם.
// כך הסוכן תמיד מכיר את השמות, המחירים והקישורים המדויקים, בלי הזנה ידנית.
'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SITE = process.env.SITE_URL || 'https://www.harita.co.il';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 DanHaritaChat/1.0';
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 4);
const DESC_MAX = 240;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const num = (s) => {
  const m = String(s || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'he' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return null;
}

function prodIdFromUrl(u) {
  const m = String(u).match(/[?&]prodid=(\d+)/i);
  return m ? m[1] : null;
}

// Parses one page of the 2all site. Returns a product, a plain page, or null.
function parsePage(html, url) {
  const $ = cheerio.load(html);
  const og = (p) => $(`meta[property="${p}"]`).attr('content');
  const canonical = og('og:url') || $('link[rel=canonical]').attr('href') || url;
  const h1 = clean($('h1.CssCatProductAdjusted_header').first().text());

  if (!h1) {
    const title = clean($('title').first().text()).replace(/^דן חריטה אומנותית[,\s|-]*/, '');
    const heading = clean($('h1').first().text());
    return { type: 'page', url: canonical, title: heading || title };
  }

  // Product page
  const main = $('#FrmCatalog').first();
  const id = prodIdFromUrl(canonical) || prodIdFromUrl(url) || clean(main.find('input[name=PicID]').attr('value'));
  let price = num($('[itemprop=price]').first().attr('content'));
  const special = num($('.CssCatProductAdjusted_PriceSpecial').first().text());
  const regular = num($('.CssCatProductAdjusted_Price').first().text());
  if (!price) price = special || regular;
  const oldPrice = regular && price && regular > price ? regular : null;

  // Description: the short description span. Fallback to JSON-LD / og.
  const descEl = $('[itemprop=description]').first();
  descEl.find('br').replaceWith(' ');
  descEl.find('p,div,li,h2,h3,h4').append(' ');
  let desc = clean(descEl.text());
  if (!desc) desc = clean(og('og:description'));
  if (desc.length > DESC_MAX) desc = desc.slice(0, DESC_MAX).replace(/\s\S*$/, '') + '…';

  const crumbs = [];
  $('ol.SB_breadcrumb li').each((_, li) => {
    const a = $(li).find('a').first();
    const name = clean($(li).text());
    if (!name) return;
    let href = a.attr('href') || $(li).find('[itemprop=item]').attr('href') || null;
    if (href) { try { href = new URL(href, SITE).href; } catch (e) { href = null; } }
    crumbs.push({ name, url: href });
  });

  const availability = $('[itemprop=availability]').attr('content') || '';
  const canBuy = $('#BtnAddToBasket_Anchor').length > 0;

  return {
    type: 'product',
    id: String(id || ''),
    url: canonical,
    name: h1,
    price: price || null,
    oldPrice,
    desc,
    crumbs,
    img: og('og:image') || null,
    inStock: !/OutOfStock|SoldOut/i.test(availability),
    canBuy,
  };
}

async function crawl(log = console.log) {
  const t0 = Date.now();
  const sm = await get(SITE + '/sitemap.xml');
  if (!sm) throw new Error('sitemap not reachable');
  const urls = [...new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&').trim()))]
    .filter((u) => !/Article2\.asp|contact1\.asp/i.test(u));
  log(`[catalog] sitemap: ${urls.length} urls`);

  const results = [];
  let i = 0, done = 0, failed = 0;
  async function worker() {
    while (i < urls.length) {
      const u = urls[i++];
      const html = await get(u);
      done++;
      if (done % 50 === 0) log(`[catalog] ${done}/${urls.length} pages, ${failed} failed`);
      if (!html) { failed++; continue; }
      try { results.push(parsePage(html, u)); } catch (e) { log('[catalog] parse error', u, e.message); }
      await new Promise((r) => setTimeout(r, 150)); // be gentle with the shop server
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const byId = new Map();
  for (const r of results) {
    if (r.type !== 'product' || !r.id) continue;
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  const products = [...byId.values()];

  // Pages (categories, info pages). Keep only those with a title, dedupe by url.
  const pages = [];
  const seen = new Set();
  const addPage = (title, url) => {
    title = clean(title);
    if (!title || !url || seen.has(url)) return;
    seen.add(url);
    pages.push({ title, url });
  };
  for (const r of results) if (r.type === 'page') addPage(r.title, r.url);
  for (const p of products) for (const c of p.crumbs) if (c.url) addPage(c.name, c.url);

  log(`[catalog] ${products.length} products, ${pages.length} pages, ${failed} failed, in ${Math.round((Date.now() - t0) / 1000)}s`);
  return { builtAt: new Date().toISOString(), products, pages };
}

// Compact text version for the system prompt. Products get short keys (P1, P2 …)
// are the product id itself; pages get L1, L2 …
function toPromptText(cat) {
  const lines = [];
  lines.push('## מוצרים בחנות (מזהה | שם | מחיר | קטגוריה | תיאור)');
  const shop = cat.products.filter((p) => p.price && p.canBuy);
  const gallery = cat.products.filter((p) => !(p.price && p.canBuy));
  for (const p of shop) {
    const price = p.oldPrice ? `${p.price}₪ (במקום ${p.oldPrice}₪)` : `${p.price}₪`;
    const cat_ = p.crumbs.map((c) => c.name).join(' > ');
    lines.push(`P:${p.id} | ${p.name} | ${price}${p.inStock ? '' : ' | אזל מהמלאי'} | ${cat_} | ${p.desc}`);
  }
  if (gallery.length) {
    lines.push('');
    lines.push('## דוגמאות עבודה מהגלריה (לא למכירה ישירה; מראות על מה אנחנו חורטים. להצעת מחיר → ווטסאפ)');
    for (const p of gallery) lines.push(`P:${p.id} | ${p.name} | ${p.crumbs.map((c) => c.name).join(' > ')}`);
  }
  lines.push('');
  lines.push('## דפים באתר (קטגוריות ודפי מידע)');
  cat.pages.forEach((pg, i) => lines.push(`L:${i + 1} | ${pg.title}`));
  return lines.join('\n');
}

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function save(file, cat) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cat));
  } catch (e) { console.log('[catalog] save failed', e.message); }
}

module.exports = { crawl, parsePage, toPromptText, load, save, SITE };
