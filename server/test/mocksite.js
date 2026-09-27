// Mock of the 2all shop, same markup as the real product pages (checked 27.9.2026).
const http=require('http');
const B='http://localhost:8099';
const prods={
 '2851248':{n:"בוצ'ר עץ שיטה + סכין סנטוקו 18 סמ להב עם חריטה אישית",p:279,r:330,d:'בוצ\'ר עץ שיטה איכותי עם חריטה אישית<br>גודל הבוצ\'ר 38*30 ס"מ כולל תעלת ניקוז',bc:['מתנות לפי נושאים','מתנות עם חריטה בעיצוב אישי',"קרש חיתוך בוצ'ר וסכין שף עם חריטה אישית"]},
 '2644115':{n:'מצית זיפו כסוף עם חריטה אישית',p:149,r:null,d:'מצית זיפו מקורי, חריטה משני הצדדים',bc:['מצתים עם חריטה']},
 '1553186':{n:'חריטה על שעון יד',p:null,r:null,d:'דוגמה לחריטה על שעון',bc:['חריטה אומנותית','חריטה על שעונים'],nobuy:true},
};
function prodHtml(id){const x=prods[id];return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${x.n} - במחיר ${x.p}₪ בלבד</title>
<meta property="og:url" content="${B}/catalog.asp?page=newshowprod.asp&prodid=${id}"><meta property="og:image" content="${B}/Cat_${id}.webp">
<meta property="og:description" content="סקיצה אישית"></head><body>
<ol class="SB_breadcrumb">${x.bc.map((c,i)=>`<li itemprop="itemListElement"><a itemprop="item" href="/catalog.asp?t1=${i+2}"><span itemprop="name">${c}</span></a></li>`).join('')}</ol>
<div id="FrmCatalog" class="cssFrmCatalog"><input name="PicID" value="${id}">
<h1 class="CssCatProductAdjusted_header">${x.n}</h1>
<div class="CssCatProductAdjusted_Price_Container">${x.r?`<div class="CssCatProductAdjusted_Price">מחיר: ₪${x.r}</div><div class="CssCatProductAdjusted_PriceSpecial">מחיר מבצע: ₪${x.p}</div>`:x.p?`<div class="CssCatProductAdjusted_Price">מחיר: ₪${x.p}</div>`:''}</div>
${x.p?`<meta itemprop="price" content="${x.p}"><meta itemprop="availability" content="https://schema.org/InStock">`:''}
<span itemprop="description"><div class="SB_Text_Container"><p>${x.d}</p></div></span>
${x.nobuy?'':'<a id="BtnAddToBasket_Anchor">הוספה לסל</a>'}</div>
<script src="/widget.js" data-api="http://localhost:3055" async></script>
<div id="FrmCatalog999"><input name="PicID" value="999"><h3 class="CssCatalogAdjusted_top">מוצר קשור</h3></div></body></html>`;}
http.createServer((q,s)=>{const u=new URL(q.url,B);
 if(u.pathname==='/widget.js'){s.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});return s.end(require('fs').readFileSync(__dirname+'/../../chat/widget.js'));}
 if(u.pathname==='/sitemap.xml'){s.writeHead(200,{'content-type':'text/xml'});return s.end(`<urlset>${[...Object.keys(prods).map(i=>`${B}/catalog.asp?page=newshowprod.asp&amp;prodid=${i}`),B+'/catalog.asp?t1=2',B+'/page5.asp'].map(l=>`<url><loc>${l}</loc></url>`).join('')}</urlset>`);}
 const id=u.searchParams.get('prodid'); if(id&&prods[id]){s.writeHead(200,{'content-type':'text/html; charset=utf-8'});return s.end(prodHtml(id));}
 if(u.searchParams.get('t1')){s.writeHead(200,{'content-type':'text/html; charset=utf-8'});return s.end('<title>דן חריטה אומנותית, מתנות לפי נושאים</title><h1>מתנות לפי נושאים</h1>');}
 if(u.pathname==='/page5.asp'){s.writeHead(200,{'content-type':'text/html; charset=utf-8'});return s.end('<title>דן חריטה אומנותית, תקנון האתר</title>');}
 s.writeHead(404);s.end();}).listen(8099,()=>console.log('mock site on 8099'));
