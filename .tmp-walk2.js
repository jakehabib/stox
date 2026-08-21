const { chromium } = require('/home/user/stox/node_modules/playwright');
const OUT = '/tmp/claude-0/-home-user-stox/a7c0946e-4eaa-5dc1-9280-99e0da3b1580/scratchpad/shots';
const BASE = 'http://localhost:3001';
const errors = [];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // --- 1440 picker + overlay + start
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

  await p.goto(BASE + '/new?team=SEA', { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/d01-teamselect-v2-1440.png', fullPage: true });
  await p.fill('#league-name', 'Overlay Check 2');
  const clicked = p.getByRole('button', { name: /Take over the/ }).click();
  let seen = false;
  for (let i = 0; i < 60; i++) {
    if (await p.locator('text=Building the league…').count().catch(() => 0)) {
      seen = true;
      await p.waitForTimeout(120);
      await p.screenshot({ path: OUT + '/d02-building-overlay-1440.png' });
      break;
    }
    await p.waitForTimeout(50);
  }
  console.log('overlay seen:', seen);
  await clicked.catch(() => {});
  await p.waitForURL('**/start/**', { timeout: 60000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/d03-start-v2-1440.png', fullPage: true });
  console.log('start url:', p.url());

  // --- 390 picker with sticky start bar
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  mp.on('pageerror', e => errors.push('MOB PAGEERROR ' + e.message));
  await mp.goto(BASE + '/new?team=NOR', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: OUT + '/d04-teamselect-v2-390-viewport.png' });
  await mp.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: OUT + '/d05-teamselect-390-scrolled.png' });

  console.log('ERRORS', errors.length); errors.slice(0,10).forEach(e=>console.log(' ',e));
  await b.close();
})();
