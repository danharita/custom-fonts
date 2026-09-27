import asyncio, sys
from playwright.async_api import async_playwright
URL='http://localhost:8099/catalog.asp?page=newshowprod.asp&prodid=2644115'
OUT=sys.argv[1] if len(sys.argv)>1 else '/tmp'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    # hidden without flag
    pg=await b.new_page(); await pg.goto(URL); await pg.wait_for_timeout(500)
    print('without flag, widget present:', await pg.evaluate('!!window.DHChat'))
    for name,vp,mobile in [('desktop',{'width':1280,'height':800},False),('mobile',{'width':390,'height':800},True)]:
      ctx=await b.new_context(viewport=vp,is_mobile=mobile,has_touch=mobile)
      pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
      await pg.goto(URL+'#dhchat'); await pg.wait_for_timeout(600)
      await pg.screenshot(path=f'{OUT}/{name}-1-closed.png')
      await pg.locator('#dh-chat-host').locator('.btn').click()
      await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/{name}-2-open.png')
      await pg.locator('#dh-chat-host').locator('.chip').first.click()
      await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/{name}-3-answer.png')
      ta=pg.locator('#dh-chat-host').locator('textarea'); await ta.fill('מה הסטטוס של ההזמנה שלי?'); await ta.press('Enter')
      await pg.wait_for_timeout(1200); await pg.screenshot(path=f'{OUT}/{name}-4-wa.png')
      hrefs=await pg.evaluate("[...document.querySelector('#dh-chat-host').shadowRoot.querySelectorAll('a')].map(a=>a.className+' '+a.href.slice(0,80))")
      print(name,'errors:',errs); print('\n'.join(hrefs))
      # persistence across navigation
      await pg.reload(); await pg.wait_for_timeout(600)
      n=await pg.evaluate("document.querySelector('#dh-chat-host').shadowRoot.querySelectorAll('.msg.user').length")
      print(name,'user msgs after reload:',n)
    await b.close()
asyncio.run(main())
