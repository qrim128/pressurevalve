/* Standalone room: peer-to-peer over WebRTC using PeerJS (public signaling server). No Claude sign-in needed.
   Each browser claims one of three connection slots for the room code, then dials the other two.
   Exposes the same small API the game uses: join, leave, presence, peers, onPeers, onConnection. */
window.makeRoom=function(){
  var S=null,peerCbs=[],connCbs=[],connected=false,api={full:false};
  function fireP(){peerCbs.forEach(function(f){try{f();}catch(e){}});}
  function setConn(v){if(connected===v)return;connected=v;connCbs.forEach(function(f){try{f(v);}catch(e){}});}
  function pid(code,n){return 'pvalves-'+code.toLowerCase()+'-'+n;}
  function send1(s,rid){
    var a=s.conns[rid]||[];
    for(var i=0;i<a.length;i++){if(a[i].open){try{a[i].send({t:'p',p:s.mine});}catch(e){}break;}}
  }
  function broadcast(s){if(s.mine)Object.keys(s.conns).forEach(function(rid){send1(s,rid);});}
  function hasOpen(s,rid){return (s.conns[rid]||[]).some(function(c){return c.open;});}
  function dialAll(s){
    if(s.dead||!s.peer||!s.id||s.peer.disconnected)return;
    for(var n=1;n<=3;n++){
      var id=pid(s.code,n);
      if(id===s.id||hasOpen(s,id))continue;
      if(s.pending[id]&&Date.now()-s.pending[id]<4000)continue;
      s.pending[id]=Date.now();
      try{wire(s,s.peer.connect(id,{serialization:'json',reliable:true}));}catch(e){}
    }
  }
  function wire(s,c){
    var rid=c.peer;
    c.on('open',function(){
      if(s.dead)return;
      (s.conns[rid]=s.conns[rid]||[]).push(c);
      delete s.pending[rid];
      send1(s,rid);
    });
    c.on('data',function(m){
      if(s.dead||!m||m.t!=='p')return;
      s.pres[rid]=m.p;s.seen[rid]=Date.now();fireP();
    });
    var gone=function(){
      var a=s.conns[rid]||[],i=a.indexOf(c);
      if(i>=0)a.splice(i,1);
      if(!a.length){delete s.conns[rid];delete s.pres[rid];delete s.seen[rid];}
      fireP();
    };
    c.on('close',gone);c.on('error',gone);
  }
  function tickS(s){
    if(s.dead)return;
    var now=Date.now();
    Object.keys(s.seen).forEach(function(rid){
      if(now-s.seen[rid]>6000){
        (s.conns[rid]||[]).slice().forEach(function(c){try{c.close();}catch(e){}});
        delete s.conns[rid];delete s.pres[rid];delete s.seen[rid];fireP();
      }
    });
    dialAll(s);broadcast(s);
  }
  function register(s,n){
    if(s.dead)return;
    if(n>3){api.full=true;setConn(false);fireP();return;}
    var p=new Peer(pid(s.code,n),{debug:0});
    s.peer=p;
    p.on('open',function(id){if(s.dead||s.peer!==p)return;s.id=id;s.slot=n;setConn(true);dialAll(s);fireP();});
    p.on('connection',function(c){if(s.peer===p)wire(s,c);});
    p.on('disconnected',function(){
      if(s.dead||s.peer!==p||p.destroyed)return;
      setConn(false);try{p.reconnect();}catch(e){}
    });
    p.on('error',function(err){
      if(s.dead||s.peer!==p)return;
      if(err.type==='unavailable-id'){try{p.destroy();}catch(e){}register(s,n+1);}
      else if(err.type==='network'||err.type==='server-error'||err.type==='socket-error'||err.type==='socket-closed')setConn(false);
    });
  }
  api.join=function(code){
    api.leave();
    api.full=false;
    var s={code:code,peer:null,id:null,slot:0,conns:{},seen:{},pres:{},pending:{},mine:null,dead:false,timer:0};
    S=s;
    register(s,1);
    s.timer=setInterval(function(){tickS(s);},1500);
  };
  api.leave=function(){
    var s=S;S=null;
    if(!s)return;
    setTimeout(function(){
      s.dead=true;clearInterval(s.timer);
      try{if(s.peer)s.peer.destroy();}catch(e){}
    },300);
    setConn(false);
  };
  api.presence=function(obj){
    if(S){S.mine=obj;broadcast(S);}
    return Promise.resolve();
  };
  api.peers=function(){
    var out=[];
    if(!S)return out;
    if(S.id)out.push({peer:S.id,presence:S.mine,sameTab:true});
    Object.keys(S.conns).forEach(function(rid){
      if(S.pres[rid])out.push({peer:rid,presence:S.pres[rid],sameTab:false});
    });
    return out;
  };
  api.onPeers=function(cb){peerCbs.push(cb);};
  api.onConnection=function(cb){connCbs.push(cb);};
  return api;
};

(function(){
'use strict';

// ===== ENGINE START =====
const RANGE=20, PIPS=4, MAXB=3, TIME=120, HOLD=2, NS=2;
const STAGES=[
  {bandW:3, mags:[1,2],   tMin:4, tMax:16, maxSol:12, minMoves:8,  minInvalid:0.10},
  {bandW:2, mags:[1,2,3], tMin:3, tMax:17, maxSol:5,  minMoves:11, minInvalid:0.22}
];
function hashSeed(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19);}h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return (h^(h>>>16))>>>0;}
function mulberry(a){return function(){a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const seatOf=g=>(g+1)>>1;
function values(P,lv){const v=P.base.slice();for(let i=0;i<6;i++){P.valves[i].fx.forEach(f=>{v[f.g-1]+=f.s*f.m*lv[i];});}return v;}
function burstOf(v){for(let i=0;i<6;i++){if(v[i]<0)return{g:i+1,d:-1};if(v[i]>RANGE)return{g:i+1,d:1};}return null;}
function bandFlags(P,v){return v.map((x,i)=>x>=P.band[i].lo&&x<=P.band[i].hi);}
function analyse(P){
  const B=PIPS+1,N=Math.pow(B,6),pw=[1,B,B*B,B*B*B,B*B*B*B,B*B*B*B*B];
  const ok=new Uint8Array(N),isS=new Uint8Array(N),lv=[0,0,0,0,0,0];
  let solved=0,bad=0;
  for(let s=0;s<N;s++){let t=s;for(let i=0;i<6;i++){lv[i]=t%B;t=(t/B)|0;}
    const v=values(P,lv);
    if(burstOf(v)){bad++;continue;}
    ok[s]=1;
    if(bandFlags(P,v).every(Boolean)){isS[s]=1;solved++;}
  }
  const dist=new Int16Array(N).fill(-1);dist[0]=0;const q=[0];let best=-1;
  for(let h=0;h<q.length;h++){
    const s=q[h];
    if(best<0&&isS[s])best=dist[s];
    for(let i=0;i<6;i++){
      const d=((s/pw[i])|0)%B;
      if(d<PIPS){const n=s+pw[i];if(ok[n]&&dist[n]<0){dist[n]=dist[s]+1;q.push(n);}}
      if(d>0){const n=s-pw[i];if(ok[n]&&dist[n]<0){dist[n]=dist[s]+1;q.push(n);}}
    }
  }
  return {solved,invalidRatio:bad/N,minMoves:best};
}
function makePuzzle(seed,stage){
  const cfg=STAGES[stage-1],R=mulberry(hashSeed(seed+'|'+stage));
  const ri=(a,b)=>a+Math.floor(R()*(b-a+1));
  let fallback=null;
  for(let n=0;n<3000;n++){
    const valves=[],cover=[0,0,0,0,0,0,0];
    for(let v=0;v<6;v++){
      const g1=ri(1,6);let g2=ri(1,6);while(g2===g1)g2=ri(1,6);
      const mk=g=>({g:g,m:cfg.mags[ri(0,cfg.mags.length-1)],s:ri(0,1)?1:-1});
      valves.push({fx:[mk(g1),mk(g2)]});
      cover[g1]++;cover[g2]++;
    }
    if(cover.slice(1).some(c=>c===0))continue;
    const sol=[];for(let i=0;i<6;i++)sol.push(ri(0,PIPS));
    if(sol.filter(x=>x===0).length>2)continue;
    if([0,1,2].some(s=>sol[2*s]+sol[2*s+1]<2))continue;
    const delta=[0,0,0,0,0,0];
    valves.forEach((x,i)=>{x.fx.forEach(f=>{delta[f.g-1]+=f.s*f.m*sol[i];});});
    const base=[],band=[];let bad=false;
    for(let g=0;g<6;g++){
      const T=ri(cfg.tMin,cfg.tMax),off=ri(0,cfg.bandW-1),lo=T-off,hi=lo+cfg.bandW-1,b=T-delta[g];
      if(b<1||b>RANGE-1||lo<1||hi>RANGE-1){bad=true;break;}
      base.push(b);band.push({lo:lo,hi:hi});
    }
    if(bad)continue;
    const P={valves:valves,base:base,band:band,sol:sol};
    if(band.filter((bd,i)=>base[i]<bd.lo||base[i]>bd.hi).length<4)continue;
    const a=analyse(P);
    if(a.minMoves<0)continue;
    if(!fallback)fallback=P;
    if(a.solved<1||a.solved>cfg.maxSol||a.minMoves<cfg.minMoves||a.invalidRatio<cfg.minInvalid)continue;
    return P;
  }
  return fallback;
}
// ===== ENGINE END =====

const $=(s,r)=>(r||document).querySelector(s);
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
const INTRO=1600;
const rec0=()=>({ep:0,stg:0,lv:[0,0],bc:0,bu:null,res:null,ready:false,live:false,peer:null});
const freshRecs=()=>({1:rec0(),2:rec0(),3:rec0()});
const A={screen:'menu',net:'local',code:'',ep:0,seat:2,stage:1,P:null,elapsed:0,total:0,holdT:0,intro:0,res:null,paused:0,
  recs:freshRecs(),bcMem:{1:0,2:0,3:0},buSeen:{1:0,2:0,3:0},myPeer:null,connected:false};
let room=null;

const randCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<4;i++)s+=a[Math.floor(Math.random()*a.length)];return s;};
const owned=()=>A.net==='local'?[1,2,3]:(A.seat?[A.seat]:[]);
const burstsUsed=()=>A.bcMem[1]+A.bcMem[2]+A.bcMem[3];
function curLevels(){
  const lv=[];
  for(let s=1;s<=3;s++){
    const r=A.recs[s];
    const use=r.live&&r.ep===A.ep&&r.stg===A.stage;
    lv.push(use?r.lv[0]:0,use?r.lv[1]:0);
  }
  return lv;
}

/* ---------- network ---------- */
function pub(){
  if(A.net!=='online'||!room||!A.seat)return;
  const r=A.recs[A.seat];
  room.presence({g:'pv1',code:A.code,seat:A.seat,ep:A.ep,ready:r.ready,stg:r.stg,lv:r.lv,bc:r.bc,bu:r.bu,res:r.res}).catch(()=>{});
}
function claimsMap(){
  const claims={1:[],2:[],3:[]};
  if(!room)return {claims:claims,ps:[],me:null};
  const all=room.peers();
  const me=all.find(p=>p.sameTab)||null;
  const ps=all.filter(p=>!p.sameTab&&p.presence&&p.presence.g==='pv1'&&p.presence.code===A.code);
  ps.forEach(p=>{const s=p.presence.seat;if(s===1||s===2||s===3)claims[s].push(p);});
  return {claims:claims,ps:ps,me:me};
}
function autoSeat(){
  if(A.net!=='online'||A.seat)return;
  const {claims}=claimsMap();
  for(let s=1;s<=3;s++){if(!claims[s].length){pickSeat(s);return;}}
}
function pickSeat(s){
  if(A.seat&&A.seat!==s){A.recs[A.seat]=rec0();}
  A.seat=s;
  const r=A.recs[s];
  Object.assign(r,rec0(),{live:true,ep:A.ep});
  pub();render();
}
function ingest(){
  if(A.net!=='online'||!room)return;
  const {claims,ps,me}=claimsMap();
  if(me)A.myPeer=me.peer;
  const maxEp=ps.reduce((m,p)=>Math.max(m,p.presence.ep|0),A.ep);
  if(maxEp>A.ep){A.ep=maxEp;toLobbyForNewRound();}
  if(A.seat&&A.myPeer&&claims[A.seat].some(p=>p.peer<A.myPeer)){
    A.recs[A.seat]=rec0();A.seat=null;
    pubClear();autoSeat();
  }
  for(let s=1;s<=3;s++){
    const r=A.recs[s];
    if(s===A.seat){r.live=true;continue;}
    const c=claims[s].slice().sort((a,b)=>a.peer<b.peer?-1:1)[0];
    if(!c){r.live=false;continue;}
    const pr=c.presence;
    r.live=true;r.peer=c.peer;r.ep=pr.ep|0;r.stg=pr.stg|0;
    r.lv=Array.isArray(pr.lv)?[pr.lv[0]|0,pr.lv[1]|0]:[0,0];
    r.ready=pr.ready===true;
    r.res=(pr.res==='win'||pr.res==='lose-time'||pr.res==='lose-bursts')?pr.res:null;
    if(r.ep===A.ep){
      A.bcMem[s]=Math.max(A.bcMem[s],pr.bc|0);
      const bu=pr.bu;
      if(bu&&typeof bu==='object'&&(bu.n|0)>A.buSeen[s]){A.buSeen[s]=bu.n|0;toastBurst(bu.g|0,bu.d|0,s);}
    }
  }
  react();
}
function pubClear(){
  if(!room)return;
  room.presence({g:'pv1',code:A.code,seat:null,ready:false,stg:null,lv:null,bc:null,bu:null,res:null,ep:A.ep}).catch(()=>{});
}

/* ---------- game flow ---------- */
function resetRound(){
  A.stage=1;A.P=null;A.elapsed=0;A.total=0;A.holdT=0;A.intro=0;A.res=null;A.paused=0;
  A.bcMem={1:0,2:0,3:0};A.buSeen={1:0,2:0,3:0};
  owned().forEach(s=>{Object.assign(A.recs[s],{ep:A.ep,stg:0,lv:[0,0],bc:0,bu:null,res:null,ready:false});});
}
function toLobbyForNewRound(){
  resetRound();
  A.screen='lobby';
  pub();
  ovKey='';show();
}
function startStage(n){
  A.stage=n;A.P=makePuzzle(A.code+'|'+A.ep,n);
  A.elapsed=0;A.holdT=0;A.intro=INTRO;
  owned().forEach(s=>{Object.assign(A.recs[s],{stg:n,lv:[0,0],ep:A.ep});});
  pub();
}
function startLocal(){
  A.net='local';A.code=A.code||randCode();A.seat=A.seat||2;
  A.recs=freshRecs();
  [1,2,3].forEach(s=>{A.recs[s].live=true;A.recs[s].ep=A.ep;});
  resetRound();
  A.screen='play';
  startStage(1);
  show();
}
function beginPlay(){
  const others=[1,2,3].filter(s=>s!==A.seat&&A.recs[s].ep===A.ep).map(s=>A.recs[s].stg);
  const st=Math.min(NS,Math.max(1,...others));
  A.screen='play';A.res=null;A.bcMem={1:0,2:0,3:0};
  startStage(st);
  show();
}
function maybeStart(){
  if(A.net!=='online'||A.screen!=='lobby'||!A.seat)return;
  const ok=[1,2,3].every(s=>{const r=A.recs[s];return r.live&&r.ready&&r.ep===A.ep;});
  if(ok)beginPlay();
}
function syncStage(){
  if(A.net!=='online'||A.res)return;
  let mx=0;
  [1,2,3].forEach(s=>{if(s!==A.seat){const r=A.recs[s];if(r.live&&r.ep===A.ep)mx=Math.max(mx,r.stg);}});
  if(mx>A.stage&&mx<=NS){toast('Stage '+A.stage+' clear','good');startStage(mx);}
}
function syncRes(){
  if(A.net!=='online'||A.res)return;
  for(let s=1;s<=3;s++){
    if(s===A.seat)continue;
    const r=A.recs[s];
    if(r.live&&r.ep===A.ep&&r.res){finish(r.res,true);return;}
  }
}
function finish(res,adopted){
  if(A.res)return;
  A.res=res;
  if(!adopted){owned().forEach(s=>{A.recs[s].res=res;});pub();}
  ovKey='';render();
}
function stageClear(){
  A.holdT=0;
  if(A.stage>=NS){finish('win');}
  else{toast('Stage '+A.stage+' clear','good');startStage(A.stage+1);render();}
}
function move(k,delta){
  if(A.screen!=='play'||A.intro>0||A.paused||A.res||!A.P||!A.seat)return;
  const r=A.recs[A.seat];
  const nv=r.lv[k]+delta;
  if(nv<0||nv>PIPS)return;
  const lv=curLevels();
  lv[(A.seat-1)*2+k]=nv;
  const b=burstOf(values(A.P,lv));
  if(b){
    r.bc++;r.bu={g:b.g,d:b.d,n:r.bc};
    A.bcMem[A.seat]=Math.max(A.bcMem[A.seat],r.bc);
    A.buSeen[A.seat]=r.bc;
    toastBurst(b.g,b.d,A.seat,true);
    pub();
    if(burstsUsed()>=MAXB)finish('lose-bursts');
    render();
    return;
  }
  r.lv=r.lv.slice();r.lv[k]=nv;
  pub();render();
}
function react(){
  if(A.screen==='lobby')maybeStart();
  if(A.screen==='play'){syncStage();syncRes();}
  render();
}
function leave(){
  if(A.net==='online'){pubClear();if(room)room.leave();try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}}
  A.seat=A.net==='online'?null:2;A.net='local';A.ep=0;A.code='';A.recs=freshRecs();A.screen='menu';
  resetRound();
  ovKey='';show();
}
function playAgain(){
  A.ep=A.ep+1;
  if(A.net==='local'){
    A.recs=freshRecs();[1,2,3].forEach(s=>{A.recs[s].live=true;A.recs[s].ep=A.ep;});
    resetRound();A.screen='play';startStage(1);
  }else{
    resetRound();A.screen='lobby';pub();
  }
  ovKey='';show();
}
function enterRoom(code){
  if(!room||code.length<3)return;
  A.net='online';A.code=code;A.ep=0;A.seat=null;A.myPeer=null;
  A.recs=freshRecs();resetRound();
  A.screen='lobby';
  try{location.hash='r-'+code;}catch(e){}
  room.join(code);
  room.presence({g:'pv1',code:code,seat:null,ep:0,ready:false}).catch(()=>{});
  show();
  let tries=0;
  const tryAuto=()=>{
    if(A.screen!=='lobby'||A.net!=='online'||A.seat||A.code!==code||room.full||++tries>8)return;
    if(A.connected){ingest();autoSeat();}
    if(!A.seat)setTimeout(tryAuto,tries<3?900:1500);
  };
  setTimeout(tryAuto,1800);
}

/* ---------- ticking ---------- */
let last=performance.now();
function tick(){
  const now=performance.now();let dt=now-last;last=now;if(dt>3000)dt=3000;
  if(A.screen==='play'&&A.P&&!A.res){
    A.paused=0;
    if(A.net==='online'){for(let s=1;s<=3;s++){if(!A.recs[s].live){A.paused=s;break;}}}
    if(!A.paused){
      if(A.intro>0){A.intro=Math.max(0,A.intro-dt);}
      else{
        A.elapsed+=dt/1000;A.total+=dt/1000;
        const all=bandFlags(A.P,values(A.P,curLevels())).every(Boolean);
        if(all){A.holdT+=dt/1000;if(A.holdT>=HOLD)stageClear();}else A.holdT=0;
        if(!A.res&&A.elapsed>=TIME)finish('lose-time');
      }
    }
    if(A.net==='online'){syncStage();syncRes();}
  }
  renderOverlay();renderTimer();
}

/* ---------- rendering ---------- */
let toastT=0;
function toast(msg,kind){
  const t=$('#toast');t.textContent=msg;t.className='toast show '+(kind||'');
  clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2600);
}
function toastBurst(g,d,s,mine){
  const what=g>=1&&g<=6?('G'+g+(d>0?' over pressure':' ran dry')):'A gauge hit its limit';
  toast('Burst: '+what+(mine?'. That move was blocked.':' (player '+s+')'));
  const c=$('#console');c.classList.remove('burst');void c.offsetWidth;c.classList.add('burst');
  setTimeout(()=>c.classList.remove('burst'),420);
}
const gEls=[],vEls=[];
function buildBoard(){
  const gw=$('#gauges'),vw=$('#valves');
  for(let i=0;i<2;i++){
    const g=el('div','gauge'),lab=el('div','g-label'),tube=el('div','tube');
    const liq=el('div','liquid'),band=el('div','band'),mark=el('div','mark');
    tube.append(liq,band,mark);
    const val=el('div','g-val'),bt=el('div','g-band');
    g.append(lab,tube,val,bt);gw.append(g);
    gEls.push({root:g,lab:lab,tube:tube,band:band,val:val,bt:bt});
  }
  for(let k=0;k<2;k++){
    const v=el('div','valve'),top=el('div','v-top'),h=el('h3','','Valve '+(k+1));
    const ctl=el('div','v-ctl');
    const minus=el('button','step','−');minus.type='button';minus.setAttribute('aria-label','Close valve '+(k+1));
    const pips=el('div','pips');const pi=[];for(let p=0;p<PIPS;p++){const i=el('i');pips.append(i);pi.push(i);}
    const plus=el('button','step','+');plus.type='button';plus.setAttribute('aria-label','Open valve '+(k+1));
    ctl.append(minus,pips,plus);top.append(h,ctl);
    const mk=()=>{const row=el('div','eff'),l=el('span'),b=el('b'),w=el('span','who'),r=el('span');l.append(b,document.createTextNode(' '),w);row.append(l,r);return {row:row,b:b,w:w,r:r};};
    const up=mk(),dn=mk();
    v.append(top,up.row,dn.row);vw.append(v);
    minus.addEventListener('click',()=>move(k,-1));
    plus.addEventListener('click',()=>move(k,1));
    vEls.push({minus:minus,plus:plus,pi:pi,up:up,dn:dn});
  }
}
function renderBoard(){
  const P=A.P;if(!P||!A.seat)return;
  const s=A.seat,vals=values(P,curLevels()),inb=bandFlags(P,vals);
  const who=g=>seatOf(g)===s?'(yours)':'(player '+seatOf(g)+')';
  for(let i=0;i<2;i++){
    const gi=2*s-2+i,e=gEls[i],bd=P.band[gi],v=vals[gi];
    e.lab.textContent='G'+(gi+1);
    e.tube.style.setProperty('--p',Math.max(0,Math.min(RANGE,v))/RANGE*100);
    e.band.style.setProperty('--b0',(bd.lo-0.5)/RANGE*100);
    e.band.style.setProperty('--bh',(bd.hi-bd.lo+1)/RANGE*100);
    e.val.textContent=String(v);
    e.bt.textContent='band '+bd.lo+'-'+bd.hi;
    e.root.classList.toggle('in',inb[gi]);
  }
  const locked=A.intro>0||A.paused||!!A.res;
  for(let k=0;k<2;k++){
    const vi=(s-1)*2+k,x=P.valves[vi],lvl=A.recs[s].lv[k],e=vEls[k];
    e.pi.forEach((p,i)=>p.classList.toggle('on',i<lvl));
    e.minus.disabled=locked||lvl<=0;
    e.plus.disabled=locked||lvl>=PIPS;
    [[e.up,x.fx[0]],[e.dn,x.fx[1]]].forEach(([row,f])=>{
      row.b.textContent='G'+f.g;row.w.textContent=who(f.g);
      row.r.textContent=(f.s>0?'▲ ':'▼ ')+f.m+' per +';
    });
  }
  $('#stg').textContent=A.stage;
  $('#you').textContent='You are player '+s;
  const used=burstsUsed();
  [...$('#bursts').querySelectorAll('i')].forEach((d,i)=>d.classList.toggle('off',i>=MAXB-used));
  $('#bursts').setAttribute('aria-label',(MAXB-used)+' bursts left');
}
let chipKey='';
function renderChrome(){
  $('#leave').hidden=A.screen==='menu';
  const chip=$('#chip');
  const showChip=A.screen==='play'||(A.screen==='lobby'&&!!A.seat);
  chip.hidden=!showChip;
  const key=A.screen+'|'+A.net+'|'+A.seat;
  if(showChip&&key!==chipKey){
    chipKey=key;chip.replaceChildren();
    if(A.net==='local'&&A.screen==='play'){
      chip.append(document.createTextNode('Station'));
      [1,2,3].forEach(n=>{const b=el('button','',String(n));b.type='button';b.setAttribute('aria-pressed',String(A.seat===n));b.addEventListener('click',()=>{A.seat=n;render();});chip.append(b);});
    }else chip.append(document.createTextNode('Station '+A.seat));
  }
  $('#note').hidden=!(A.screen==='play'&&A.net==='local');
}
const seatRows=[];
function buildLobby(){
  const w=$('#seats');
  for(let s=1;s<=3;s++){
    const row=el('div','seat'),n=el('span','n','Station '+s),st=el('span','st'),btn=el('button','btn');btn.type='button';
    row.append(n,st,btn);w.append(row);
    btn.addEventListener('click',()=>{
      if(A.seat===s){const r=A.recs[s];r.ready=!r.ready;pub();react();}
      else pickSeat(s);
    });
    seatRows.push({row:row,st:st,btn:btn});
  }
}
function renderLobby(){
  $('#lb-code').textContent=A.code;
  const c=$('#lb-conn');c.classList.toggle('on',A.connected);c.lastChild.textContent=(room&&room.full)?'Room full':(A.connected?'Connected':'Connecting');
  let taken=0;
  for(let s=1;s<=3;s++){
    const r=A.recs[s],e=seatRows[s-1],mine=A.seat===s;
    e.row.classList.toggle('me',mine);
    if(r.live)taken++;
    e.st.classList.toggle('go',r.live&&r.ready);
    if(mine){
      e.st.textContent=r.ready?'You are ready':'You';
      e.btn.textContent=r.ready?'Not ready':'Ready';e.btn.className='btn'+(r.ready?'':' primary');e.btn.hidden=false;e.btn.disabled=false;
    }else if(r.live){
      e.st.textContent=r.ready?'Ready':'Seated';e.btn.hidden=true;
    }else{
      e.st.textContent='Free';e.btn.textContent=A.seat?'Move here':'Sit here';e.btn.className='btn';e.btn.hidden=false;e.btn.disabled=false;
    }
  }
  const full=(!A.seat&&taken>=3)||!!(room&&room.full);
  $('#lb-status').textContent=full?'This room is full. Ask a teammate to leave or start another room.':
    taken<3?(taken+' of 3 stations taken. Share the code to fill the rest.'):
    'All three stations are taken. The run starts when everyone is ready.';
}
let ovKey='';
function renderOverlay(){
  const ov=$('#ov');let key='';
  if(A.screen==='play'){
    if(A.res)key='res:'+A.res+':'+A.stage;
    else if(A.paused)key='pause:'+A.paused;
    else if(A.intro>0)key='intro:'+A.stage;
  }
  if(key===ovKey&&(key!==''||ov.hidden))return;
  ovKey=key;
  ov.replaceChildren();
  ov.className='overlay';
  if(!key){ov.hidden=true;renderBoard();return;}
  ov.hidden=false;
  const card=el('div','ov-card');
  if(key.startsWith('intro')){
    ov.classList.add('light');
    card.append(el('h2','','Stage '+A.stage),el('p','',A.stage===1?'120 s on the clock. Find your bands.':'Tighter bands. Same clock.'));
  }else if(key.startsWith('pause')){
    card.append(el('h2','','Paused'),el('p','','Station '+A.paused+' left the room. The clock resumes when someone takes the seat.'));
  }else{
    const used=burstsUsed();
    if(A.res==='win'){
      card.append(el('h2','good','System stable'),el('p','','Both stages cleared in '+A.total.toFixed(1)+' s with '+(MAXB-used)+' burst'+((MAXB-used)===1?'':'s')+' to spare.'));
    }else if(A.res==='lose-time'){
      card.append(el('h2','bad','Time is up'),el('p','','Stage '+A.stage+' ran out of clock before every gauge held its band.'));
    }else{
      card.append(el('h2','bad','Over pressure'),el('p','','All three bursts are used up on stage '+A.stage+'.'));
    }
    const act=el('div','ov-actions');
    const again=el('button','btn primary','Play again'),lv=el('button','btn','Leave');
    again.type='button';lv.type='button';
    again.addEventListener('click',playAgain);lv.addEventListener('click',leave);
    act.append(again,lv);card.append(act);
  }
  ov.append(card);
  renderBoard();
}
const HINT='Every gauge must sit in its band at once. Your valves move gauges you cannot see.';
function renderTimer(){
  if(A.screen!=='play')return;
  const left=Math.max(0,TIME-A.elapsed);
  const f=$('#tfill');f.style.width=(left/TIME*100)+'%';f.classList.toggle('low',left<15);
  const t=left.toFixed(1)+'s';if($('#tnum').textContent!==t)$('#tnum').textContent=t;
  const h=$('#hint');
  const holding=A.holdT>0&&!A.res;
  const txt=holding?'Every gauge is in its band. Hold steady for '+Math.max(0,HOLD-A.holdT).toFixed(1)+' s.':HINT;
  if(h.textContent!==txt)h.textContent=txt;
  h.classList.toggle('ok',holding);
}
function show(){
  $('#s-menu').hidden=A.screen!=='menu';
  $('#s-lobby').hidden=A.screen!=='lobby';
  $('#s-game').hidden=A.screen!=='play';
  chipKey='';
  render();
}
function render(){
  renderChrome();
  if(A.screen==='lobby')renderLobby();
  if(A.screen==='play')renderBoard();
  renderOverlay();renderTimer();
}

/* ---------- wiring ---------- */
buildBoard();buildLobby();
const codeIn=$('#code-in');
function cleanCode(v){return v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);}
codeIn.value=randCode();
codeIn.addEventListener('input',()=>{const c=cleanCode(codeIn.value);if(c!==codeIn.value)codeIn.value=c;});
$('#btn-local').addEventListener('click',()=>{A.net='local';startLocal();});
$('#btn-online').addEventListener('click',()=>{$('#join').hidden=false;});
$('#btn-newcode').addEventListener('click',()=>{codeIn.value=randCode();});
$('#btn-enter').addEventListener('click',()=>enterRoom(cleanCode(codeIn.value)));
codeIn.addEventListener('keydown',e=>{if(e.key==='Enter')enterRoom(cleanCode(codeIn.value));});
$('#leave').addEventListener('click',leave);
$('#lb-copy').addEventListener('click',()=>{
  const b=$('#lb-copy'),done=()=>{b.textContent='Copied';setTimeout(()=>{b.textContent='Copy code';},1400);};
  try{navigator.clipboard.writeText(A.code).then(done,()=>{});}catch(e){}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&A.screen!=='menu')leave();});
setInterval(tick,50);

(function boot(){
  try{const m=/^#r-([A-Za-z0-9]{3,6})$/.exec(location.hash||'');if(m){codeIn.value=m[1].toUpperCase();$('#join').hidden=false;}}catch(e){}
  show();
  (async()=>{
    try{if(window.Peer&&window.makeRoom)room=window.makeRoom();}catch(e){room=null;}
    if(room){
      try{
        room.onPeers(()=>ingest(),()=>{});
        room.onConnection(c=>{A.connected=c;if(A.screen==='lobby')renderLobby();},()=>{});
      }catch(e){}
    }else{
      const b=$('#btn-enter');b.disabled=true;
      $('#join-note').textContent='Online play could not load (the connection library is blocked or offline). You can still play on this screen.';
    }
  })();
})();
})();
