/* Optional design-export tooling. Requires Node.js and Playwright (validated with 1.64.1). */
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

(async () => {
  const directory = __dirname;
  const browser = await chromium.launch({headless: true, executablePath: process.env.PEEL_BROWSER_PATH || chromium.executablePath()});
  const page = await browser.newPage({viewport: {width: 1280, height: 1080}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = pathToFileURL(path.join(directory, 'index.html')).href;
  await page.goto(url + '?capture=1');
  await page.waitForFunction(() => window.PEEL_SCREENS?.length > 0);
  const screens = await page.evaluate(() => window.PEEL_SCREENS);
  const ids = new Set(screens.map(s => s.id));
  if (ids.size !== screens.length) throw new Error('Duplicate screen IDs');
  await fs.mkdir(path.join(directory, 'screens'), {recursive: true});
  const report = [];
  for (const screen of screens) {
    await page.evaluate(id => window.showPeelScreen(id), screen.id);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#artboard img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const info = await page.locator('#artboard').evaluate(root => {
      const rect = root.getBoundingClientRect();
      const broken = [...root.querySelectorAll('[data-screen]')].map(el => el.dataset.screen).filter(id => !window.PEEL_SCREENS.some(s => s.id === id));
      const dialogs = [...root.querySelectorAll('.dialog,.phone-sheet')].map(el => {
        const r = el.getBoundingClientRect();
        return {width:r.width,height:r.height,inside:r.left>=rect.left-1&&r.right<=rect.right+1&&r.top>=rect.top-1&&r.bottom<=rect.bottom+1};
      });
      const noteChrome = [...root.querySelectorAll('.desktop-note-bar,.sticky-titlebar')].map(bar => ({
        buttons:bar.querySelectorAll('button').length,
        close:bar.querySelector('button')?.getAttribute('aria-label'),
        traffic:bar.querySelectorAll('.traffic').length,
        glyph:bar.querySelector('button path')?.getAttribute('d'),
        color:getComputedStyle(bar.querySelector('button'),'::before').backgroundColor
      }));
      const desktop={scene:!!root.querySelector('.peel-desktop'),dock:root.querySelectorAll('.mac-os-dock').length,formatting:root.querySelectorAll('.format-bar').length};
      return {width:rect.width,height:rect.height,broken,dialogs,noteChrome,desktop,body:root.innerText};
    });
    if (!info.body.trim()) throw new Error('Empty screen: ' + screen.id);
    if (info.broken.length) throw new Error('Broken mockup routes: ' + screen.id + ': ' + info.broken.join(', '));
    if (info.dialogs.some(d => !d.inside)) throw new Error('Dialog outside artboard: ' + screen.id);
    if (info.noteChrome.some(bar => bar.buttons !== 1 || !/close/i.test(bar.close) || bar.traffic)) throw new Error('Floating note must have only one Close control: ' + screen.id);
    if (info.noteChrome.some(bar => bar.glyph !== 'M6 12h12' || bar.color !== 'rgb(98, 197, 107)')) throw new Error('Floating note must use a green minus: ' + screen.id);
    if (screen.group==='Mac capture'&&(!info.desktop.scene||info.desktop.dock!==1||info.desktop.formatting)) throw new Error('Mac capture must use the shared desktop design: ' + screen.id);
    if (/Default destination|Where should this note live|Choose a destination for|This note will leave (?:Peel|Synkies) Cloud/.test(info.body)) throw new Error('Stale per-note mode choice: '+screen.id);
    if (/Google|Stickies|STICKIES|your Drive|Drive storage|\bPeel\b/.test(info.body)) throw new Error('Stale provider or branding: ' + screen.id);
    await page.locator('#artboard').screenshot({path:path.join(directory,'screens',screen.id+'.png')});
    report.push({id:screen.id,width:info.width,height:info.height});
  }
  for (const id of ['mac-library','mac-note','iphone-editor','web-library','mac-desktop']) {
    await page.evaluate(id => {document.body.dataset.theme='dark'; window.showPeelScreen(id);},id);
    await page.locator('#artboard').screenshot({path:path.join(directory,'screens',id+'-dark.png')});
  }
  // Review navigation and presentation toggles, not application behavior.
  await page.goto(url+'#mac-library');
  await page.getByRole('button',{name:'New note',exact:true}).click();
  if (!page.url().endsWith('#mac-capture')) throw new Error('Capture flow failed');
  await page.evaluate(() => window.showPeelScreen('cloud-signin'));
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  if (!page.url().endsWith('#cloud-signup')) throw new Error('Account flow failed');
  await page.evaluate(() => window.showPeelScreen('storage-destination'));
  await page.locator('.dialog').getByRole('button',{name:/On-device · Free/}).click();
  if(!page.url().endsWith('#peer-devices'))throw new Error('Free mode route failed');
  await page.locator('#artboard').getByRole('button',{name:'Pair another device',exact:true}).click();
  await page.locator('#artboard').getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#artboard').getByRole('button',{name:'Confirm and pair',exact:true}).click();
  if(!page.url().endsWith('#peer-syncing'))throw new Error('Peer pairing route failed');
  await page.evaluate(() => window.showPeelScreen('peer-latest'));
  const latestText=await page.locator('#artboard').innerText();
  if(!latestText.includes('Latest edit applied automatically')||!latestText.includes('7 days')||await page.locator('#artboard').getByRole('button',{name:/Resolve conflict|Combine versions/}).count())throw new Error('Peer latest-edit state is not automatic');
  await page.evaluate(() => window.showPeelScreen('cloud-plan'));
  await page.locator('#artboard').getByRole('button',{name:'Review library upload',exact:true}).click();
  await page.locator('#artboard').getByRole('button',{name:'Preview activation',exact:true}).click();
  await page.locator('#artboard').getByRole('button',{name:'View Cloud library',exact:true}).click();
  if(!page.url().endsWith('#cloud-live'))throw new Error('Paid whole-library activation route failed');
  await page.evaluate(() => window.showPeelScreen('move-to-local'));
  await page.locator('#artboard').getByRole('button',{name:'Verify device copy',exact:true}).click();
  await page.locator('#artboard').getByRole('button',{name:'Use On-device mode',exact:true}).click();
  if(!page.url().endsWith('#peer-devices'))throw new Error('Safe downgrade route failed');
  await page.evaluate(() => window.showPeelScreen('iphone-collections'));
  if(!(await page.locator('#artboard').innerText()).includes('One mode for all your notes'))throw new Error('iPhone mode scope is stale');
  await page.locator('#appearance').click();
  if (await page.locator('body').getAttribute('data-theme') !== 'dark') throw new Error('Appearance switch failed');
  await page.goto(url+'?capture=1#mac-desktop');
  const note=page.locator('.desktop-note').first();
  const before=await note.boundingBox();
  const handle=await note.locator('.desktop-note-caption').boundingBox();
  await page.mouse.move(handle.x+20,handle.y+5);await page.mouse.down();
  await page.mouse.move(handle.x+90,handle.y+35,{steps:8});await page.mouse.up();
  const after=await note.boundingBox();
  if(after.x-before.x<60||after.y-before.y<20) throw new Error('Desktop note titlebar drag failed');
  await page.goto(url+'?capture=1#mac-library-desktop');
  await page.evaluate(() => window.showPeelScreen('mac-library-desktop'));
  const dragCard=page.locator('[data-library-note="weekend"]');
  const cardBox=await dragCard.boundingBox();
  await page.mouse.move(cardBox.x+45,cardBox.y+55);await page.mouse.down();
  await page.mouse.move(950,440,{steps:12});await page.mouse.up();
  if(await page.locator('.desktop-note').count()!==2) throw new Error('Library drag-out did not pin');
  if(!await page.locator('[data-status-for="weekend"]').innerText().then(t=>t.includes('On desktop'))) throw new Error('Pinned library indicator missing');
  if(await page.locator('[data-library-note]').count()!==3) throw new Error('Drag-out removed source library card');
  await page.goto(url+'?capture=1#mac-library-desktop');
  await page.evaluate(() => window.showPeelScreen('mac-library-desktop'));
  const cancelBox=await page.locator('[data-library-note="weekend"]').boundingBox();
  await page.mouse.move(cancelBox.x+45,cancelBox.y+55);await page.mouse.down();
  await page.mouse.move(950,440,{steps:10});await page.keyboard.press('Escape');await page.mouse.up();
  if(await page.locator('.desktop-note').count()!==1) throw new Error('Cancelled drag created a note');
  await page.goto(url+'?capture=1#mac-library-desktop');
  await page.evaluate(() => window.showPeelScreen('mac-library-desktop'));
  await page.locator('[data-library-note="weekend"]').click({button:'right',position:{x:45,y:55}});
  await page.getByRole('button',{name:'Pin to desktop',exact:true}).click();
  if(await page.locator('.desktop-note').count()!==2) throw new Error('Right-click pin failed');
  await page.locator('[data-library-note="weekend"]').click({button:'right',position:{x:45,y:55}});
  await page.getByRole('button',{name:'Bring to front',exact:true}).click();
  if(await page.locator('.desktop-note').count()!==2) throw new Error('Pin duplicated an existing window');
  await page.evaluate(() => window.showPeelScreen('mac-library-desktop'));
  const independent = await page.locator('.desktop-note').evaluateAll(nodes => nodes.every(n => !n.closest('.desktop-library-window')));
  if(!independent) throw new Error('Desktop note is contained by Notes Library');
  await page.locator('.desktop-note').evaluateAll(nodes => nodes.forEach(n => n.dataset.existingWindow='yes'));
  const geometry = await page.locator('.desktop-note').evaluateAll(nodes => nodes.map(n => ({id:n.dataset.noteId,x:n.offsetLeft,y:n.offsetTop})));
  await page.getByRole('button',{name:'Close Notes Library',exact:true}).click();
  if(await page.locator('.desktop-library-window').count()) throw new Error('Library Close did not close the library');
  const surviving = await page.locator('.desktop-note').evaluateAll(nodes => nodes.map(n => ({id:n.dataset.noteId,x:n.offsetLeft,y:n.offsetTop})));
  if(JSON.stringify(geometry)!==JSON.stringify(surviving)||await page.locator('.desktop-note[data-existing-window="yes"]').count()!==geometry.length) throw new Error('Closing library changed floating windows');
  await page.locator('.desktop-note-close').first().click();
  if(await page.locator('.desktop-note').count()!==geometry.length-1||await page.locator('.desktop-library-window').count()) throw new Error('Note Close affected another window');
  if(!/Saved and closed/.test(await page.locator('.desktop-feedback').innerText())) throw new Error('Note Close feedback missing');
  await page.evaluate(() => window.showPeelScreen('mac-library-pinned'));
  await page.locator('.desktop-note-close').first().click();
  if(await page.locator('.desktop-note').count()!==1||await page.locator('.desktop-library-window').count()!==1||await page.locator('[data-library-note]').count()!==3) throw new Error('Note Close removed another note or library entry');
  await page.evaluate(() => window.showPeelScreen('mac-note'));
  await page.getByRole('button',{name:'Save and close note',exact:true}).click();
  if(await page.locator('.sticky-window,.desktop-library-window,.app-shell').count()) throw new Error('Standalone note Close opened or retained a window');
  await page.evaluate(() => window.showPeelScreen('save-error'));
  await page.getByRole('button',{name:'Save and close note',exact:true}).click();
  if(await page.locator('.sticky-window').count()!==1||await page.locator('.banner.error[role="alert"]').count()!==1) throw new Error('Failed-save mockup must keep the note open');
  for(const id of ['mac-capture','mac-note','mac-source']){
    await page.evaluate(id=>window.showPeelScreen(id),id);
    const captureNote=page.locator('.desktop-note').first(),start=await captureNote.boundingBox(),bar=await captureNote.locator('.desktop-note-caption').boundingBox();
    await page.mouse.move(bar.x+20,bar.y+5);await page.mouse.down();
    await page.mouse.move(bar.x+90,bar.y+35,{steps:8});await page.mouse.up();
    const end=await captureNote.boundingBox();
    if(end.x-start.x<60||end.y-start.y<20) throw new Error('Mac capture titlebar drag failed: '+id);
  }
  await page.evaluate(()=>window.showPeelScreen('mac-capture'));
  await page.getByRole('button',{name:'Save and close note',exact:true}).click();
  if(await page.locator('.desktop-note').count()||!/Empty draft closed/.test(await page.locator('.desktop-feedback').innerText())) throw new Error('Empty capture did not dismiss its draft');
  await page.evaluate(()=>window.showPeelScreen('mac-note'));
  await page.locator('.sticky-content').click({button:'right',position:{x:60,y:70}});
  if(!await page.getByRole('menu',{name:'Note actions'}).isVisible()) throw new Error('Capture right-click actions missing');
  await page.getByRole('button',{name:'Keep on top',exact:true}).click();
  if(await page.locator('.desktop-note.desktop-on-top').count()!==1) throw new Error('Capture menu did not toggle Keep on top');
  await page.evaluate(()=>window.showPeelScreen('mac-menu-bar'));
  if(await page.locator('.desktop-note,.desktop-library-window').count()) throw new Error('Resident menu capture should show closed note/library windows');
  await page.getByRole('button',{name:'New note',exact:true}).click();
  if(!page.url().endsWith('#mac-capture')||await page.locator('.desktop-note').count()!==1) throw new Error('Menu bar capture did not open the updated floating note');
  await page.goto(url+'?capture=1#mac-desktop');
  let previousPositions;
  for(const [key,edge] of [['ArrowLeft','left'],['ArrowRight','right'],['ArrowUp','top'],['ArrowDown','bottom']]){
    previousPositions=await page.locator('.desktop-note').evaluateAll(nodes=>nodes.map(n=>({x:n.offsetLeft,y:n.offsetTop})));
    await page.keyboard.press('Control+Alt+Meta+'+key);
    const layout=await page.locator('.peel-desktop').evaluate(el=>({edge:el.dataset.arranged,width:el.clientWidth,height:el.clientHeight,notes:[...el.querySelectorAll('.desktop-note')].map(n=>({x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight}))}));
    if(layout.edge!==edge) throw new Error('Arrangement shortcut failed: '+edge);
    for(const n of layout.notes){
      if(edge==='left'&&n.x>35||edge==='right'&&layout.width-n.x-n.w>35||edge==='top'&&n.y>65||edge==='bottom'&&layout.height-n.y-n.h>70) throw new Error('Wrong visual edge: '+edge);
    }
  }
  await page.getByRole('button',{name:'Window',exact:true}).click();
  await page.getByRole('button',{name:'Undo last arrangement',exact:true}).click();
  const restored=await page.locator('.desktop-note').evaluateAll(nodes=>nodes.map(n=>({x:n.offsetLeft,y:n.offsetTop})));
  if(restored.some((n,i)=>Math.abs(n.x-previousPositions[i].x)>2||Math.abs(n.y-previousPositions[i].y)>2)) throw new Error('Undo arrangement failed');
  await page.setViewportSize({width:390,height:1000});
  await page.goto(url+'#iphone-library');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Gallery overflows at 390px');
  if (errors.length) throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(directory,'inventory.json'),JSON.stringify(screens,null,2)+'\n');
  await fs.writeFile(path.join(directory,'render-report.json'),JSON.stringify({screenCount:screens.length,additionalDarkScreens:5,browserErrors:errors,checks:['free/paid whole-library modes','remote peer pairing routes','automatic latest-edit recovery','paid activation and downgrade routes','no stale per-note destination flows','green minus Put away control','all screens render','all mockup routes resolve','all dialogs inside artboard','branding/provider check','one Close control per floating note','all six Mac capture screens use shared desktop design','capture navigation','account navigation','appearance switch','desktop titlebar drag','quick capture/formatted/source titlebar drag','empty capture dismisses its draft','capture right-click actions and Keep on top','resident menu bar capture with all windows closed','library drag-out pin','cancel drag','right-click pin','no duplicate window','notes outside library hierarchy','library Close preserves existing note windows and positions','note Close affects only its window and retains library entry','standalone note Close','failed-save Close keeps note open','four keyboard edge arrangements','undo arrangement','390px gallery width'],screens:report},null,2)+'\n');
  console.log(JSON.stringify({screens:screens.length,pngs:screens.length+5,errors}));
  const logoPage = await browser.newPage({viewport:{width:737,height:256},deviceScaleFactor:1});
  await logoPage.goto(pathToFileURL(path.join(directory,'brand','logo-light.svg')).href);
  await logoPage.screenshot({path:path.join(directory,'brand','logo-light.png'),omitBackground:true});
  await browser.close();
})().catch(error => {console.error(error);process.exit(1);});
