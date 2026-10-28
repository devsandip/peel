/* Presentation-only mockups. All note content is synthetic; no network or persistence. */
(() => {
  const icons = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>',
    note: '<path d="M5 3h14v12l-6 6H5zM13 21v-6h6M8 7h8M8 11h5"/>',
    notes: '<rect x="5" y="3" width="15" height="17" rx="2"/><path d="M2 7v14h14M9 7h7M9 11h7M9 15h4"/>',
    archive: '<path d="M4 8h16v12H4zM3 3h18v5H3zM9 12h6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/>',

    device: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/>',
    cloud: '<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11z"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    forward: '<path d="m9 6 6 6-6 6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    pin: '<path d="m15 3 6 6-4 1-3 5-2-2-7 7M9 10l-3-3 5-3zM9 10l5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    minus: '<path d="M6 12h12"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3z"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    move: '<path d="M3 12h18m-5-5 5 5-5 5M8 7l-5 5 5 5"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    wifi: '<path d="M2 8a17 17 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a5 5 0 0 1 8 0"/><circle cx="12" cy="20" r=".7"/>',
    offline: '<path d="m3 3 18 18M2 8a17 17 0 0 1 4-2M10 5a17 17 0 0 1 12 3M5 12a11 11 0 0 1 5-2M15 11a11 11 0 0 1 4 1M8 16a5 5 0 0 1 6-1"/><circle cx="12" cy="20" r=".7"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5"/>',
    alert: '<path d="m12 3 10 18H2zM12 9v5M12 17v1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    numbered: '<path d="M9 6h12M9 12h12M9 18h12M3 3h1v6M2 13c0-3 4-3 4 0l-4 5h4"/>',
    checkbox: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>',
    battery: '<rect x="2" y="6" width="17" height="12" rx="2"/><path d="M22 10v4M5 9h11v6H5z"/>',
    signal: '<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.note}</svg>`;
  const esc = (text) => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const btn = (text, target, kind = 'secondary-button', symbol = '') => `<button class="${kind}" data-screen="${target}">${symbol ? icon(symbol) : ''}${text}</button>`;
  const ib = (name, label, target) => `<button class="icon-button" aria-label="${label}" data-screen="${target}">${icon(name)}</button>`;
  const badge = text => `<span class="tag">${text}</span>`;
  const traffic = '<div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>';
  const check = (label, done = false) => `<div class="card-check"><span class="check-square ${done?'done':''}">${done?'✓':''}</span><span class="${done?'done-text':''}">${label}</span></div>`;
  const entries = [];
  const add = (id, title, group, kind, description, requirements = 'FR-05', platform = 'mac', variant = '') => entries.push({id,title,group,kind,description,requirements,platform,variant});

  add('mac-desktop','Notes on the desktop','Mac capture','desktop','Independent notes stay close to the work. Each can float above other windows.','FR-01 · FR-11');
  add('mac-capture','Quick capture','Mac capture','floating','A draggable desktop note with a ready cursor. Its only window control is a green minus that saves and puts it away.','FR-01 · FR-02','mac','capture');
  add('mac-note','Formatted note','Mac capture','floating','The same floating note window, showing supported Markdown, checklists, and inline tags.','FR-02 · FR-09 · FR-10','mac','note');
  add('mac-source','Markdown source','Mac capture','floating','Markdown source stays in the same independent desktop window, with one green Put away control.','FR-10','mac','source');
  add('mac-note-menu','Note actions','Mac capture','floating','Right-click or use the app menu for note actions. The window keeps only its green Put away button.','FR-07 · FR-11 · FR-12','mac','menu');
  add('mac-menu-bar','Menu bar capture','Mac capture','desktop','The resident menu bar opens a floating note even when the library and all note windows are closed.','FR-01 · FR-11','mac','menu');
  add('mac-library','Notes library','Library','library','A searchable home for open and closed notes in the selected collection.','FR-05 · FR-08');
  add('mac-empty','First local note','Library','library','Local capture is available immediately, without an account.','FR-01 · FR-03','mac','empty');
  add('mac-tags','Filter by tags','Library','library','Tags are derived from note text. Multiple selected tags use AND.','FR-09','mac','tags');
  add('mac-archive','Archive','Library','library','Archived notes remain searchable and can be returned to Notes.','FR-07','mac','archive');
  add('mac-trash','Trash and restore','Library','library','Deleted notes can be restored for 30 days.','FR-07','mac','trash');
  add('delete-note','Delete permanently','Library','dialog','A separate confirmation explains irreversible removal and offline copies.','FR-07','mac','delete');
  add('search-words','Word search','Search','search','Search body text, derived titles, and tags without a cloud round trip.','FR-06','mac','words');
  add('search-empty','No search matches','Search','search','An empty result gives a clear way back without inventing an answer.','FR-06','mac','empty');
  add('search-meaning','Search by meaning','Search','search','Natural-language retrieval returns saved notes and matched excerpts.','FR-06 · FR-14','mac','meaning');
  add('model-consent','Enable meaning search','Search','dialog','An explicit model download choice explains on-device processing. The size is illustrative until M0.','FR-06 · FR-14','mac','model-consent');
  add('model-download','Model download','Search','dialog','Pause or cancel the download while word search remains available.','FR-06','mac','model-download');
  add('model-indexing','Preparing meaning search','Search','dialog','The app explains indexing progress while keeping capture available.','FR-06 · FR-08','mac','model-indexing');
  add('model-unavailable','Meaning search unavailable','Search','dialog','An unsupported device can continue with word search.','FR-06','mac','model-unavailable');
  add('storage-destination','Choose saving mode','Storage','dialog','Choose free remote periodic device sync or paid whole-library live Cloud sync.','FR-03 · FR-17 · FR-18','mac','destination');
  add('cloud-signin','Connect Synkies Cloud','Storage','dialog','Sign in to Synkies to open the account’s cloud collection.','FR-04 · FR-14','mac','cloud-signin');
  add('cloud-authorizing','Waiting for authorization','Storage','dialog','System-browser authorization can be completed or cancelled without blocking local work.','FR-04','mac','cloud-authorizing');
  add('cloud-download','Downloading cloud notes','Storage','library','Initial progress is visible; partial results are not presented as a complete collection.','FR-04 · FR-08','mac','download');
  add('move-to-cloud','Enable Cloud for all notes','Storage','dialog','Explicitly authorize the complete library upload after paid-plan verification. Keep local copies until acknowledged.','FR-03 · FR-13 · FR-18','mac','move-cloud');
  add('move-to-local','Switch library to On-device','Storage','dialog','Verify a complete device copy before leaving Cloud. Cancellation and cloud-data removal are separate.','FR-03 · FR-13','mac','move-local');
  add('signout-cloud','Sign out of Synkies','Storage','dialog','Choose whether downloaded copies stay. Unsynced edits have a recovery path.','FR-04 · FR-14','mac','sign out');
  add('switch-account','Change Synkies account','Storage','dialog','Account switching preserves pending work and separates collections.','FR-14','mac','account');
  add('settings-general','General settings','Settings','settings','Configure quick capture, launch behavior, and appearance.','FR-01 · FR-11','mac','general');
  add('settings-storage','Storage settings','Settings','settings','App-wide mode, paired devices, local folder, and paid Cloud plan in one place.','FR-03 · FR-04','mac','storage');
  add('settings-search','Search settings','Settings','settings','Manage the local search model and derived index.','FR-06','mac','search');
  add('transfer-export','Export your notes','Settings','transfer','Portable Markdown and metadata make leaving straightforward.','FR-12','mac','export');
  add('transfer-import','Import notes','Settings','transfer','Import into the current mode, with sync/upload consequences shown before proceeding.','FR-12','mac','import');
  add('transfer-results','Import results','Settings','dialog','Imported, skipped, and oversized notes are reported explicitly.','FR-12','mac','import-results');
  add('sync-offline','Offline and saved locally','Recovery','library','Cloud notes remain editable. Local success and cloud status are separate.','FR-04 · FR-13','mac','offline');
  add('sync-reconnect','Sign in to sync again','Recovery','library','Expired authorization does not prevent local editing.','FR-04 · FR-13','mac','reconnect');
  add('sync-paused','Cloud sync paused','Recovery','library','A cloud error pauses sync while preserving local changes.','FR-04 · FR-13','mac','paused');
  add('save-error','Local save failed','Recovery','floating','The note stays open, with Retry and Copy text available.','FR-02 · FR-13','mac','save-error');
  add('conflict-compare','Compare concurrent versions','Recovery','conflict','Both offline versions survive until the person chooses how to resolve them.','FR-13','mac','compare');
  add('conflict-merge','Combine versions','Recovery','conflict','Merge the text or keep separate notes; neither version is silently discarded.','FR-13','mac','merge');
  add('cloud-missing','Cloud collection missing','Recovery','dialog','Local copies remain available while the person chooses a recovery action.','FR-04 · FR-13','mac','cloud-missing');
  add('local-drive-missing','Local folder unavailable','Recovery','dialog','A disconnected local drive does not trigger a hidden change of storage location.','FR-03 · FR-13','mac','local-missing');
  add('unsupported-version','Update required','Recovery','dialog','A newer storage schema is kept intact instead of being rewritten by an older app.','FR-13','mac','version');
  add('note-limit','Note length limit','Recovery','floating','An oversized paste is rejected explicitly, with the existing text preserved.','FR-10 · FR-13','mac','limit');
  add('shortcut-conflict','Shortcut unavailable','Recovery','dialog','A conflicting shortcut can be replaced without blocking menu bar capture.','FR-01','mac','shortcut');
  add('iphone-library','iPhone notes library','iPhone','phone','A compact two-column library with direct capture and collection selection.','FR-01 · FR-05','iphone','library');
  add('iphone-editor','iPhone note editor','iPhone','phone','Readable paper, touch checkboxes, and a clear local-save status.','FR-02 · FR-05 · FR-10','iphone','editor');
  add('iphone-capture','iPhone quick capture','iPhone','phone','The editor opens with the keyboard ready. Closing keeps the note.','FR-01 · FR-02','iphone','capture');
  add('iphone-source','iPhone Markdown source','iPhone','phone','The same source text is available on the phone.','FR-05 · FR-10','iphone','source');
  add('iphone-search','iPhone search','iPhone','phone','Word and meaning search share the same collection boundaries.','FR-05 · FR-06','iphone','search');
  add('iphone-tags','iPhone tag filters','iPhone','phone','An accessible bottom sheet keeps filtering within reach.','FR-09','iphone','tags');
  add('iphone-collections','iPhone saving mode','iPhone','phone','Choose a free On-device library or paid Cloud for all notes.','FR-03 · FR-05','iphone','collections');
  add('iphone-actions','iPhone note actions','iPhone','phone','A touch action sheet exposes sync status, archive, export, and delete.','FR-07 · FR-12','iphone','actions');
  add('iphone-settings','iPhone settings','iPhone','phone','Storage and search settings use the same vocabulary as Mac.','FR-03 · FR-06','iphone','settings');
  add('iphone-conflict','iPhone conflict resolution','iPhone','phone','Stacked versions preserve legibility on a small screen.','FR-13','iphone','conflict');
  add('iphone-trash','iPhone Trash','iPhone','phone','Recovery actions stay available on mobile.','FR-07','iphone','trash');
  add('iphone-move','iPhone mode switch','iPhone','phone','Switching applies to the entire library and keeps a verified local copy.','FR-03 · FR-13','iphone','move');
  add('web-library','Browser notes library','Browser','library','The same notes and navigation in a browser application shell. The URL is illustrative.','FR-05','web','');
  add('web-editor','Browser note editor','Browser','web-editor','Open a cloud note without losing the library context.','FR-02 · FR-05','web','');
  add('web-welcome','Browser first use','Browser','library','Start locally or sign in to Synkies, without implying access to a Mac local folder.','FR-03 · FR-05','web','welcome');
  add('web-offline','Browser offline','Browser','library','Cached notes remain available without a network connection.','FR-04 · FR-08','web','offline');
  add('web-storage','Browser storage settings','Browser','settings','Browser storage limitations, persistence status, and export are explicit.','FR-03 · FR-13','web','browser-storage');
  add('browser-quota','Browser storage is full','Browser','dialog','Unsaved text has an immediate copy/export recovery path.','FR-02 · FR-13','web','browser-quota');
  add('web-mobile','Android browser layout','Browser','phone','A responsive browser layout provides Android access without a native Android app.','FR-05','android','web-mobile');

  const notes = [
    {title:'A simpler first minute',body:'What if onboarding started with one useful thing, instead of a tour?',tags:['product','work'],date:'Just now',paper:true},
    {title:'Things for the weekend',checks:['Pick up coffee beans','Book a table for Saturday','Walk somewhere new'],done:1,tags:['life'],date:'20 min ago'},
    {title:'Small things worth keeping',body:'A good question can be more useful than a perfect answer. Leave room to be surprised.',tags:['ideas'],date:'1 hour ago'},
    {title:'A book to come back to',body:'“Pay attention. Be astonished. Tell about it.”\n\nA reminder to notice the ordinary.',tags:['reading'],date:'Today'},
    {title:'Next week, less but better',checks:['Protect one hour for deep work','Make the first draft smaller','Leave Friday open'],tags:['work'],date:'Today'},
    {title:'Sunday pasta',body:'Cherry tomatoes, olive oil, garlic. A little pasta water at the end. Keep it simple.',tags:['life'],date:'Yesterday',paper:true},
    {title:'Questions for the next test',body:'Where did you hesitate?\nWhat did you expect to happen?\nWhat would you do next?',tags:['product'],date:'Yesterday'},
    {title:'A walk without a destination',body:'Phone in the pocket. Take the long way home. Notice one thing you usually miss.',tags:['life'],date:'24 Oct'},
    {title:'An idea, not a plan yet',body:'A small place for the thoughts that are too useful to lose and too early to organize.',tags:['ideas'],date:'23 Oct'},
  ];
  const noteBody = () => `<h1>A simpler first minute</h1><p>What if onboarding started with <strong>one useful thing</strong>, instead of a tour?</p><p>Make the first action feel effortless.</p>${check('Sketch a smaller first screen')}${check('Write the first useful prompt',true)}<ol><li>Test with five people</li><li>Watch where they hesitate</li></ol><p class="raw-tags">##product &nbsp; ##work</p>`;
  const sourceText = '# A simpler first minute\n\nWhat if onboarding started with\n**one useful thing**, instead of a tour?\n\nMake the first action feel effortless.\n\n- [ ] Sketch a smaller first screen\n- [x] Write the first useful prompt\n\n1. Test with five people\n2. Watch where they hesitate\n\n##product ##work';
  const formatBar = (mobile = false) => `<div class="format-bar" aria-label="Formatting">${btn('H','mac-note','format-item')}${btn('<strong>B</strong>','mac-note','format-item')}${ib('checkbox','Checkbox',mobile?'iphone-editor':'mac-note')}${ib('list','Bullet list',mobile?'iphone-editor':'mac-note')}${ib('numbered','Numbered list',mobile?'iphone-editor':'mac-note')}<button class="format-source" data-screen="${mobile?'iphone-source':'mac-source'}">Markdown</button></div>`;
  const card = (n,i = 0, mode = '') => `<button class="note-card ${n.paper?'paper-card':''}" data-screen="${mode==='phone'?'iphone-editor':mode==='web'?'web-editor':current.variant==='archive'?'mac-archived-note':'mac-note'}"><h2>${n.title}</h2>${n.body?`<p>${n.body.replace(/\n/g,'<br>')}</p>`:''}${n.checks?n.checks.map((x,j)=>check(x,j<n.done)).join(''):''}<div class="tag-line">${n.tags.map(badge).join('')}</div><div class="note-card-footer"><span>${n.date}</span><span>${icon(onDevice(current)?'device':'cloud')}</span></div></button>`;
  const searchBox = (value = '',target = 'search-words', placeholder = 'Search your notes') => `<div class="search-box">${icon('search')}<input aria-label="Search notes" placeholder="${placeholder}" value="${value}" data-search-target="${target}"><kbd>⌘ K</kbd></div>`;
  const segment = meaning => `<div class="segment"><button class="${meaning?'':'selected'}" data-screen="${current.platform==='iphone'?'iphone-search':'search-words'}">Words</button><button class="${meaning?'selected':''}" data-screen="${current.platform==='iphone'?'iphone-meaning':'search-meaning'}">${icon('spark')}Meaning</button></div>`;
  const banner = (type,title,text,action = '',target = '') => `<div class="banner ${type}">${icon(type==='error'?'alert':type==='success'?'check':'offline')}<div class="banner-copy"><strong>${title}</strong>${text?`<br>${text}`:''}</div>${action?`<button data-screen="${target}">${action}</button>`:''}</div>`;
  const option = (name,description,symbol,target,selected = false) => `<button class="option-row ${selected?'selected-option':''}" data-screen="${target}">${icon(symbol)}<span class="option-detail"><strong>${name}</strong><small>${description}</small></span>${icon(selected?'check':'forward')}</button>`;
  const setting = (title,description,control) => `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${description}</small></div>${control}</div>`;
  const toggle = (on,label) => `<button class="toggle ${on?'on':''}" role="switch" aria-checked="${on}" aria-label="${label}" data-toggle></button>`;
  const account = () => `<div class="account-block"><span class="avatar">JD</span><div class="account-info"><strong>Jamie Davis</strong><small>jamie@example.com</small></div>${icon('cloud')}</div>`;

  const desktopScenes=window.PeelDesktop.create({icon,traffic,notes,noteMarkup:sticky,navigate:id=>show(id)});

  const onDevice = screen => screen.savingMode==='on-device'||['storage-destination','move-to-cloud','cloud-plan','cloud-activating'].includes(screen.id)||screen.id.startsWith('peer-')||screen.id.includes('-peer-')||screen.kind==='desktop'||screen.kind==='floating'||['empty','welcome','local'].includes(screen.variant);

  function sidebar(screen) {
    const variant = screen.variant;
    const active = screen.kind==='settings'||screen.kind==='transfer'?'settings':variant==='archive'?'archive':variant==='trash'?'trash':'notes';
    const local = onDevice(screen);
    return `<aside class="app-sidebar"><div class="app-logo"><img class="brand-lockup brand-light" src="brand/logo-light.svg" alt="Synkies"><img class="brand-lockup brand-dark" src="brand/logo-dark.svg" alt="Synkies"></div><div class="collection-label">SAVING MODE</div><button class="collection-select" data-screen="storage-destination">${icon(local?'device':'cloud')}${local?'On-device · Free':'Synkies Cloud · Paid'}${icon('chevron')}</button>${[['notes','Notes','mac-library','12'],['archive','Archive','mac-archive','3'],['trash','Trash','mac-trash','2']].map(([name,label,id,count])=>`<button class="side-link ${active===name?'is-active':''}" data-screen="${id}">${icon(name)}${label}<span class="count">${['empty','welcome'].includes(variant)?'0':count}</span></button>`).join('')}<div class="side-separator"></div><div class="side-label">TAGS</div>${['work','product','ideas','life','reading'].map(t=>`<button class="side-link ${variant==='tags'&&(t==='work'||t==='product')?'is-active':''}" data-screen="mac-tags"><span class="tag-dot"></span>${t}</button>`).join('')}<div class="side-bottom"><button class="side-link ${active==='settings'?'is-active':''}" data-screen="settings-general">${icon('settings')}Settings</button><div class="sync-label"><span class="status-dot ${['offline','reconnect','paused'].includes(variant)?'pending':''}"></span>${screen.kind==='conflict'?'Cloud · 1 conflict needs review':variant==='offline'?'Offline · Changes waiting':local?'Last sync 2 min ago':'Live · All changes synced'}</div></div></aside>`;
  }
  function shell(screen,inner,dialog = '') {
    const web = screen.platform==='web';
    return `<section class="product ${web?'browser-product':''}" aria-label="${web?'Browser':'Mac'} app mockup">${web?`<div class="browser-titlebar">${traffic}${icon('back')}${icon('forward')}<div class="address-bar">${icon('lock')}synkies.example</div>${ib('upload','Browser share','transfer-export')}</div>`:`<div class="native-titlebar">${traffic}<span class="window-title">Synkies</span></div>`}<div class="app-layout">${sidebar(screen)}<section class="main-content">${inner}</section></div>${dialog?`<div class="overlay">${dialog}</div>`:''}</section>`;
  }
  function libraryContent(screen) {
    const v = screen.variant;
    const title = v==='archive'?'Archive':v==='trash'?'Trash':'Notes';
    const meta = v==='archive'?'3 notes, kept out of the way':v==='trash'?'Notes stay here for 30 days':v==='empty'||v==='welcome'?'Your own space to think':'12 notes · Most recently edited';
    let html = `<div class="main-top"><div><h1>${title}</h1><p class="subtle">${meta}</p></div>${v==='trash'?btn('Empty Trash','delete-note','secondary-button'):btn('New note',screen.platform==='web'?(v==='welcome'?'web-local-editor':'web-editor'):'mac-capture','primary-button','plus')}</div>`;
    if(v==='offline') html += banner('','You’re offline','Changes are saved on this device. 2 changes will sync when you reconnect.');
    if(v==='reconnect') html += banner('','Sign in to sync again','Your changes are safe on this device.','Sign in','cloud-signin');
    if(v==='paused') html += banner('error','Your cloud storage limit is reached','New changes are saved on this device. Cloud sync is paused.','View options','settings-storage');
    if(v==='download') html += `<div class="banner">${icon('download')}<div class="banner-copy"><strong>Downloading your notes</strong><br>486 of 1,240 notes. Search will be complete when the download finishes.<div class="progress-track" style="--progress:39%"><div class="progress-fill"></div></div></div>${btn('New local note','mac-capture','text-button')}</div>`;
    html += `<div class="search-row">${searchBox('',screen.platform==='web'?'search-words':'search-words')}</div>`;
    if(v==='empty'||v==='welcome') {
      return html + `<div class="empty-state"><div class="empty-illustration">${icon('note')}</div><h2>A place for your next thought.</h2><p>${v==='welcome'?'Start free in this browser and pair a device for remote periodic sync, or choose paid Cloud for a stored library and live updates.':'Create a note, type what’s on your mind, and close it. Saving takes care of itself.'}</p>${btn('Create a note',v==='welcome'?'web-local-editor':'mac-capture','primary-button','plus')}<div>${btn('Choose saving mode','storage-destination','text-button')}</div><p class="subtle">${v==='welcome'?'Browser data stays in this browser profile.':'Quick capture: ⌃ ⌥ N'}</p></div>`;
    }
    if(v==='tags') html += `<div class="active-filters"><span class="filter-chip">work ${icon('close')}</span><span class="filter-chip">product ${icon('close')}</span><span class="subtle">Match all tags</span>${btn('Clear','mac-library','text-button')}</div>`;
    if(v==='trash') return html + `<div class="banner">${icon('info')}<span>Restore a note before its 30 days are up. Permanent deletion cannot be undone.</span></div>${[['An older draft','Deleted 2 days ago · 28 days left'],['A thought to let go','Deleted 12 days ago · 18 days left']].map(([t,d])=>`<div class="setting-row"><div class="setting-copy"><strong>${t}</strong><small>${d}</small></div><div class="inline-flex">${btn('Restore','mac-library','secondary-button')}${ib('trash','Delete permanently','delete-note')}</div></div>`).join('')}`;
    html += `<div class="toolbar-line"><span>${v==='tags'?'2 notes':v==='archive'?'Search also includes archived notes':v==='download'?'Showing downloaded notes':'All notes'}</span><span class="inline-flex">${icon('columns')}Grid view</span></div>`;
    const subset = v==='tags'?[notes[0],notes[6]]:v==='archive'?[{...notes[3],date:'Archived 18 Oct'}, {...notes[4],date:'Archived 12 Oct'}, {...notes[8],date:'Archived 8 Oct'}]:v==='download'?notes.slice(0,3):notes;
    html += `<div class="note-grid">${subset.map((n,i)=>card(n,i,screen.platform==='web'?'web':'')).join('')}</div>`;
    if(v==='archive') html += `<div class="subtle" style="margin-top:18px">Open a note to unarchive it or edit its contents.</div>`;
    return html;
  }
  function results(meaning = false) {
    const data = meaning ? [
      ['A simpler first minute','What if onboarding started with <mark>one useful thing</mark>, instead of a tour? Make the first action feel effortless.','product','Just now'],
      ['Questions for the next test','<mark>Where did you hesitate?</mark> What did you expect to happen? What would you do next?','product','Yesterday'],
      ['A smaller welcome','Try removing the introductory walkthrough. Let people <mark>start with the thing they came to do.</mark>','work','Archived · 18 Oct']
    ] : [
      ['A simpler first minute','What if <mark>onboarding</mark> started with one useful thing, instead of a tour? Make the first action feel effortless.','product','Just now'],
      ['Notes from the last test','The <mark>onboarding</mark> checklist felt longer than the first task. Start with the first task.','work','22 Oct'],
      ['A smaller welcome','A shorter <mark>onboarding</mark> flow might make the value clearer. Test the smallest version.','product','Archived · 18 Oct']
    ];
    return `<div class="result-list">${data.map(([title,body,tag,date])=>`<button class="result-row" data-screen="${current.platform==='iphone'?'iphone-editor':current.platform==='web'?'web-editor':'mac-note'}"><h2>${title}</h2><p>${body}</p><span class="result-meta">${badge(tag)}<span>${date}</span></span></button>`).join('')}</div>`;
  }
  function searchContent(screen) {
    const meaning=screen.variant==='meaning',empty=screen.variant==='empty';
    return `<div class="main-top"><div><h1>Find a thought</h1><p class="subtle">Search Notes and Archive in Synkies Cloud</p></div>${btn('New note','mac-capture','primary-button','plus')}</div><div class="search-row">${searchBox(empty?'the moon is made of coffee':meaning?'the idea about making onboarding shorter':'onboarding')}</div><div class="toolbar-line">${segment(meaning)}<button class="text-button" data-screen="mac-tags">${icon('tag')} Tags</button></div>${empty?`<div class="empty-state"><div class="empty-illustration">${icon('search')}</div><h2>No notes found</h2><p>Try fewer words or remove a tag filter.<br>You can also search by meaning.</p>${btn('Try meaning search','search-meaning','primary-button','spark')}<div>${btn('Clear search','mac-library','text-button')}</div></div>`:`<div class="toolbar-line"><span>3 matching notes · Includes Archive</span><span>${meaning?'On-device search':'Words and phrases'}</span></div>${results(meaning)}${meaning?`<p class="subtle" style="margin-top:18px">Matching notes from your collection. Your question stays on this device.</p>`:''}`}`;
  }
  function sticky(screen) {
    const v=screen.variant;
    const error=v==='save-error',limit=v==='limit';
    const body=(v==='capture'?'<div class="capture-placeholder"><span class="text-caret"></span>A thought to keep…</div>':v==='source'?`<pre class="source-body">${esc(sourceText)}</pre>`:noteBody());
    const title=v==='capture'?'Untitled':notes[0].title;
    const width=v==='capture'?360:400,height=v==='capture'?290:error||limit?530:v==='source'?490:450;
    return `<section class="sticky-window desktop-note" data-note-id="${v==='capture'?'capture':'first-minute'}" ${error?'data-save-error="true"':''} ${v==='capture'?'data-empty-draft="true"':''} style="left:${(1100-width)/2}px;top:90px;width:${width}px;height:${height}px" aria-label="Desktop note: ${title}"><div class="sticky-titlebar desktop-note-bar"><button class="desktop-note-close" data-desktop-action="remove" aria-label="Save and close note" title="Save and put away note">${icon('minus')}</button><span class="desktop-note-caption">${title}</span></div><div class="sticky-content">${v==='archived'?'<div class="banner">Archived note <button data-screen="mac-note">Unarchive</button></div>':''}${body}${error?`<div class="banner error" style="margin:20px -10px 0">${icon('alert')}<div><strong>Could not save on this device</strong><br>Your note is still open. Try again or copy your text.</div></div><div class="inline-flex">${btn('Retry','mac-note','secondary-button','refresh')}${btn('Copy text','mac-note','text-button','copy')}</div>`:limit?`<div class="banner error" style="margin:18px -10px 0">${icon('info')}<span>That paste is too long for this note. Your existing text is unchanged.</span></div><div class="subtle">255.8 of 256 KiB · Copy the extra text into a new note.</div>`:''}</div><div class="sticky-footer"><span class="inline-flex"><span class="status-dot ${error?'pending':''}"></span>${error?'Could not save':'Saved on this device'}</span><span class="inline-flex">${icon('device')}On-device · Free</span></div></section>`;
  }
  function noteMenu(phone=false) {
    return `<div class="popover ${phone?'':'note-menu-popover'}">${[
      ['pin','Remove from desktop','mac-library',''],['columns','Keep on top','mac-desktop',''],['list','Markdown source','mac-source',''],['refresh','Sync status',phone?'iphone-peer-devices':'peer-devices',''],['archive','Archive note',phone?'iphone-archive':'mac-archive',''],['download','Export Markdown','transfer-export',''],['notes','Show in library','mac-library','']
    ].filter(x=>!phone||!['pin','columns','list','notes'].includes(x[0])).map(([i,t,s,k])=>`<button data-screen="${s}">${icon(i)}${t}${k?`<kbd>${k}</kbd>`:''}</button>`).join('')}<hr><button class="red" data-screen="${phone?'iphone-trash':'mac-trash'}">${icon('trash')}Move to Trash</button></div>`;
  }
  function dialogMarkup(screen) {
    const v=screen.variant;
    let symbol='info',title='',copy='',content='',actions='';
    switch(v) {
      case 'delete': symbol='trash';title='Delete this note permanently?';copy='“An older draft” will be removed from this collection. This cannot be undone.';content='<div class="info-box">Connected devices remove their copies when they sync. Offline devices and your own backups may still retain older copies.</div>';actions=btn('Cancel','mac-trash')+btn('Delete permanently','mac-trash','danger-button');break;
      case 'destination': symbol='device';title='How should Synkies save your notes?';copy='One mode for your whole library. Both save on this device first.';content=option('On-device · Free','Local copies only. Periodic remote sync with paired devices. Latest edit wins.','device','peer-devices',true)+option('Synkies Cloud · Paid','All notes stored in Cloud. Live sync across connected devices.','cloud','cloud-plan')+'<p class="fine-print">On-device works across networks with encrypted connections and transient relays. Peers need overlapping online time; no server note copy is kept.</p>';actions=btn('Continue On-device','peer-library','primary-button');break;
      case 'cloud-signin': symbol='cloud';title='Welcome back to Synkies';copy='Sign in to your paid Cloud library. Signing in alone does not upload an On-device library.';content='<label for="signin-email">Email</label><input id="signin-email" class="field" value="jamie@example.com" readonly><label for="signin-password">Password</label><input id="signin-password" class="field" type="password" value="preview-password" readonly><div>'+btn('Forgot password?','account-password','text-button')+'</div>';actions=btn('Create account','cloud-signup')+btn('Sign in','cloud-authorizing','primary-button');break;
      case 'cloud-authorizing': symbol='globe';title='Finish signing in';copy='Complete your Synkies sign-in in the system browser. This window will update when you return.';content='<div class="info-box">Waiting for sign-in…<br>You can keep working on local notes.</div>';actions=btn('Cancel','mac-empty')+btn('Return to Synkies','cloud-download','primary-button');break;
      case 'move-cloud': symbol='upload';title='Enable Cloud for your whole library?';copy='All 12 notes, including Archive and recoverable Trash, will be stored in paid Synkies Cloud.';content='<div class="info-box"><strong>On-device → Paid Cloud</strong><br>Keep complete local copies until every cloud write is verified. Paired devices join this library after confirmation.</div><p class="fine-print">A verified paid plan is required. This preview does not purchase a plan or upload real notes.</p>';actions=btn('Stay On-device','peer-library')+btn('Preview activation','cloud-activating','primary-button');break;
      case 'move-local': symbol='device';title='Switch your library to On-device?';copy='Download and verify all notes first, then use free periodic remote device sync.';content='<div class="info-box"><strong>Paid Cloud → On-device</strong><br>12 notes will be verified on this device before the mode changes. Pending edits and offline peers are reconciled safely.</div><p class="fine-print">Subscription cancellation and cloud-data removal are separate actions. Changing mode does not silently delete server copies.</p>';actions=btn('Keep Cloud','cloud-billing')+btn('Verify device copy','cloud-downgrading','primary-button');break;
      case 'sign out': symbol='cloud';title='Sign out of Synkies?';copy='Your notes will stay in Synkies Cloud. Choose what to do with copies on this device.';content=option('Keep downloaded copies','Available offline, without further sync.','device','settings-storage',true)+option('Remove downloaded copies','Only removes copies from this device.','trash','settings-storage')+'<div class="banner error">'+icon('alert')+'<span>2 edits have not synced. Export them before removing downloaded copies.</span></div>';actions=btn('Export unsynced notes','transfer-export')+btn('Keep copies & sign out','mac-library','primary-button');break;
      case 'account': symbol='cloud';title='Change Synkies account';copy='Each account has a separate collection. Your notes will not be copied into the next account.';content=account()+'<div class="info-box"><strong>2 edits are waiting to sync.</strong><br>Reconnect this account to sync them, or export them before continuing.</div>';actions=btn('Export edits','transfer-export')+btn('Reconnect current account','cloud-signin','primary-button');break;
      case 'model-consent': symbol='spark';title='Find the thought, not just the words';copy='Search by meaning runs on this device. Your notes and questions are not sent to an AI service.';content='<div class="info-box"><strong>One-time model download</strong><br>About 85 MB · Works offline after setup<br><small>Download once, then search offline.</small></div><p class="fine-print">Word search is always available. You can remove the model in Settings.</p>';actions=btn('Use word search','search-words')+btn('Download model','model-download','primary-button');break;
      case 'model-download': symbol='download';title='Downloading meaning search';copy='You can keep making notes and searching by words while this finishes.';content='<div class="progress-track" style="--progress:62%"><div class="progress-fill"></div></div><div class="progress-info"><span>53 of 85 MB</span><span>62%</span></div><p class="fine-print">Notes and word search remain available during the download.</p>';actions=btn('Cancel download','model-consent')+`<button class="secondary-button" data-pause>Pause</button>`+btn('Continue to setup','model-indexing','text-button');break;
      case 'model-indexing': symbol='spark';title='Getting your notes ready';copy='Preparing an on-device index so you can find notes by meaning.';content='<div class="progress-track" style="--progress:71%"><div class="progress-fill"></div></div><div class="progress-info"><span>88 of 124 notes indexed</span><span>71%</span></div><p class="fine-print">Word search and quick capture stay available.</p>';actions=btn('Keep using words','search-words')+btn('Search by meaning','search-meaning','primary-button');break;
      case 'model-unavailable': symbol='device';title='Meaning search is unavailable here';copy='This device could not load the search model within its available memory.';content='<div class="info-box">Your notes are unchanged. Word search still works offline. Try meaning search in the Mac or iPhone app.</div>';actions=btn('Search settings','settings-search')+btn('Use word search','search-words','primary-button');break;
      case 'import-results': symbol='check';title='Your notes are imported';copy='The import finished in your On-device library. Paired devices receive the notes at the next sync.';content='<div class="setting-row"><span>Imported</span><strong>18 notes</strong></div><div class="setting-row"><span>Already present, skipped</span><strong>3 notes</strong></div><div class="setting-row"><span>Too large, not imported</span><strong>1 note</strong></div><div class="info-box">“Research notebook.md” is over 256 KiB. The original file has not changed.</div>';actions=btn('View report','transfer-import')+btn('View notes','mac-library','primary-button');break;
      case 'cloud-missing': symbol='cloud';title='Your cloud collection is unavailable';copy='Synkies could not open your cloud collection. Your downloaded notes are still on this device.';content='<div class="info-box">Nothing has been deleted locally. Sign into the same account or export your local copies before choosing a recovery action.</div>';actions=btn('Export local copies','transfer-export')+btn('Resign in to Synkies','cloud-signin','primary-button');break;
      case 'local-missing': symbol='folder';title='Your local folder is unavailable';copy='The selected drive may be disconnected, or this folder’s permissions may have changed.';content='<div class="info-box"><strong>/Volumes/Personal/Synkies</strong><br>Your editor stays open. Reconnect the drive and retry, or copy the text to keep it safe.</div>';actions=btn('Copy unsaved text','save-error')+btn('Retry','mac-note','primary-button');break;
      case 'version': symbol='refresh';title='A newer Synkies version is needed';copy='This collection was updated by a newer version of the app. Its contents have not been changed.';content='<div class="info-box">Update Synkies to keep editing this collection. You can still create a local note in a separate collection.</div>';actions=btn('Create a local note','mac-capture')+btn('Check for updates','settings-general','primary-button');break;
      case 'shortcut': symbol='alert';title='That shortcut is already in use';copy='Control Option N could not be registered. Choose another shortcut for quick capture.';content='<label for="shortcut-preview">Quick capture shortcut</label><input id="shortcut-preview" class="field" value="⌃ ⌥ ⇧ N" readonly><p class="fine-print">New Note in the menu bar still works.</p>';actions=btn('Use menu bar','mac-menu-bar')+btn('Use this shortcut','settings-general','primary-button');break;
      case 'browser-quota': symbol='alert';title='This browser cannot save more data';copy='The latest text has not been saved. Keep this tab open while you copy it or free some space.';content='<div class="info-box">Previously saved notes are still available. Export a backup before clearing browser data.</div>';actions=btn('Export saved notes','transfer-export')+btn('Copy unsaved text','web-editor','primary-button','copy');break;
    }
    return `<section class="dialog" role="dialog" aria-label="${esc(title)}"><div class="dialog-close">${ib('close','Close dialog',screen.platform==='web'?'web-library':'mac-library')}</div><div class="dialog-symbol">${icon(symbol)}</div><h2>${title}</h2><p>${copy}</p>${content}<div class="dialog-actions">${actions}</div></section>`;
  }

  function desktopSettings() {
    return `<section class="settings-section"><h2>Desktop notes</h2>${setting('Restore pinned notes','Open the same desktop notes when Synkies starts.',toggle(true,'Restore pinned notes'))}${setting('Open Notes Library','The library opens separately from floating notes.','<span class="shortcut-key">⌘ ⇧ L</span>')}${setting('Always on top','Choose independently for each note.','<span class="subtle">Per note</span>')}</section><section class="settings-section"><h2>Arrange open notes</h2><p class="subtle">Arrange notes on the active display. Notes on other displays stay where they are.</p>${[['Left','←'],['Right','→'],['Top','↑'],['Bottom','↓']].map(([name,key])=>setting('Arrange '+name.toLowerCase(),'Change this shortcut if it conflicts with another app.','<button class="shortcut-key" data-screen="shortcut-conflict">⌃ ⌥ ⌘ '+key+'</button>')).join('')}${setting('Undo last arrangement','Restore positions without changing text.',btn('Open Window menu','mac-arrange-menu','text-button'))}</section>`;
  }

  function settingsContent(screen) {
    const v=screen.variant, storage=v==='storage'||v==='browser-storage', search=v==='search';
    let html=`<div class="main-top"><div><h1>Settings</h1><p class="subtle">Make a little space that works for you</p></div></div><div class="settings-tabs">${[['general','General'],['desktop','Desktop'],['storage','Storage'],['search','Search'],['export','Import & export']].map(([id,t])=>`<button class="${(v==='desktop'&&id==='desktop')||(storage&&id==='storage')||(search&&id==='search')||(!storage&&!search&&v!=='desktop'&&id==='general')?'selected':''}" data-screen="${id==='export'?'transfer-export':'settings-'+id}">${t}</button>`).join('')}</div>`;
    if(v==='desktop') return html+desktopSettings();
    if(storage) {
      html+=`<section class="settings-section"><h2>Saving mode</h2><p class="subtle">One choice for the complete library, including new notes and imports.</p>${option('On-device · Free','Local note copies, periodic remote peer sync, latest edit wins.','device','peer-devices')}${option('Synkies Cloud · Paid','All notes stored in Cloud, live sync to connected devices.','cloud','cloud-billing',true)}${setting('Change mode','Review the whole-library transition before switching.',btn('Choose mode','storage-destination'))}</section><section class="settings-section"><h2>${v==='browser-storage'?'This browser':'Local copies'}</h2>`;
      if(v==='browser-storage')html+=`${setting('Browser database','A local replica in this browser profile.','<span class="subtle">1.8 MB used</span>')}<div class="banner">${icon('info')}<div><strong>Persistent storage not granted</strong><br>The browser may remove local data under storage pressure. Export important notes.</div></div>${setting('On-device pairing','Remote peer sync needs a trusted paired device.',btn('Pair this browser','web-peer-pair'))}`;
      else html+=`${setting('Local folder','~/Documents/Synkies',btn('Change folder','local-drive-missing'))}${setting('Paired devices','Remote sync in On-device mode.',btn('Manage devices','peer-devices'))}`;
      html+=`</section><section class="settings-section"><h2>Paid Cloud</h2>${account()}${setting('Cloud status','Live · All notes in this library sync.',btn('Plan & billing','cloud-billing','text-button'))}${setting('Sign out','Keep or remove downloaded copies.',btn('Sign out','signout-cloud','text-button'))}${setting('Delete account','Separate from canceling a plan. Export first.',btn('Delete account','account-delete','text-button'))}</section>`;
    } else if(search) {
      html+=`<section class="settings-section"><h2>Search by meaning</h2>${setting('On-device meaning search','Find notes even when you remember different words.',toggle(true,'Meaning search'))}<div class="info-box">${icon('lock')} Your notes and questions stay on this device during search.</div>${setting('Search model','Downloaded · 85 MB',btn('Remove model','model-consent','text-button'))}${setting('Note index','124 notes ready for meaning search.',btn('Rebuild index','model-indexing','text-button'))}</section><section class="settings-section"><h2>Word search</h2>${setting('Include archived notes','Trash is always excluded from ordinary search.',toggle(true,'Include archived notes'))}${setting('Word search stays available','No account, model download, or internet needed.','<span class="subtle">Ready</span>')}</section>`;
    } else html+=`<section class="settings-section"><h2>Quick capture</h2>${setting('Global shortcut','Create a note from anywhere while Synkies is running.','<button class="shortcut-key" data-screen="shortcut-conflict">⌃ ⌥ N</button>')}${setting('Launch Synkies at login','Keep quick capture close at hand.',toggle(true,'Launch at login'))}${setting('Keep Synkies in the menu bar','Closing the last note keeps quick capture available.',toggle(true,'Keep in menu bar'))}</section><section class="settings-section"><h2>Appearance</h2>${setting('Theme','Follow your Mac or choose a preference.','<select aria-label="Theme" data-product-theme><option>System</option><option>Light</option><option>Dark</option></select>')}${setting('Reduced motion','Use the system accessibility preference.','<span class="subtle">System</span>')}</section><section class="settings-section"><h2>About</h2><div class="subtle">Synkies · A place for the thoughts you want to keep.</div></section>`;
    return html;
  }
  function transferContent(screen) {
    const importing=screen.variant==='import';
    return `<div class="main-top"><div><h1>Import & export</h1><p class="subtle">Your notes should always be yours to take</p></div></div><div class="settings-tabs"><button data-screen="settings-general">General</button><button data-screen="settings-storage">Storage</button><button data-screen="settings-search">Search</button><button class="selected">Import & export</button></div>${importing?`<section class="settings-section"><h2>Bring your notes into Synkies</h2><p class="subtle">Import Markdown and the Synkies metadata manifest. Known revisions are skipped.</p><div class="info-box"><strong>Current mode: On-device · Free</strong><br>Imported notes stay on devices and sync with trusted peers. In Cloud mode, imports upload to the Cloud library.</div><div class="drop-zone">${icon('upload')}<p>Drop your Synkies export here</p><span class="subtle">or choose files from your device</span><div style="margin-top:16px">${btn('Choose files','transfer-results','primary-button')}</div></div><p class="subtle" style="margin-top:16px">Oversized notes are reported. No source file is changed.</p></section>`:`<section class="settings-section"><div class="transfer-box">${icon('download')}<div><h3>Export your library</h3><p>Markdown and a metadata manifest preserve text, tags, timestamps and archive state.</p><div class="info-box">Current library · 12 notes · Includes Archive</div><label class="subtle"><input type="checkbox"> Include Trash</label><div style="margin-top:17px">${btn('Export Markdown','transfer-export','primary-button','download')}</div></div></div><div class="transfer-box">${icon('upload')}<div><h3>Import notes</h3><p>Import into your current library. Review its mode and sync behavior first.</p>${btn('Choose an export','transfer-import')}</div></div></section>`}`;
  }
  const versionPanel=(remote=false,mobile=false)=>`<section class="version-panel"><div class="version-label"><span class="inline-flex">${icon(remote?'phone':'device')}${remote?'Cloud version · iPhone':'Your draft · This Mac'}</span><span>${remote?'9:38':'9:41'}</span></div><div class="version-body"><h2>A simpler first minute</h2><p>What if onboarding started with <strong>one useful thing</strong>, instead of a tour?</p><p class="change">${remote?'Ask people what they want to do first. Then start there.':'Remove the introduction. Let the first action show the value.'}</p></div>${mobile?'':`<div class="version-actions">${btn(remote?'Use cloud version':'Keep this draft','mac-note','secondary-button')}</div>`}</section>`;
  function conflictContent(screen) {
    const merge=screen.variant==='merge';
    return `<div class="main-top"><div><h1>${merge?'Combine your versions':'Two versions, both kept'}</h1><p class="subtle">A simpler first minute · Synkies Cloud</p></div>${ib('close','Review later','mac-library')}</div><div class="banner">${icon('columns')}<span>${merge?'Review the combined text before saving. Another remote change will be shown again.':'This Cloud note changed on two offline devices. Paid Cloud offline conflict: your draft stays on this Mac until resolution. On-device sync uses the latest edit automatically.'}</span></div>${merge?`<div class="toolbar-line"><span>Combined note</span><span>Original versions stay available until resolution</span></div><textarea aria-label="Combined note" class="merge-area" readonly># A simpler first minute\n\nWhat if onboarding started with **one useful thing**, instead of a tour?\n\nRemove the introduction. Let the first action show the value.\nAsk people what they want to do first. Then start there.\n\n##product ##work</textarea><div class="conflict-actions">${btn('Back to versions','conflict-compare')}${btn('Save combined note','mac-note','primary-button')}</div>`:`<div class="conflict-layout">${versionPanel()}${versionPanel(true)}</div><div class="conflict-actions">${btn('Export draft','transfer-export','text-button')}${btn('Keep as separate notes','mac-library')}${btn('Combine versions','conflict-merge','primary-button')}</div>`}`;
  }
  function webEditor(screen) {
    return shell(screen,`<div class="editor-tools"><button class="editor-back" data-screen="web-library">${icon('back')}Notes</button><div class="inline-flex">${ib('archive','Archive note','mac-archive')}${ib('more','Note actions','mac-note-menu')}</div></div><section class="inline-editor"><div class="sticky-content">${noteBody()}</div>${formatBar()}<div class="sticky-footer"><span class="inline-flex"><span class="status-dot"></span>Saved on this device</span><button data-screen="storage-destination">${screen.variant==='local'?'On-device · Free':'Synkies Cloud · Paid · Live'}</button></div></section>`);
  }
  const keyboard=()=>`<div class="keyboard" aria-label="On-screen keyboard illustration"><div class="key-row">${'qwertyuiop'.split('').map(x=>`<span>${x}</span>`).join('')}</div><div class="key-row">${'asdfghjkl'.split('').map(x=>`<span>${x}</span>`).join('')}</div><div class="key-row"><span class="key-wide">⇧</span>${'zxcvbnm'.split('').map(x=>`<span>${x}</span>`).join('')}<span class="key-wide">⌫</span></div><div class="key-row"><span class="key-wide">123</span><span class="space">space</span><span class="return">return</span></div></div>`;
  function phoneLibrary(variant='library',android=false) {
    return `<div class="phone-scroll">${android?'<div class="mobile-address">'+icon('lock')+'synkies.example'+icon('more')+'</div>':''}<div class="phone-nav"><button class="phone-collection" data-screen="iphone-collections">${icon(variant==='peer-library'?'device':'cloud')}${variant==='peer-library'?'On-device · Free':'Cloud · Paid · Live'} ${icon('chevron')}</button>${ib('settings','Settings','iphone-settings')}</div><div class="phone-heading"><h1>${variant==='trash'?'Trash':variant==='archive'?'Archive':'Notes'}</h1><span class="subtle">${variant==='trash'?'2 notes':'12 notes'}</span></div>${variant==='trash'?`<div class="banner phone-banner">${icon('info')}<span>Restore deleted notes within 30 days.</span></div>${[['An older draft','28 days left'],['A thought to let go','18 days left']].map(([t,d])=>`<div class="setting-row" style="margin:0 21px"><div class="setting-copy"><strong>${t}</strong><small>${d}</small></div>${btn('Restore','iphone-library')}</div>`).join('')}`:`<div class="phone-search">${searchBox('','iphone-search','Search notes')}</div><div class="phone-note-grid">${(variant==='archive'?[notes[3],notes[4],notes[8]]:notes.slice(0,6)).map((n,i)=>card(n,i,'phone')).join('')}</div>`}</div>${phoneBottom(variant==='trash'?'trash':'notes')}`;
  }
  function phoneBottom(active='notes') {
    return `<div class="phone-bottom"><button class="${active==='notes'?'is-active':''}" data-screen="iphone-library">${icon('notes')}Notes</button><button class="${active==='search'?'is-active':''}" data-screen="iphone-search">${icon('search')}Search</button><button class="add-note" aria-label="New note" data-screen="iphone-capture">${icon('plus')}</button><button data-screen="iphone-tags">${icon('tag')}Tags</button><button class="${active==='trash'?'is-active':''}" data-screen="iphone-more">${icon('archive')}More</button></div>`;
  }
  function phoneEditor(variant='editor') {
    const capture=variant==='capture';
    return `<div class="phone-nav"><button class="text-button" data-screen="iphone-library">Done</button><span class="phone-small-title">${capture?'New note':'Cloud · Paid'}</span>${ib('more','Note actions','iphone-actions')}</div><div class="sticky-content">${capture?'<div class="capture-placeholder"><span class="text-caret"></span>A thought to keep…</div>':variant==='source'?`<pre class="source-body">${esc(sourceText)}</pre>`:noteBody()}</div>${formatBar(true)}<div class="sticky-footer"><span class="inline-flex"><span class="status-dot"></span>Saved on this device</span><button data-screen="iphone-collections">${capture?'On-device · Free':'Live · Synced'}</button></div>${capture?keyboard():''}`;
  }
  function phoneSettings() {
    return `<div class="phone-scroll"><div class="phone-nav"><button class="text-button" data-screen="iphone-library">${icon('back')}Notes</button><span class="phone-small-title">Settings</span><span style="width:35px"></span></div><div class="phone-heading"><h1>Settings</h1></div><div class="phone-settings"><section class="settings-section"><h2>SYNKIES ACCOUNT</h2>${account()}${setting('Cloud status','All changes synced.','<span class="status-dot"></span>')}${setting('Sign out','Keep or remove downloaded copies.',ib('forward','Sign out','signout-cloud'))}</section><section class="settings-section"><h2>YOUR NOTES</h2>${setting('Saving mode','Paid Cloud · Live',ib('forward','Change saving mode','iphone-collections'))}${setting('On-device peers','Free remote periodic sync.',ib('forward','Your devices','iphone-peer-devices'))}${setting('Search by meaning','Downloaded and ready.',toggle(true,'Meaning search'))}${setting('Include archived notes','In words and meaning search.',toggle(true,'Include Archive'))}</section><section class="settings-section"><h2>PORTABLE COPIES</h2>${setting('Import & export','Markdown and metadata.',ib('forward','Import and export','transfer-export'))}${setting('Trash','2 notes · 30-day recovery.',ib('forward','Open Trash','iphone-trash'))}</section></div></div>`;
  }
  function phoneScreen(screen) {
    const v=screen.variant;
    const editor=['editor','capture','source','actions','move'].includes(v),android=screen.platform==='android';
    let content='';
    if(editor) content=phoneEditor(v==='capture'?'capture':v==='source'?'source':'editor');
    else if(v==='settings') content=phoneSettings();
    else if(v==='search'||v==='meaning') content=`<div class="phone-scroll"><div class="phone-nav"><button class="text-button" data-screen="iphone-library">${icon('back')}Notes</button>${ib('settings','Search settings','settings-search')}</div><div class="phone-heading"><h1>Find a thought</h1></div><div class="phone-search">${searchBox(v==='meaning'?'the idea about making onboarding shorter':'onboarding','iphone-search')}</div><div class="phone-results">${segment(v==='meaning')}<div class="subtle" style="margin-bottom:15px">3 matching notes · Includes Archive</div>${results(v==='meaning')}</div></div>${phoneBottom('search')}`;
    else if(v==='conflict') content=`<div class="phone-scroll"><div class="phone-nav"><button class="text-button" data-screen="iphone-library">Later</button><span class="phone-small-title">Resolve conflict</span><span></span></div><div class="phone-heading"><h1 style="font-size:27px">Both versions kept</h1></div><div class="phone-conflict"><p class="subtle">Your draft is on this iPhone until you resolve the conflict.</p>${versionPanel(false,true)}${versionPanel(true,true)}${btn('Combine versions','conflict-merge','primary-button')}${btn('Keep separate notes','iphone-library','secondary-button')}</div></div>`;
    else content=phoneLibrary(v,android);
    let sheet='';
    if(v==='more') sheet=`<h2>Your library</h2>${option('Archive','Notes kept out of the way, still searchable.','archive','iphone-archive')}${option('Trash','Restore notes within 30 days.','trash','iphone-trash')}${option('Settings','Storage, search, and your account.','settings','iphone-settings')}`;
    if(v==='tags') sheet=`<h2>Filter by tags</h2><p>Show notes that contain all selected tags.</p>${['work','product','ideas','life','reading'].map((t,i)=>`<button class="tag-selection" data-check-tag><span>##${t}</span><span>${i<2?icon('check'):''}</span></button>`).join('')}${btn('Show 2 notes','iphone-library','primary-button')}`;
    if(v==='collections') sheet=`<h2>Saving mode</h2><p>One mode for all your notes.</p>${option('On-device · Free','Periodic remote sync. Notes stay on paired devices.','phone','iphone-peer-devices')}${option('Synkies Cloud · Paid','Complete cloud library with live device sync.','cloud','cloud-plan',true)}<p class="fine-print">Enabling Cloud asks to upload the whole library. Signing in alone does not upload it.</p>`;
    if(v==='actions') sheet=`<h2>A simpler first minute</h2><p>Synkies Cloud · Paid · Live</p>${noteMenu(true)}`;
    if(v==='move') sheet=`<div class="dialog-symbol">${icon('phone')}</div><h2>Switch to On-device?</h2><p>This applies to all notes. Download and verify your complete library first.</p><div class="info-box">Free periodic remote sync replaces live Cloud. Subscription cancellation and cloud-data removal are separate.</div>${btn('Verify device copy','iphone-peer-devices','primary-button')}${btn('Keep Cloud','iphone-editor','secondary-button')}`;
    return `<section class="product phone-product ${editor?'phone-editor':''} ${v==='capture'?'with-keyboard':''} ${android?'android-product':''}" aria-label="${android?'Android browser':'iPhone'} mockup"><div class="phone-inner"><div class="phone-status"><span>9:41</span>${android?'':'<div class="dynamic-island"></div>'}<div class="phone-status-right">${icon('signal')}${icon('wifi')}${icon('battery')}</div></div>${content}${sheet?`<div class="phone-overlay"><section class="phone-sheet" role="dialog" aria-label="${screen.title}"><div class="sheet-grip"></div>${sheet}</section></div>`:''}<div class="home-indicator"></div></div></section>`;
  }

  add('cloud-signup','Create a Synkies account','Account','auth','An account is needed for paid Cloud. Signing in alone does not activate Cloud or upload the On-device library.','FR-04 · FR-14','web','signup');
  add('account-verify','Verify email','Account','auth','Email verification protects the cloud account.','FR-14','web','verify');
  add('account-password','Reset password','Account','auth','Recover access without changing local notes.','FR-14','web','password');
  add('account-delete','Delete Synkies account','Account','auth','Account deletion requires an explicit confirmation and explains retention.','FR-07 · FR-14','web','delete-account');
  add('account-deleting','Account deletion status','Account','auth','A clear status distinguishes signing out from deleting server data.','FR-14','web','deleting');
  function authContent(screen) {
    const v=screen.variant;
    let title='',intro='',fields='',actions='';
    if(v==='signup'){title='Make a little room in the cloud';intro='Create an account for paid Cloud: a stored library and live sync across devices.';fields='<label for="auth-email">Email</label><input class="field" id="auth-email" value="jamie@example.com" readonly><label for="auth-password">Password</label><input class="field" id="auth-password" type="password" value="preview-password" readonly><p class="fine-print">Signing in alone does not upload an On-device library. Activating a paid plan includes a whole-library review.</p>';actions=btn('Create account','account-verify','primary-button')+btn('I already have an account','cloud-signin','text-button');}
    if(v==='verify'){title='Check your email';intro='Enter the verification code sent to jamie@example.com.';fields='<label for="verify-code">Verification code</label><input class="field" id="verify-code" value="124 860" readonly><p class="fine-print">Check your spam folder if the email has not arrived.</p>';actions=btn('Verify email','cloud-plan','primary-button')+btn('Send a new code','account-verify','text-button');}
    if(v==='password'){title='Let’s get you back in';intro='Enter your account email to request a password reset code.';fields='<label for="reset-email">Email</label><input class="field" id="reset-email" value="jamie@example.com" readonly>';actions=btn('Send reset code','account-reset-code','primary-button')+btn('Back to sign in','cloud-signin','text-button');}
    if(v==='reset-code'){title='Choose a new password';intro='Enter the reset code from your email, then set a new password.';fields='<label for="reset-code">Reset code</label><input class="field" id="reset-code" value="124860" readonly><label for="new-password">New password</label><input class="field" id="new-password" type="password" value="preview-password" readonly>';actions=btn('Update password','cloud-signin','primary-button');}
    if(v==='delete-account'){title='Delete your Synkies account?';intro='Your live cloud notes and account will be removed. Export anything you want to keep first.';fields='<div class="info-box">Offline devices and your exports can retain copies. Service backups expire within the published backup retention period.</div><label for="delete-confirm">Type DELETE to confirm</label><input class="field" id="delete-confirm" value="DELETE" readonly>';actions=btn('Export cloud notes','transfer-export')+btn('Delete account','account-deleting','danger-button');}
    if(v==='deleting'){title='Your deletion request is in progress';intro='Cloud access is stopped while Synkies removes your account and live cloud notes.';fields='<div class="info-box"><strong>Request received</strong><br>We will confirm completion by email. Your On-device peer library is unaffected.</div>';actions=btn('Continue locally','mac-empty','primary-button');}
    return shell({...screen,variant:'welcome'},libraryContent({...screen,variant:'welcome'}),`<section class="dialog" role="dialog" aria-label="${title}"><div class="dialog-symbol">${icon('lock')}</div><h2>${title}</h2><p>${intro}</p>${fields}<div class="dialog-actions">${actions}</div></section>`);
  }
  add('account-reset-code','Choose new password','Account','auth','Complete password recovery with a reset code.','FR-14','web','reset-code');

  add('iphone-meaning','iPhone meaning search','iPhone','phone','Meaning search retrieves source notes, using the local index.','FR-06 · FR-14','iphone','meaning');
  add('iphone-more','iPhone library menu','iPhone','phone','Archive, Trash, and Settings stay easy to reach.','FR-07','iphone','more');
  add('iphone-archive','iPhone Archive','iPhone','phone','Archived notes remain available on the phone.','FR-07','iphone','archive');

  add('mac-archived-note','Archived note editor','Library','floating','Archived notes remain editable and can be unarchived.','FR-07','mac','archived');
  add('web-local-editor','Browser local note','Browser','web-editor','A local browser note needs no account and never uploads implicitly.','FR-02 · FR-03','web','local');

  add('mac-library-desktop','Notes Library and desktop','Mac desktop','desktop','Open the full Notes Library while pinned notes remain on the desktop. Drag a card outside the library window to pin it.','FR-11 · FR-15','mac','library');
  add('mac-library-drag','Drag a note onto the desktop','Mac desktop','desktop','A drag preview shows where the same note will be pinned. Its library mode stays unchanged.','FR-15','mac','drag');
  add('mac-library-pinned','Pinned from the library','Mac desktop','desktop','The note stays in the library with an On desktop indicator. Both views share one identity.','FR-11 · FR-15','mac','pinned');
  add('mac-library-context','Right-click to pin','Mac desktop','desktop','Right-click a library card for Pin to desktop. Already open notes offer Bring to front or Remove from desktop.','FR-15','mac','context');
  add('mac-arrange-menu','Arrange open notes menu','Mac desktop','desktop','Window offers four edge arrangements, configurable shortcuts, and Undo last arrangement.','FR-16','mac','arrange-menu');
  add('mac-arrange-left','Arrange notes left','Mac desktop','desktop','Control Option Command Left arrow arranges open notes at the left edge of the active display.','FR-16','mac','left');
  add('mac-arrange-right','Arrange notes right','Mac desktop','desktop','Control Option Command Right arrow arranges open notes at the right edge.','FR-16','mac','right');
  add('mac-arrange-top','Arrange notes top','Mac desktop','desktop','Control Option Command Up arrow arranges open notes along the top.','FR-16','mac','top');
  add('mac-arrange-bottom','Arrange notes bottom','Mac desktop','desktop','Control Option Command Down arrow arranges open notes along the bottom.','FR-16','mac','bottom');
  add('settings-desktop','Desktop and shortcuts','Settings','settings','Pinning, always-on-top behavior, library access, and configurable edge arrangement shortcuts.','FR-11 · FR-15 · FR-16','mac','desktop');

  add('mac-library-closed','Library closed, notes visible','Mac desktop','desktop','The Notes Library is closed. The independent note window remains visible on the macOS desktop, with one Save and close control.','FR-02 · FR-11','mac','library-closed');

  for (const entry of window.PeelModes.entries) add(...entry);

  // Single screen renderer, shared only for visual consistency, not product behavior.
  let current=entries.find(x=>x.id==='mac-desktop');
  function render(screen) {
    current=screen;
    if(['desktop','floating'].includes(screen.kind)) return desktopScenes.render(screen);
    const modeHelpers={icon,btn,option,setting,banner,shell,libraryContent,phoneLibrary,phoneBottom};
    if(screen.kind==='mode') return window.PeelModes.render(screen,modeHelpers);
    if(screen.kind==='mode-phone') return window.PeelModes.renderPhone(screen,modeHelpers);
    if(screen.kind==='phone') return phoneScreen(screen);
    if(screen.kind==='web-editor') return webEditor(screen);
    if(screen.kind==='settings') return shell(screen,settingsContent(screen));
    if(screen.kind==='transfer') return shell(screen,transferContent(screen));
    if(screen.kind==='search') return shell(screen,searchContent(screen));
    if(screen.kind==='conflict') return shell(screen,conflictContent(screen));
    if(screen.kind==='auth') return authContent(screen);
    return shell(screen,libraryContent(screen),screen.kind==='dialog'?dialogMarkup(screen):'');
  }
  const root=document.getElementById('artboard');
  const params=new URLSearchParams(location.search);
  if(params.get('capture')==='1') document.body.classList.add('capture');
  if(params.get('theme')==='dark') document.body.dataset.theme='dark';
  const platformNames={mac:'macOS',iphone:'iPhone',web:'Browser',android:'Android browser'};
  function show(id,changeHash=true) {
    const s=entries.find(x=>x.id===id)||entries.find(x=>x.id==='mac-library');
    root.className=['phone','mode-phone'].includes(s.kind)?'mobile-artboard':'';
    root.innerHTML=render(s);
    desktopScenes.wire(root,s);
    document.getElementById('screen-title').textContent=s.title;
    document.getElementById('screen-platform').textContent=platformNames[s.platform];
    document.getElementById('screen-description').textContent=s.description;
    document.getElementById('screen-requirements').textContent=s.requirements;
    document.querySelectorAll('.nav-group button').forEach(b=>b.classList.toggle('active',b.dataset.screen===s.id));
    if(changeHash) history.replaceState(null,'','#'+s.id);
    document.title=`${s.title} · Synkies mockups`;
    document.dispatchEvent(new CustomEvent('peel-screen-ready',{detail:s.id}));
  }
  const groups=[...new Set(entries.map(s=>s.group))];
  document.getElementById('screen-nav').innerHTML=groups.map(g=>`<section class="nav-group"><h2>${g}</h2>${entries.filter(s=>s.group===g).map(s=>`<button data-screen="${s.id}">${s.title}</button>`).join('')}</section>`).join('');
  document.getElementById('screen-count').textContent=`${entries.length} screens · Mockups only`;
  document.addEventListener('click',event=>{
    const route=event.target.closest('[data-screen]');
    if(route) {show(route.dataset.screen);return;}
    const toggleButton=event.target.closest('[data-toggle]');
    if(toggleButton){const on=toggleButton.classList.toggle('on');toggleButton.setAttribute('aria-checked',String(on));}
    const pause=event.target.closest('[data-pause]');
    if(pause) pause.textContent=pause.textContent==='Pause'?'Resume':'Pause';
    const tag=event.target.closest('[data-check-tag]');
    if(tag) tag.lastElementChild.innerHTML=tag.lastElementChild.innerHTML?'':icon('check');
  });
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented)return;
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)){
      if(event.key==='Enter'&&event.target.dataset.searchTarget) show(event.target.dataset.searchTarget);
      return;
    }
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      const at=entries.findIndex(s=>s.id===current.id),delta=event.key==='ArrowLeft'?-1:1;
      show(entries[(at+delta+entries.length)%entries.length].id);
    }
    if(event.key==='Escape'&&['dialog','auth'].includes(current.kind)) show('mac-library');
  });
  document.getElementById('appearance').addEventListener('click',()=>{
    const dark=document.body.dataset.theme!=='dark';document.body.dataset.theme=dark?'dark':'light';
    document.getElementById('appearance').textContent=dark?'Light appearance':'Dark appearance';
  });
  document.getElementById('previous').addEventListener('click',()=>{const at=entries.findIndex(s=>s.id===current.id);show(entries[(at-1+entries.length)%entries.length].id);});
  document.getElementById('next').addEventListener('click',()=>{const at=entries.findIndex(s=>s.id===current.id);show(entries[(at+1)%entries.length].id);});
  window.addEventListener('hashchange',()=>show(location.hash.slice(1),false));
  window.PEEL_SCREENS=entries;
  window.showPeelScreen=id=>show(id,false);
  show(params.get('screen')||location.hash.slice(1)||'mac-desktop',false);
})();
