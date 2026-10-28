/* Presentation-only desktop interactions inside the mockup artboard. */
window.PeelDesktop = (() => {
  function create({icon, traffic, notes, noteMarkup, navigate}) {
    const ids = ['first-minute','weekend','reminder'];
    const samples = [notes[0],notes[1],{title:'One small reminder',body:'Make a little room for the unexpected.',tags:['ideas']}];
    let controller, stage, previousLayout, dragged, suppressClickUntil = 0, menuNote = 'weekend';
    const action=(label,command,symbol='')=>`<button data-desktop-action="${command}">${symbol?icon(symbol):''}${label}</button>`;
    const sample=id=>samples[ids.indexOf(id)]||samples[0];
    function windowMarkup(id,x,y,w=320,h=310) {
      const n=sample(id);
      return `<section class="desktop-note" data-note-id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" aria-label="Desktop note: ${n.title}"><div class="desktop-note-bar"><button class="desktop-note-close" data-desktop-action="remove" aria-label="Save and close ${n.title}" title="Save and put away note">${icon('minus')}</button><span class="desktop-note-caption">${n.title}</span></div><div class="desktop-note-body"><h2>${n.title}</h2>${n.body?`<p>${n.body}</p>`:''}${n.checks?n.checks.map((text,i)=>`<div class="desktop-check"><span class="check-square ${i===0?'done':''}">${i===0?'✓':''}</span><span class="${i===0?'done-text':''}">${text}</span></div>`).join(''):''}<p class="desktop-tags">${n.tags.map(t=>'##'+t).join(' &nbsp; ')}</p></div><div class="desktop-note-footer"><span class="inline-flex"><span class="status-dot"></span>Saved on this device</span><span class="inline-flex">${icon('device')}On-device · Free</span></div></section>`;
    }
    function libraryMarkup() {
      return `<section class="desktop-library-window" aria-label="Notes Library"><div class="desktop-library-bar">${traffic}<button class="desktop-close-hit" data-desktop-action="close-library" aria-label="Close Notes Library"></button><strong>Notes Library</strong><span>⌘ ⇧ L</span></div><div class="desktop-library-layout"><aside><div class="app-logo"><img class="brand-lockup brand-light" src="brand/logo-light.svg" alt="Synkies"><img class="brand-lockup brand-dark" src="brand/logo-dark.svg" alt="Synkies"></div><button class="desktop-mode" data-screen="storage-destination">On-device · Free</button><button class="selected">${icon('notes')}Notes <small>12</small></button><button data-screen="mac-archive">${icon('archive')}Archive</button><button data-screen="mac-trash">${icon('trash')}Trash</button><hr><span class="subtle">TAGS</span><button data-screen="mac-tags">${icon('tag')}product</button><button data-screen="mac-tags">${icon('tag')}life</button><button class="desktop-library-settings" data-screen="settings-general">${icon('settings')}Settings</button></aside><div class="desktop-library-content"><div class="desktop-library-heading"><div><h1>All your notes</h1><p>12 notes · Pin a note to keep it close</p></div><button class="primary-button" data-screen="mac-capture">${icon('plus')}New note</button></div><div class="search-box">${icon('search')}<span>Search your notes</span><kbd>⌘ K</kbd></div><div class="desktop-library-cards">${samples.map((n,i)=>`<article class="library-drag-card" data-library-note="${ids[i]}" aria-label="${n.title}"><div class="library-card-top"><span class="desktop-drag-grip" aria-hidden="true">⠿</span><button class="desktop-card-actions" data-desktop-action="card-menu" data-for-note="${ids[i]}" aria-label="Actions for ${n.title}">${icon('more')}</button></div><h2>${n.title}</h2><p>${n.body||'Coffee beans, a Saturday table, and a walk somewhere new.'}</p><div class="tag-line">${n.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div><div class="library-desktop-status" data-status-for="${ids[i]}">${i===0?icon('pin')+'On desktop':'Drag out to pin'}</div></article>`).join('')}</div><p class="desktop-library-help">Drag a note out of this window to pin it to your desktop. Or right-click for more options.</p></div></div></section>`;
    }
    function contextMarkup() {
      return `<div class="popover desktop-card-menu" hidden role="menu" aria-label="Note actions"><small data-context-title>Things for the weekend</small>${action('Pin to desktop','pin','pin')}${action('Bring to front','front','notes')}${action('Remove from desktop','unpin','close')}${action('Keep on top','toggle-on-top','columns')}<hr><button data-screen="mac-source">${icon('list')}Markdown source</button><button data-screen="peer-devices">${icon('refresh')}Sync status</button><button data-screen="mac-archive">${icon('archive')}Archive note</button><button data-screen="transfer-export">${icon('download')}Export Markdown</button><button data-screen="mac-library-desktop">${icon('notes')}Show in library</button><hr><button class="red" data-screen="mac-trash">${icon('trash')}Move to Trash</button></div>`;
    }
    function captureMenuMarkup() {
      return `<div class="popover menu-bar-popover desktop-capture-menu" hidden><small>SYNKIES</small><button data-screen="mac-capture" aria-label="New note">${icon('plus')}New note<kbd>⌃ ⌥ N</kbd></button><button data-screen="mac-library-desktop">${icon('notes')}Open Notes Library</button><hr><small>RECENT NOTES</small><button data-screen="mac-note">A simpler first minute</button><button data-screen="mac-note">Things for the weekend</button><hr><button data-screen="settings-general">${icon('settings')}Settings…</button><button data-screen="mac-empty">Quit Synkies</button></div>`;
    }
    function menuMarkup() {
      return `<div class="popover desktop-arrange-menu" hidden><small>ARRANGE OPEN NOTES</small>${[['left','Left','←'],['right','Right','→'],['top','Top','↑'],['bottom','Bottom','↓']].map(([edge,name,key])=>`<button data-desktop-action="arrange-${edge}">${icon('columns')}Arrange ${name.toLowerCase()}<kbd>⌃ ⌥ ⌘ ${key}</kbd></button>`).join('')}<hr>${action('Undo last arrangement','undo','refresh')}<hr><button data-screen="mac-library-desktop">${icon('notes')}Open Notes Library<kbd>⌘ ⇧ L</kbd></button></div>`;
    }
    function render(screen) {
      const v=screen.variant||'free';
      const single=screen.kind==='floating';
      const captureMenu=screen.id==='mac-menu-bar';
      const libraryScene=['library','drag','pinned','context','library-closed'].includes(v);
      const library=libraryScene&&v!=='library-closed';
      const windows=single?noteMarkup(screen):captureMenu?'':libraryScene?windowMarkup(ids[0],760,94,308,245)+(v==='pinned'?windowMarkup(ids[1],768,370,308,250):''):
        windowMarkup(ids[0],88,98,340,320)+windowMarkup(ids[1],470,178,326,310)+windowMarkup(ids[2],722,462,300,200);
      return `<section class="product floating-stage peel-desktop" data-desktop-variant="${v}" aria-label="Synkies desktop mockup"><div class="mac-menu"><strong>Synkies</strong><span>File</span><span>Edit</span><button data-desktop-action="note-menu">Note</button><button data-screen="mac-library-desktop">Notes Library</button><button data-desktop-action="window-menu">Window</button><div class="menu-right"><button data-desktop-action="capture-menu" aria-label="Synkies menu bar"><img class="menu-brand-icon" src="brand/icon.svg" alt=""></button>${icon('wifi')}<span>Mon 26 Oct &nbsp; 9:41</span></div></div>${library?libraryMarkup():''}${windows}${v==='drag'?`<div class="desktop-drop-outline"></div><div class="desktop-drag-label">Release to pin to desktop</div><div class="desktop-ghost-preview">${icon('pin')}Things for the weekend</div>`:''}${v==='pinned'?'<div class="desktop-pin-confirm" role="status">Pinned to desktop · Same note, same storage</div>':''}${contextMarkup()}${menuMarkup()}${captureMenuMarkup()}<div class="mac-os-dock" aria-hidden="true">${['device','globe','folder','note','settings'].map((name,i)=>`<span class="dock-app dock-app-${i}">${name==='note'?'<img class="dock-brand-icon" src="brand/icon.svg" alt="">':icon(name)}</span>`).join('')}</div><div class="desktop-feedback" role="status" hidden></div></section>`;
    }
    function feedback(message) {
      const label=stage?.querySelector('.desktop-feedback');
      if(label){label.textContent=message;label.hidden=false;}
    }
    function bounds(node) {
      const s=stage.getBoundingClientRect(),r=node.getBoundingClientRect();
      return {id:node.dataset.noteId,x:r.left-s.left,y:r.top-s.top,w:r.width,h:r.height};
    }
    function setBounds(node,{x,y,w,h}) {
      Object.assign(node.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px',position:'absolute',margin:'0'});
    }
    function windows() {return [...stage.querySelectorAll('.desktop-note')];}
    function arrange(edge,announce=true) {
      if(!stage)return;
      const list=windows();if(!list.length)return;
      previousLayout=list.map(bounds);
      const width=stage.clientWidth,height=stage.clientHeight,gap=12,margin=18,top=48,bottom=58;
      const vertical=edge==='left'||edge==='right';
      const w=vertical?Math.min(308,width-margin*2):Math.min(328,(width-margin*2-gap*(list.length-1))/list.length);
      const h=vertical?Math.min(245,(height-top-bottom-gap*(list.length-1))/list.length):238;
      list.forEach((node,i)=>{
        setBounds(node,{x:vertical?(edge==='left'?margin:width-margin-w):margin+i*(w+gap),y:vertical?top+i*(h+gap):(edge==='top'?top:height-bottom-h),w,h});
        node.classList.add('desktop-arranged');
      });
      stage.dataset.arranged=edge;
      stage.querySelector('.desktop-arrange-menu').hidden=true;
      if(announce)feedback(`${list.length} open notes arranged ${edge}`);
    }
    function undo() {
      if(!previousLayout){feedback('Move or arrange notes to create a previous layout.');return;}
      for(const old of previousLayout){const node=windows().find(n=>n.dataset.noteId===old.id);if(node){setBounds(node,old);node.classList.remove('desktop-arranged');}}
      previousLayout=null;delete stage.dataset.arranged;feedback('Previous layout restored. Your text is unchanged.');
    }
    function updateIndicators() {
      for(const label of stage.querySelectorAll('[data-status-for]')){
        const open=windows().some(n=>n.dataset.noteId===label.dataset.statusFor);
        label.innerHTML=open?icon('pin')+'On desktop':'Drag out to pin';
      }
    }
    function closeNote(note) {
      if(!note)return;
      if(note.dataset.saveError){note.querySelector('.banner.error')?.setAttribute('role','alert');feedback('Could not save. Your note stays open.');return;}
      const empty=note.dataset.emptyDraft;
      note.remove();updateIndicators();stage.querySelector('.desktop-card-menu').hidden=true;
      feedback(empty?'Empty draft closed.':'Saved and closed. Your note stays in the library.');
    }
    function pin(id,x,y) {
      const existing=windows().find(n=>n.dataset.noteId===id);
      if(existing){existing.style.zIndex=15;feedback('That note is already on the desktop. Brought to front.');return;}
      const w=Math.min(308,stage.clientWidth-32),h=250;
      stage.insertAdjacentHTML('beforeend',windowMarkup(id,Math.max(12,Math.min(x??768,stage.clientWidth-w-16)),Math.max(45,Math.min(y??370,stage.clientHeight-h-60)),w,h));
      updateIndicators();feedback('Pinned to desktop. The same note stays in your library.');
    }
    function openContext(card,x,y) {
      menuNote=card.dataset.libraryNote||card.dataset.noteId;
      const menu=stage.querySelector('.desktop-card-menu'),s=stage.getBoundingClientRect();
      menu.querySelector('[data-context-title]').textContent=card.querySelector('.desktop-note-caption')?.textContent||sample(menuNote).title;
      const open=windows().some(n=>n.dataset.noteId===menuNote);
      menu.querySelector('[data-desktop-action="pin"]').hidden=open;
      menu.querySelector('[data-desktop-action="front"]').hidden=!open||!card.dataset.libraryNote;
      menu.querySelector('[data-desktop-action="unpin"]').hidden=!open;
      menu.querySelector('[data-desktop-action="toggle-on-top"]').hidden=!open;
      menu.hidden=false;
      menu.style.left=Math.max(10,Math.min(x-s.left,stage.clientWidth-menu.offsetWidth-10))+'px';
      menu.style.top=Math.max(40,Math.min(y-s.top,stage.clientHeight-menu.offsetHeight-10))+'px';
    }
    function wire(root,screen) {
      controller?.abort();controller=new AbortController();
      const options={signal:controller.signal};
      stage=root.querySelector('.peel-desktop');
      previousLayout=null;dragged=null;suppressClickUntil=0;
      if(!stage)return;
      const variant=stage.dataset.desktopVariant;
      if(stage.clientWidth<1090){
        const scale=stage.clientWidth/1100;
        for(const node of windows()){
          const b=bounds(node),library=!!stage.querySelector('.desktop-library-window');
          const w=Math.min(b.w,Math.max(210,stage.clientWidth*.34));
          setBounds(node,{...b,w,x:library?stage.clientWidth-w-14:Math.min(b.x*scale,stage.clientWidth-w-10)});
        }
      }
      updateIndicators();
      if(variant==='library-closed')feedback('Notes Library is closed. Your floating note stays on the desktop.');
      if(['left','right','top','bottom'].includes(variant))arrange(variant,false);
      if(variant==='arrange-menu')stage.querySelector('.desktop-arrange-menu').hidden=false;
      if(variant==='context'){
        const c=stage.querySelector('[data-library-note="weekend"]'),r=c.getBoundingClientRect();openContext(c,r.left+65,r.top+70);
      }
      if(screen.id==='mac-note-menu'){
        const note=windows()[0],r=note.getBoundingClientRect();openContext(note,r.right-35,r.top+65);
      }
      if(screen.id==='mac-menu-bar')stage.querySelector('.desktop-capture-menu').hidden=false;
      stage.addEventListener('contextmenu',event=>{
        const card=event.target.closest('[data-library-note],.desktop-note');
        if(card){event.preventDefault();openContext(card,event.clientX,event.clientY);}
      },options);
      stage.addEventListener('click',event=>{
        if(Date.now()<suppressClickUntil){event.preventDefault();event.stopPropagation();return;}
        const target=event.target.closest('[data-desktop-action]');if(!target)return;
        event.stopPropagation();
        const command=target.dataset.desktopAction;
        if(command.startsWith('arrange-'))arrange(command.slice(8));
        else if(command==='undo')undo();
        else if(command==='window-menu'){const m=stage.querySelector('.desktop-arrange-menu');m.hidden=!m.hidden;}
        else if(command==='capture-menu'){const m=stage.querySelector('.desktop-capture-menu');m.hidden=!m.hidden;}
        else if(command==='note-menu'){const note=windows()[0];if(note){const r=note.getBoundingClientRect();openContext(note,r.right-35,r.top+65);}else feedback('Open a note to see its actions.');}
        else if(command==='card-menu'){const card=target.closest('[data-library-note]'),r=target.getBoundingClientRect();openContext(card,r.left,r.bottom);}
        else if(command==='pin'||command==='front'){pin(menuNote);stage.querySelector('.desktop-card-menu').hidden=true;}
        else if(command==='unpin')closeNote(windows().find(n=>n.dataset.noteId===menuNote));
        else if(command==='remove')closeNote(target.closest('.desktop-note'));
        else if(command==='toggle-on-top'){const note=windows().find(n=>n.dataset.noteId===menuNote);const on=note?.classList.toggle('desktop-on-top');stage.querySelector('.desktop-card-menu').hidden=true;feedback(on?'Keep on top enabled. The note is still draggable.':'Keep on top off. The note stays pinned.');}
        else if(command==='close-library'){stage.querySelector('.desktop-library-window')?.remove();feedback('Notes Library closed. Your floating notes stay open.');}
      },options);
      stage.addEventListener('pointerdown',event=>{
        if(event.button!==0||event.target.closest('button,input,textarea,select'))return;
        const bar=event.target.closest('.desktop-note-bar'),card=event.target.closest('[data-library-note]');
        if(!bar&&!card)return;
        const node=bar?.closest('.desktop-note');
        dragged={node,card,id:node?.dataset.noteId||card.dataset.libraryNote,startX:event.clientX,startY:event.clientY,original:node?bounds(node):null,moved:false};
        stage.setPointerCapture(event.pointerId);
        if(node){node.style.zIndex=14;bar.style.cursor='grabbing';}
        event.preventDefault();
      },options);
      stage.addEventListener('pointermove',event=>{
        if(!dragged)return;
        const dx=event.clientX-dragged.startX,dy=event.clientY-dragged.startY;
        if(!dragged.moved&&Math.hypot(dx,dy)<6)return;
        dragged.moved=true;
        if(dragged.node){const o=dragged.original;setBounds(dragged.node,{...o,x:Math.max(6,Math.min(o.x+dx,stage.clientWidth-o.w-6)),y:Math.max(32,Math.min(o.y+dy,stage.clientHeight-o.h-6))});}
        else{
          if(!dragged.ghost){dragged.ghost=document.createElement('div');dragged.ghost.className='desktop-live-ghost';dragged.ghost.textContent=sample(dragged.id).title;stage.append(dragged.ghost);}
          const r=stage.getBoundingClientRect(),lib=stage.querySelector('.desktop-library-window').getBoundingClientRect();
          dragged.ghost.style.left=Math.max(5,Math.min(event.clientX-r.left-80,stage.clientWidth-220))+'px';
          dragged.ghost.style.top=Math.max(35,Math.min(event.clientY-r.top-22,stage.clientHeight-80))+'px';
          const outside=event.clientX<lib.left||event.clientX>lib.right||event.clientY<lib.top||event.clientY>lib.bottom;
          dragged.ghost.classList.toggle('over-desktop',outside);dragged.ghost.dataset.label=outside?'Release to pin to desktop':'Drag outside Notes Library';
        }
      },options);
      stage.addEventListener('pointerup',event=>{
        if(!dragged)return;
        const d=dragged;dragged=null;
        if(d.moved)suppressClickUntil=Date.now()+250;
        if(d.node){d.node.querySelector('.desktop-note-bar').style.cursor='';if(d.moved)feedback('Note moved. Desktop placement stays on this Mac.');}
        else if(d.moved){
          const lib=stage.querySelector('.desktop-library-window').getBoundingClientRect(),r=stage.getBoundingClientRect();
          const outside=event.clientX<lib.left||event.clientX>lib.right||event.clientY<lib.top||event.clientY>lib.bottom;
          const onDesktop=event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top+30&&event.clientY<=r.bottom;
          if(outside&&onDesktop)pin(d.id,event.clientX-r.left-50,event.clientY-r.top-25);else feedback('Pin cancelled. Your note stays in the library.');
        }
        d.ghost?.remove();
      },options);
      document.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&dragged){event.preventDefault();const d=dragged;dragged=null;if(d.node){setBounds(d.node,d.original);d.node.querySelector('.desktop-note-bar').style.cursor='';}d.ghost?.remove();suppressClickUntil=Date.now()+250;feedback('Drag cancelled.');}
        if(event.ctrlKey&&event.altKey&&event.metaKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
          event.preventDefault();event.stopImmediatePropagation();arrange({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'top',ArrowDown:'bottom'}[event.key]);
        }
        if(event.metaKey&&event.shiftKey&&event.key.toLowerCase()==='l'){event.preventDefault();navigate('mac-library-desktop');}
      },{...options,capture:true});
    }
    return {render,wire};
  }
  return {create};
})();
