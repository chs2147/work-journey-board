/* global document, matchMedia, devicePixelRatio, requestAnimationFrame, cancelAnimationFrame, performance, clearInterval, setInterval, ResizeObserver, IntersectionObserver */
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !reduced.matches, visible = false, cabiVisible = false, frame = 0, cabiTimer = 0, phase = 0, manual = false;
  const toggle = document.getElementById('pv-motion');
  const canvas = document.getElementById('galaxy'), ctx = canvas.getContext('2d');
  const stage = document.querySelector('.pv-cabi-stage');
  let width = 1, height = 1, angle = .2, tilt = .35, zoom = 1, targetZoom = 1, dragging = false, lastX = 0, lastY = 0, last = 0, time = 0;
  let seed = 27;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const colors = ['#94c7fa','#8cd9c5','#bba5ed','#e0bc8d'];
  const nodes = Array.from({length:140}, (_,i) => {
    if (i === 0) return {x:0,y:0,z:0,group:0,size:7};
    const a = random()*Math.PI*2, r = .12+Math.sqrt(random())*.86;
    return {x:Math.cos(a)*r,y:(random()-.5)*.36,z:Math.sin(a)*r,group:i%4,size:i<18?3.5:1.2+random()*1.5};
  });
  const stars = Array.from({length:180},()=>({x:random(),y:random(),a:.1+random()*.4,r:.3+random()*.8}));
  function resize() {
    const box=canvas.getBoundingClientRect(); width=box.width; height=box.height;
    const dpr=Math.min(devicePixelRatio||1,2); canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();
  }
  function project(n) {
    const x=n.x*Math.cos(angle)-n.z*Math.sin(angle), z=n.x*Math.sin(angle)+n.z*Math.cos(angle);
    const y=n.y*Math.cos(tilt)-z*Math.sin(tilt), depth=n.y*Math.sin(tilt)+z*Math.cos(tilt);
    const scale=1/(1+depth*.3); const radius=Math.min(width*.39,height*.65)*zoom;
    return {x:width/2+x*radius*scale,y:height*.51+y*radius*scale,scale,depth};
  }
  function draw() {
    ctx.clearRect(0,0,width,height);
    stars.forEach(s=>{ctx.globalAlpha=s.a;ctx.fillStyle='#b8d2ec';ctx.beginPath();ctx.arc(s.x*width,s.y*height,s.r,0,Math.PI*2);ctx.fill()});ctx.globalAlpha=1;
    const p=nodes.map(project);
    for(let i=1;i<nodes.length;i++) {
      const parent=i<18?0:1+((i*13)%17),a=p[i],b=p[parent];
      ctx.strokeStyle=colors[nodes[i].group];ctx.globalAlpha=i<18?.32:.12;ctx.lineWidth=i<18?1:.6;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      if(i<18) {const t=(time*.00009+i*.12)%1;ctx.globalAlpha=.6;ctx.fillStyle=colors[nodes[i].group];ctx.beginPath();ctx.arc(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,1.7,0,Math.PI*2);ctx.fill()}
    }
    nodes.map((n,i)=>({n,p:p[i]})).sort((a,b)=>b.p.depth-a.p.depth).forEach(({n,p})=>{
      const r=n.size*p.scale; ctx.globalAlpha=.65+(.3-p.depth*.2);ctx.fillStyle=colors[n.group];
      if(n.size>3){ctx.shadowColor=colors[n.group];ctx.shadowBlur=18}ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    });ctx.globalAlpha=1;
    const center=p[0];ctx.strokeStyle='#90e5dc';ctx.globalAlpha=.25;ctx.lineWidth=1;ctx.beginPath();ctx.arc(center.x,center.y,20+Math.sin(time*.001)*3,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
  }
  function loop(t) {
    frame=0;if(!playing||!visible||document.hidden)return;
    if(t-last>32){const dt=Math.min(t-last,60);last=t;time+=dt;if(!dragging)angle+=dt*.000045;zoom+=(targetZoom-zoom)*.07;draw()}
    frame=requestAnimationFrame(loop);
  }
  function schedule(){if(frame)cancelAnimationFrame(frame);frame=0;if(playing&&visible&&!document.hidden){last=performance.now();frame=requestAnimationFrame(loop)}else{zoom=targetZoom;draw()}}
  function setPhase(n){phase=n;stage.dataset.phase=String(n);document.querySelectorAll('[data-cabi]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.cabi===n)));document.getElementById('cabi-stage-title').textContent=['업무의 자료를 한곳에','노트는 별도 창에서 자유롭게','주간 기록과 업무 맥락을 연결'][n]}
  function timer(){clearInterval(cabiTimer);if(playing&&cabiVisible&&!document.hidden&&!manual)cabiTimer=setInterval(()=>setPhase((phase+1)%3),5000)}
  function sync(){root.dataset.pvMotion=playing?'on':'off';toggle.textContent=playing?'Ⅱ 모션 정지':'▷ 모션 재생';toggle.setAttribute('aria-pressed',String(!playing));schedule();timer()}
  toggle.addEventListener('click',()=>{playing=!playing;manual=false;sync()});
  reduced.addEventListener('change',()=>{playing=!reduced.matches;sync()});
  document.querySelectorAll('[data-cabi]').forEach(b=>b.addEventListener('click',()=>{manual=true;setPhase(+b.dataset.cabi);timer()}));
  document.querySelectorAll('[data-space]').forEach(b=>b.addEventListener('click',()=>{
    const focus=b.dataset.space==='focus';targetZoom=focus?2.25:1;
    document.querySelectorAll('[data-space]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    document.getElementById('space-status').textContent=focus?'초점 · 하나의 업무와 연결된 맥락':'은하 · 전체 연결을 바라봅니다';schedule();
  }));
  const galaxy=document.querySelector('.pv-galaxy');
  galaxy.addEventListener('pointerdown',e=>{if(e.target.closest('button')||e.button!==0)return;dragging=true;lastX=e.clientX;lastY=e.clientY;galaxy.setPointerCapture(e.pointerId)});
  galaxy.addEventListener('pointermove',e=>{if(!dragging)return;angle+=(e.clientX-lastX)*.005;tilt=Math.max(-.8,Math.min(.8,tilt+(e.clientY-lastY)*.003));lastX=e.clientX;lastY=e.clientY;draw()});
  galaxy.addEventListener('lostpointercapture',()=>dragging=false);galaxy.addEventListener('pointerup',()=>dragging=false);galaxy.addEventListener('pointercancel',()=>dragging=false);
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries=>{for(const e of entries){if(e.target===galaxy)visible=e.isIntersecting;else cabiVisible=e.isIntersecting}schedule();timer()},{threshold:.05}).observe(galaxy);
  const cabiObserver=new IntersectionObserver(entries=>{cabiVisible=entries[0].isIntersecting;timer()},{threshold:.1});cabiObserver.observe(stage);
  document.addEventListener('visibilitychange',()=>{schedule();timer()});resize();sync();
})();
