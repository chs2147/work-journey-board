/* global document, window, URL, setTimeout, clearTimeout, requestAnimationFrame, getSelection */
// 설계 시안: 가상 데이터만 사용. 제품 편집기는 ProseMirror transaction으로 구현한다.
(() => {
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const svg = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const items = [
    { id:'a', text:'정산 예외 조건 최종 확인',date:'11.06',due:'D-2',done:false },
    { id:'b', text:'담당자 검토 의견 반영',date:'11.05',due:'D-4',done:false },
    { id:'c', text:'배포 체크리스트 정리',date:'11.03',due:'',done:false },
  ];
  let day = 7, toastTimer, undo = null, activeBlock = null, selection = null, blockDrag = null, ignoreGrip = false, cloneCount = 0, pendingPort = null;
  const world = $('.canvas-world');
  $('#important-rows').dataset.slot = 'important-rows'; $('#important-count').dataset.slot = 'important-count';
  function notice(text, undoAction = null) {
    clearTimeout(toastTimer);$('#toast-text').textContent=text;$('#toast').hidden=false;
    undo=undoAction;$('#toast-undo').hidden=!undoAction;toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);
  }
  function mirror() {
    const row = (it) => `<div class="main-row ${it.done?'done':''}"><button class="complete-toggle" data-complete="${it.id}" aria-label="${it.done?'완료 취소':'완료'}: ${it.text}" title="${it.done?'완료 취소':'완료'}">${svg('check')}</button><span>${it.text}<small>정산 시스템 · ${it.date}</small></span></div>`;
    $('#main-pending').innerHTML=items.filter(i=>!i.done).map(row).join('')+'<div class="main-row"><span>보안 점검 회의 준비<small>다른 업무 · 위젯에는 표시하지 않음</small></span></div>';
    $('#main-done').innerHTML=items.filter(i=>i.done).map(row).join('')||'<p class="hint">아직 완료한 항목이 없습니다.</p>';
  }
  function renderImportant() {
    const open = items.filter(i=>!i.done);
    $$('[data-slot="important-count"]').forEach(n=>n.textContent=open.length);
    $$('[data-slot="important-rows"]').forEach(n=>n.innerHTML=open.map(i=>`<div class="important-row"><button class="complete-toggle" data-complete="${i.id}" aria-label="완료: ${i.text}" title="완료 처리">${svg('check')}</button><div><p>${i.text}</p><div class="item-meta">${i.due?`<span class="due ${i.id==='a'?'soon':''}">${day<({a:9,b:11}[i.id])?'D-'+(({a:9,b:11}[i.id])-day):day===({a:9,b:11}[i.id])?'D-day':'D+'+(day-({a:9,b:11}[i.id]))}</span>`:''}<span>${i.date} 기록</span></div></div></div>`).join('')||'<p class="empty-list">미완료 중요 업무가 없습니다.</p>');
    mirror(); requestAnimationFrame(drawLines);
  }
  function setPanel(name) {
    $('#weekly-panel').hidden=false;$('#weekly-content').hidden=name!=='weekly';$('#mirror-content').hidden=name!=='mirror';
    $$('[data-panel]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.panel===name)));
  }
  function renderElapsed() {
    $$('.elapsed').forEach(object=>{
      const basis=object.dataset.basis||'start', count=basis==='start'?30+day:day-6;
      object.querySelector('.metric').innerHTML=`${count}<small>${basis==='start'?'일 경과':'일 · 마지막 기록 후'}</small>`;
      object.querySelector('.widget-body>p').textContent=basis==='start'?'2026.10.01 시작':'2026.11.06 마지막 기록';
      object.querySelector('.widget-bottom>span').textContent=`11.${String(day).padStart(2,'0')} 기준`;
      object.querySelector('select').value=basis;
    });
    $('#demo-date').textContent=`기준 2026.11.${String(day).padStart(2,'0')}`;
  }
  function showView(name) {
    $('#timeline-view').hidden=name!=='timeline';$('#board-view').hidden=name!=='board';$('#note-view').hidden=name!=='note';$('#board-options').hidden=name!=='board';
    $$('.review [data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));closePopups();requestAnimationFrame(drawLines);
  }
  function closePopups(except) { $$('.popup,.text-tools').forEach(p=>{if(p!==except)p.hidden=true});if(!except)$$('.block').forEach(b=>b.classList.remove('menu-open')); }
  function place(p, anchor, above=false) {
    p.hidden=false;const r=anchor.getBoundingClientRect?anchor.getBoundingClientRect():anchor;
    const w=p.offsetWidth,h=p.offsetHeight;
    p.style.left=Math.max(10,Math.min(window.innerWidth-w-10,r.left))+'px';
    p.style.top=Math.max(10,Math.min(window.innerHeight-h-10,above?r.top-h-9:r.bottom+7))+'px';
  }
  $('#widget-add').addEventListener('click',()=>{const m=$('#widget-menu'),was=m.hidden;closePopups();if(was)place(m,$('#widget-add'));});
  $('#export-toggle').addEventListener('click',()=>{const m=$('#export-menu'),was=m.hidden;closePopups();if(was)place(m,$('#export-toggle'));});
  $('#library-toggle').addEventListener('click',()=>{$('#library').hidden=!$('#library').hidden});$('#library-close').addEventListener('click',()=>$('#library').hidden=true);
  $('#weekly-toggle').addEventListener('click',()=>{$('#weekly-panel').hidden=!$('#weekly-panel').hidden});$('#weekly-close').addEventListener('click',()=>$('#weekly-panel').hidden=true);
  $('#mirror-open').addEventListener('click',()=>setPanel('mirror'));
  $('#tomorrow').addEventListener('click',()=>{if(day<28)day++;renderElapsed();renderImportant();notice('오늘 날짜가 바뀌면 경과일을 다시 계산합니다. (시안)')});
  $('#demo-reset').addEventListener('click',()=>window.location.reload());
  document.addEventListener('change',e=>{if(e.target.matches('.elapsed select')){e.target.closest('.elapsed').dataset.basis=e.target.value;renderElapsed()}});
  $('#density-compare').addEventListener('change',e=>$('.document').classList.toggle('loose',e.target.checked));
  function counter() {const total=$$('.object').length,widgets=$$('.widget').length;$('.canvas-toolbar>div>span').textContent=`객체 ${total}개 · Live Widget ${widgets}개`;}
  function ports(object) {
    if(object.querySelector('.port'))return;
    for(const [side,label] of [['n','위'],['e','오른쪽'],['s','아래'],['w','왼쪽']]){
      const b=document.createElement('button');b.className='port '+side;b.dataset.side=side;b.setAttribute('aria-label',object.dataset.object+' '+label+' 연결점');b.title=label+' 연결점';object.append(b);
    }
  }
  $$('.object').forEach(ports);
  const links=[{from:'source',side:'w',to:'timeline',end:'e'}];
  function point(id,side) {
    const o=world.querySelector(`[data-object="${id}"]`);if(!o)return {x:0,y:0};
    const x=o.offsetLeft,y=o.offsetTop,w=o.offsetWidth,h=o.offsetHeight;
    return {x:x+(side==='w'?0:side==='e'?w:w/2),y:y+(side==='n'?0:side==='s'?h:h/2)};
  }
  function drawLines() {
    $$('#connections>path').forEach(p=>p.remove());
    for(const l of links){const a=point(l.from,l.side),b=point(l.to,l.end);const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',`M${a.x} ${a.y} C${a.x-50} ${a.y} ${b.x+50} ${b.y} ${b.x} ${b.y}`);p.setAttribute('marker-end','url(#arrow)');$('#connections').append(p)}
  }
  function finishPort(target) {
    if(!pendingPort||!target||target.closest('.object')===pendingPort.object)return;
    links.push({from:pendingPort.object.dataset.object,side:pendingPort.side,to:target.closest('.object').dataset.object,end:target.dataset.side||'w'});
    pendingPort.object.classList.remove('connecting');pendingPort=null;drawLines();notice('같은 네 방향 연결점으로 화살표를 이었습니다. (시안)');
  }
  document.addEventListener('pointerdown',e=>{
    const port=e.target.closest('.port');
    if(port){e.preventDefault();e.stopPropagation();if(pendingPort&&port.closest('.object')!==pendingPort.object){finishPort(port);return}pendingPort={object:port.closest('.object'),side:port.dataset.side};pendingPort.object.classList.add('connecting');return;}
    const header=e.target.closest('.object-head');if(!header||e.target.closest('button,select,input')||world.dataset.layout!=='A')return;
    const object=header.closest('.object'), x=e.clientX,y=e.clientY,left=object.offsetLeft,top=object.offsetTop;
    object.classList.add('selected');header.setPointerCapture(e.pointerId);
    const move=ev=>{object.style.left=Math.max(10,Math.min(world.clientWidth-object.offsetWidth-10,left+ev.clientX-x))+'px';object.style.top=Math.max(10,Math.min(650,top+ev.clientY-y))+'px';drawLines()};
    const end=()=>{header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',end);header.removeEventListener('pointercancel',end)};
    header.addEventListener('pointermove',move);header.addEventListener('pointerup',end);header.addEventListener('pointercancel',end);
  });
  document.addEventListener('pointerup',e=>{if(pendingPort)finishPort(e.target.closest('.port'))});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePopups();if(pendingPort)pendingPort.object.classList.remove('connecting');pendingPort=null;$$('.block').forEach(b=>b.classList.remove('drag-target','dragging'));blockDrag=null;}});
  $$('.block').forEach((b,i)=>b.dataset.blockId='b'+i);
  document.addEventListener('dragstart',e=>{const grip=e.target.closest('.block-grip');if(!grip)return;blockDrag=grip.closest('.block');blockDrag.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',blockDrag.dataset.blockId);closePopups()});
  document.addEventListener('dragover',e=>{const b=e.target.closest('.block');if(!blockDrag||!b)return;e.preventDefault();$$('.block').forEach(n=>n.classList.remove('drag-target'));if(b!==blockDrag)b.classList.add('drag-target')});
  document.addEventListener('drop',e=>{const b=e.target.closest('.block');if(!blockDrag||!b)return;e.preventDefault();if(b!==blockDrag){const r=b.getBoundingClientRect();$('#blocks').insertBefore(blockDrag,e.clientY>r.top+r.height/2?b.nextSibling:b)}ignoreGrip=true;setTimeout(()=>ignoreGrip=false,200);$$('.block').forEach(n=>n.classList.remove('dragging','drag-target'));blockDrag=null;notice('블록 순서를 옮겼습니다. (시안)')});
  document.addEventListener('dragend',()=>{$$('.block').forEach(n=>n.classList.remove('dragging','drag-target'));blockDrag=null});
  document.addEventListener('click',e=>{
    const view=e.target.closest('[data-view]');if(view){showView(view.dataset.view);return}
    const layout=e.target.closest('[data-layout]');if(layout&&layout.tagName==='BUTTON'){world.dataset.layout=layout.dataset.layout;$$('.seg button').forEach(b=>b.setAttribute('aria-pressed',String(b===layout)));return}
    const panel=e.target.closest('[data-panel]');if(panel){setPanel(panel.dataset.panel);return}
    const complete=e.target.closest('[data-complete]');if(complete){const it=items.find(i=>i.id===complete.dataset.complete);const before=it.done;it.done=!it.done;renderImportant();setPanel('mirror');notice(it.done?'완료 처리 · 메인 중요 업무에도 반영됨 (시안)':'완료 취소 · 중요 업무에 다시 표시됨 (시안)',()=>{it.done=before;renderImportant();notice('원본 완료 상태를 되돌렸습니다. (시안)')});return}
    const add=e.target.closest('[data-add]');if(add){const type=add.dataset.add,template=world.querySelector('.'+type),clone=template.cloneNode(true);cloneCount++;clone.dataset.object=type+'-'+cloneCount;clone.style.left=90+cloneCount*20+'px';clone.style.top=90+cloneCount*20+'px';clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));clone.classList.add('selected');world.append(clone);renderElapsed();renderImportant();counter();closePopups();notice('새 '+add.querySelector('span').childNodes[0].textContent+' 위젯 배치입니다. 머리를 잡아 옮기세요.');return}
    const grip=e.target.closest('.block-grip');if(grip&&!ignoreGrip){activeBlock=grip.closest('.block');closePopups();activeBlock.classList.add('menu-open');place($('#block-menu'),grip);return}
    const kind=e.target.closest('#block-menu [data-kind]');if(kind&&activeBlock){activeBlock.dataset.kind=kind.dataset.kind;closePopups();return}
    const action=e.target.closest('[data-block-action]');if(action&&activeBlock){const b=activeBlock;if(action.dataset.blockAction==='up'&&b.previousElementSibling)b.parentElement.insertBefore(b,b.previousElementSibling);if(action.dataset.blockAction==='down'&&b.nextElementSibling)b.parentElement.insertBefore(b.nextElementSibling,b);if(action.dataset.blockAction==='copy'){const n=b.cloneNode(true);n.dataset.blockId='copy'+Date.now();n.classList.remove('menu-open');b.after(n)}if(action.dataset.blockAction==='delete')b.remove();closePopups();return}
    const n=e.target.closest('[data-notice]');if(n){notice(n.dataset.notice);closePopups()}
  });
  $('#toast-undo').addEventListener('click',()=>{if(undo)undo()});
  $('#delete-board').addEventListener('click',()=>{$('#delete-dialog p b').textContent=$$('.object').length+'개';$('#delete-input').value='';$('#delete-confirm').disabled=true;$('#delete-dialog').showModal();$('#delete-input').focus()});
  $('#delete-input').addEventListener('input',e=>$('#delete-confirm').disabled=e.target.value.trim()!=='삭제');
  $('#delete-cancel').addEventListener('click',()=>$('#delete-dialog').close());
  $('#delete-confirm').addEventListener('click',()=>{if($('#delete-input').value.trim()!=='삭제')return;$('#delete-dialog').close();$('#board-view .app-header').hidden=true;$('.canvas-toolbar').hidden=true;$('.board-body').hidden=true;$('#deleted-board').hidden=false;notice('보드 배치 삭제 완료 · 원본 자료는 유지됩니다. (시안)')});
  $('#restore-board').addEventListener('click',()=>{$('#deleted-board').hidden=true;$('#board-view .app-header').hidden=false;$('.canvas-toolbar').hidden=false;$('.board-body').hidden=false;drawLines()});
  $('#delete-note-demo').addEventListener('click',()=>{$('#note-document').hidden=true;$('.note-options').hidden=true;$('#deleted-note').hidden=false;closePopups();notice('해당 noteId의 노트 창만 닫히는 상태를 시연합니다.')});
  $('#restore-note').addEventListener('click',()=>{$('#deleted-note').hidden=true;$('#note-document').hidden=false;$('.note-options').hidden=false});
  function saveSelection() {const s=getSelection();if(!s.rangeCount||s.isCollapsed)return;const anchor=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement;if(!anchor.closest('.block-text'))return;selection=s.getRangeAt(0).cloneRange();place($('#text-tools'),selection.getBoundingClientRect(),true)}
  document.addEventListener('mouseup',e=>{if(e.target.closest('.popup,.text-tools'))return;saveSelection()});
  document.addEventListener('keyup',e=>{if(e.target.closest('.block-text'))saveSelection()});
  function restoreSelection(){if(!selection)return false;const s=getSelection();s.removeAllRanges();s.addRange(selection);return true}
  $('#text-tools').addEventListener('mousedown',e=>e.preventDefault());$('#colors').addEventListener('mousedown',e=>e.preventDefault());
  $$('[data-format]').forEach(b=>b.addEventListener('click',()=>{if(restoreSelection())document.execCommand(b.dataset.format,false,null)}));
  $('#color-toggle').addEventListener('click',()=>place($('#colors'),$('#text-tools'),true));
  $$('[data-color]').forEach(b=>b.addEventListener('click',()=>{if(restoreSelection()){const color={default:'#576b4b',gray:'#5f5e5a',orange:'#a8471a',blue:'#1f5fa8',green:'#0f6e46',red:'#b3261e'}[b.dataset.color];document.execCommand('foreColor',false,color)}$('#colors').hidden=true}));
  $('#link-toggle').addEventListener('click',()=>{place($('#link-popup'),$('#text-tools'),true);$('#link-value').focus()});
  $('#link-apply').addEventListener('click',()=>{const value=$('#link-value').value.trim();try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error('scheme');if(restoreSelection())document.execCommand('createLink',false,u.href);closePopups();notice('선택한 텍스트에 링크를 적용했습니다. (시안)')}catch{$('#link-error').textContent='http 또는 https 주소를 입력하세요.'}});
  $('#link-clear').addEventListener('click',()=>{if(restoreSelection())document.execCommand('unlink');closePopups()});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.popup,.text-tools,#widget-add,#export-toggle,.block-grip'))closePopups()});
  // 추가 시안: 같은 가상 업무 기록을 세 가지 표현으로 보여 준다.
  const timelineSources = [
    {id:'m1',date:'2026.10.01',week:'40',label:'업무 착수',text:'정산 흐름 현황과 검토 범위 초안 정리'},
    {id:'m2',date:'2026.10.12',week:'42',label:'범위 확정',text:'예외 조건과 담당자 검토 범위 합의'},
    {id:'m3',date:'2026.10.20',week:'43',label:'연동 방식 합의',text:'관련 API와 업무 간 연동 방식 협의'},
    {id:'m4',date:'2026.10.28',week:'44',label:'설계 검토',text:'설계안 리뷰와 담당자 협의 내용 반영'},
    {id:'m5',date:'2026.11.03',week:'45',label:'계산 검토',text:'수수료 계산 검토 결과 정리'},
    {id:'m6',date:'2026.11.06',week:'45',label:'검증 완료',text:'정산 배치 검증과 예외 조건 확인'},
  ];
  let timelineType='milestones', milestones=new Set(['m1','m2','m4','m6']);
  function openTimelineSource(id) {
    const source=timelineSources.find(s=>s.id===id);if(!source)return;
    $('#milestone-detail-title').textContent=source.date+' · '+source.label;
    $('#milestone-detail-body').textContent=source.text;
    $('#milestone-detail').hidden=false;
  }
  function renderTimeline() {
    $('#timeline-showcase').dataset.variant=timelineType;
    $$('[data-timeline-type]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.timelineType===timelineType)));
    $('#milestone-manage').hidden=timelineType!=='milestones';
    $('#timeline-showcase-title').textContent={records:'업무 타임라인',milestones:'주요 마일스톤',weeks:'주차별 업무 흐름'}[timelineType];
    const body=$('#timeline-variant-body');
    if(timelineType==='records') {
      $('#timeline-scope-label').textContent='최근 8주 · 업무 기록 '+timelineSources.length+'개';
      $('#timeline-type-note').textContent='최신 기록부터 · 상세 내역 확인';
      body.innerHTML='<div class="timeline-record-list">'+[...timelineSources].reverse().map(s=>`<button data-timeline-source="${s.id}"><time>${s.date.slice(5)}</time><div><b>${s.label}</b><p>${s.text}</p></div></button>`).join('')+'</div>';
    } else if(timelineType==='milestones') {
      const chosen=timelineSources.filter(s=>milestones.has(s.id));
      $('#timeline-scope-label').textContent='선택한 업무 기록 '+chosen.length+'개';
      $('#timeline-type-note').textContent='원본 날짜순 · 간격은 균등 배치';
      body.innerHTML=chosen.length?`<div class="milestone-scroll" tabindex="0" aria-label="가로 마일스톤"><div class="milestone-track" style="--milestone-count:${chosen.length}">`+chosen.map((s,i)=>`<button class="milestone-node ${i===chosen.length-1?'latest':''}" data-timeline-source="${s.id}" aria-label="${s.date} ${s.label} 원본 보기"><time class="milestone-date">${s.date.slice(5)}</time><i class="milestone-point"></i><b>${s.label}</b><small>${i===chosen.length-1?'최근 선택 기록':s.week+'주차'}</small></button>`).join('')+'</div></div>':'<p class="timeline-empty">마일스톤으로 보여 줄 기록을 골라 주세요.</p>';
    } else {
      const weeks=[...new Set(timelineSources.map(s=>s.week))];
      $('#timeline-scope-label').textContent='최근 8주 · 기록이 있는 '+weeks.length+'주';
      $('#timeline-type-note').textContent='업무 기록 자동 집계 · 빈 주는 생략';
      body.innerHTML=`<div class="milestone-scroll" tabindex="0" aria-label="가로 주차 요약"><div class="milestone-track week-track" style="--milestone-count:${weeks.length}">`+weeks.map((week,i)=>{const rows=timelineSources.filter(s=>s.week===week),s=rows[rows.length-1];return `<button class="milestone-node ${i===weeks.length-1?'latest':''}" data-timeline-source="${s.id}" aria-label="${week}주차 대표 기록 ${s.label}"><time class="milestone-date">${s.date.slice(5)}</time><i class="milestone-point"></i><b>${week}주차</b><small>${s.label}</small><span class="week-count">기록 ${rows.length}개</span></button>`}).join('')+'</div></div>';
    }
    $('#timeline-asof').textContent='11.'+String(day).padStart(2,'0')+' 기준';
  }
  document.addEventListener('click',e=>{
    const type=e.target.closest('[data-timeline-type]');if(type){timelineType=type.dataset.timelineType;$('#milestone-detail').hidden=true;renderTimeline();return}
    const source=e.target.closest('[data-timeline-source]');if(source)openTimelineSource(source.dataset.timelineSource);
  });
  $('#milestone-detail-close').addEventListener('click',()=>$('#milestone-detail').hidden=true);
  $('#timeline-size').addEventListener('click',e=>{const compact=$('#timeline-showcase').classList.toggle('compact');e.currentTarget.textContent=compact?'넓은 위젯으로 보기':'좁은 위젯으로 보기'});
  $('#milestone-source-demo').addEventListener('click',()=>{const s=timelineSources.find(s=>s.id==='m6');s.label=s.label==='검증 완료'?'검증 결과 확인':'검증 완료';renderTimeline();if(!$('#milestone-detail').hidden)openTimelineSource('m6');notice('선택한 원본의 제목 변경을 반영했습니다. (가상 데이터)')});
  $('#milestone-manage').addEventListener('click',()=>{
    $('#milestone-options').innerHTML=timelineSources.map(s=>`<label><input type="checkbox" value="${s.id}" ${milestones.has(s.id)?'checked':''}><span>${s.label}<small>${s.date} · ${s.week}주차 · ${s.text}</small></span></label>`).join('');
    $('#milestone-dialog').showModal();
  });
  $('#milestone-cancel').addEventListener('click',()=>$('#milestone-dialog').close());
  $('#milestone-apply').addEventListener('click',()=>{milestones=new Set($$('#milestone-options input:checked').map(n=>n.value));$('#milestone-dialog').close();renderTimeline();notice('표시할 마일스톤만 변경했습니다. 원본의 중요·완료 상태는 그대로입니다. (시안)')});
  $('#tomorrow').addEventListener('click',()=>renderTimeline());
  renderTimeline();
  if(window.location.hash==='#timeline')showView('timeline');

  window.addEventListener('resize',()=>{closePopups();drawLines()});renderImportant();renderElapsed();requestAnimationFrame(drawLines);
})();
