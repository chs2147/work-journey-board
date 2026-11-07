/* global document, matchMedia, performance, devicePixelRatio, requestAnimationFrame */
(() => {
  const $ = (id) => document.getElementById(id), canvas = $("scene"), ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let option = "A", mode = "galaxy", dynamic = true, enabled = !reduce.matches;
  let phase = 0, last = performance.now(), resumeAt = 0, dragging = false, moved = false, hover = false, yaw = .26, tilt = .59, zoom = 1, px = 0, py = 0, points = [];
  let seed = 44;
  const rand = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
  const colors = ["#7fcbd5", "#9ebda1", "#b4a2d7", "#d6b47f"];
  const names = ["회사", "차세대 정산 시스템", "사내 데이터 대시보드", "신규 입사자 온보딩", "협력사 보안 점검", "정산 배치 현황 분석", "테스트 데이터 이관", "릴리스 체크리스트", "화면 구조 검토"];
  const nodes = Array.from({length:100}, (_,i) => {
    const a = rand() * Math.PI * 2, r = 50 + Math.sqrt(rand()) * 330;
    return { x:i ? Math.cos(a)*r : 0, z:i ? Math.sin(a)*r : 0, y:i ? (rand()-.5)*155 : 0, group:i%4, size:i<5 ? 4 : i<14 ? 2.6 : 1.4, name:names[i] || "" };
  });
  const stars = Array.from({length:145},()=>({x:rand(),y:rand(),r:rand()*.8+.3,a:rand()*.3+.12}));
  const info = {
    A:"추천 · 카메라 좌우 ±2.5°, 상하 ±0.6°의 느린 궤도. 고정된 확대 비율과 선택 노드를 유지합니다.",
    B:"대안 · 회전 없이 공간 전체가 ±5px 부유합니다. 변화를 가장 작게 하면서 살아 있는 느낌을 줍니다.",
    C:"대안 · 약 180초에 한 바퀴 도는 지속 순환. 티저의 전시 효과가 강하고 읽는 위치 변화도 큽니다."
  };
  function controls() {
    $("description").textContent=info[option];
    document.querySelectorAll("[data-option]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.option===option)));
    $("galaxy").setAttribute("aria-pressed",String(mode==="galaxy"));$("focus").setAttribute("aria-pressed",String(mode==="focus"));
    $("dynamic").setAttribute("aria-pressed",String(dynamic));$("static").setAttribute("aria-pressed",String(!dynamic));
    const title=enabled?"자동 움직임 일시정지":"자동 움직임 재생";
    $("motion").disabled=!dynamic||reduce.matches;$("motion").title=reduce.matches?"모션 감소 설정으로 자동 움직임을 쉬고 있습니다":!dynamic?"다이나믹 3D에서 사용할 수 있습니다":title;
    $("motion").setAttribute("aria-label",title);$("motion").setAttribute("aria-pressed",String(enabled));
    $("motion").innerHTML=enabled?'<svg viewBox="0 0 20 20" width="18" height="18"><path d="M7 5v10M13 5v10" stroke="currentColor" stroke-width="1.8"/></svg>':'<svg viewBox="0 0 20 20" width="18" height="18"><path d="m7 4 9 6-9 6z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function frame(now) {
    const dt=Math.min(50,now-last);last=now;
    const play=dynamic&&enabled&&!reduce.matches&&!document.hidden&&!dragging&&!hover&&now>resumeAt;
    if(play) phase+=dt/1000;
    $("status").textContent=!dynamic?"정적 2D":reduce.matches?"모션 감소 적용":!enabled?"자동 움직임 꺼짐":play?"자동 움직임 켜짐":"조작 중 · 자동 움직임 대기";
    const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=Math.min(devicePixelRatio,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    for(const s of stars){ctx.fillStyle=`rgba(173,205,228,${s.a})`;ctx.beginPath();ctx.arc(s.x*w,s.y*h,s.r,0,7);ctx.fill();}
    const a=yaw+(option==="A"?Math.sin(phase/20)*.044:option==="C"?phase*Math.PI/90:0), t=tilt+(option==="A"?Math.sin(phase/24)*.01:0), float=option==="B"?Math.sin(phase/8)*5:0;
    const focus=mode==="focus", origin=focus?nodes[1]:{x:0,y:0,z:0};
    points=nodes.map((n,i)=>{const x=n.x-origin.x,z=n.z-origin.z,y=n.y-origin.y;const rx=x*Math.cos(a)-z*Math.sin(a),rz=x*Math.sin(a)+z*Math.cos(a),ry=y*Math.cos(t)-rz*Math.sin(t),depth=y*Math.sin(t)+rz*Math.cos(t);const scale=1/(1+depth/1400),f=Math.min(w/950,1.2)*zoom*(focus?1.4:1);return{x:w*.50+rx*scale*f,y:h*.50+ry*scale*f+float,scale,i,n};});
    for(let i=1;i<points.length;i++){
      if(focus&&i>25)continue;
      const p=points[i], q=points[focus?1:i<5?0:1+(i*7)%4];
      ctx.strokeStyle=colors[p.n.group];ctx.globalAlpha=focus?.24:i<14?.32:.13;ctx.lineWidth=i<14?.8:.45;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
    }
    points.slice().sort((a,b)=>a.scale-b.scale).forEach(p=>{if(focus&&p.i>25)return;ctx.globalAlpha=focus&&p.i>8?.5:1;ctx.fillStyle=colors[p.n.group];ctx.shadowColor=colors[p.n.group];ctx.shadowBlur=p.i<5?12:3;ctx.beginPath();ctx.arc(p.x,p.y,p.n.size*p.scale,0,7);ctx.fill();ctx.shadowBlur=0;
      if(p.n.name){ctx.globalAlpha=p.i<5?.95:.75;ctx.fillStyle="#bed2dd";ctx.font=`${p.i<5?12:10}px system-ui`;ctx.fillText(p.n.name,p.x+10,p.y+4);}
      if(focus&&p.i===1){ctx.strokeStyle="#9fe8e4";ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,12,0,7);ctx.stroke();}
    });ctx.globalAlpha=1;requestAnimationFrame(frame);
  }
  document.querySelectorAll("[data-option]").forEach(b=>b.onclick=()=>{option=b.dataset.option;phase=0;controls();});
  $("galaxy").onclick=()=>{mode="galaxy";controls();};$("focus").onclick=()=>{mode="focus";controls();};
  $("dynamic").onclick=()=>{dynamic=true;controls();};$("static").onclick=()=>{dynamic=false;controls();};
  $("motion").onclick=()=>{enabled=!enabled;controls();};
  $("filter").onclick=()=>{$("filterPanel").hidden=!$("filterPanel").hidden;};$("detail").onclick=()=>{$("detailPanel").hidden=!$("detailPanel").hidden;};
  canvas.onpointerdown=e=>{dragging=true;moved=false;px=e.clientX;py=e.clientY;canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(dragging){const dx=e.clientX-px,dy=e.clientY-py;moved=moved||Math.abs(dx)+Math.abs(dy)>2;yaw+=dx*.004;tilt=Math.max(-.8,Math.min(1,tilt+dy*.003));px=e.clientX;py=e.clientY;}const r=canvas.getBoundingClientRect();hover=points.some(p=>Math.hypot(p.x-(e.clientX-r.x),p.y-(e.clientY-r.y))<14);};
  const release=()=>{dragging=false;hover=false;resumeAt=performance.now()+3000;};canvas.onpointerup=release;canvas.onpointercancel=release;canvas.onpointerleave=()=>{hover=false;};
  canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(.5,Math.min(2.3,zoom-e.deltaY*.0008));resumeAt=performance.now()+3000;};
  for(const name of ["board","note"]){$(name+"Export").onclick=()=>{const el=$(name+"Menu");el.hidden=!el.hidden;$(name+"Export").setAttribute("aria-expanded",String(!el.hidden));};}
  document.onkeydown=e=>{if(e.key==="Escape"){for(const n of ["board","note"]){$(n+"Menu").hidden=true;$(n+"Export").setAttribute("aria-expanded","false");}}};
  document.addEventListener("visibilitychange",()=>{last=performance.now();});reduce.addEventListener("change",controls);controls();requestAnimationFrame(frame);
})();
