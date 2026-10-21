/* Expense Anomaly Detector - transparent rule engine, in-browser */
(function(){
'use strict';
let RAW=[],TX=[],FLAGS=[],charts={};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const iso=d=>d.toISOString().slice(0,16);

/* ---------- sample: 60 days of card spending with planted anomalies ---------- */
function sampleRows(){
  const rnd=mulberry32(99),rows=[['date','description','amount']];
  const shops=[['Swiggy',180,450],['Uber',120,380],['DMart',400,1500],['Amazon',250,1200],['Netflix',199,199],['Petrol',500,900],['Cafe',150,350],['Pharmacy',90,400]];
  const now=Date.now();
  for(let d=60;d>=0;d--){
    const n=Math.floor(rnd()*4);
    for(let i=0;i<n;i++){
      const[s,lo,hi]=shops[Math.floor(rnd()*shops.length)];
      const dt=new Date(now-d*864e5);dt.setHours(8+Math.floor(rnd()*13),Math.floor(rnd()*60),0,0);
      rows.push([iso(dt),s+' purchase',-(Math.round(lo+rnd()*(hi-lo)))]);
    }
  }
  // planted: night purchase, duplicate, burst, round amount, big outlier
  const t1=new Date(now-5*864e5);t1.setHours(2,14,0,0);rows.push([iso(t1),'Electronics Store online',-24999]);
  const t2=new Date(now-3*864e5);t2.setHours(14,30,0,0);rows.push([iso(t2),'DMart purchase',-842]);
  const t3=new Date(t2.getTime()+36*60000);rows.push([iso(t3),'DMart purchase',-842]);
  const burstBase=new Date(now-2*864e5);
  for(let i=0;i<6;i++){const b=new Date(burstBase.getTime()+i*18*60000);rows.push([iso(b),'Gaming Credits top-up',-499]);}
  const t4=new Date(now-8*864e5);t4.setHours(19,5,0,0);rows.push([iso(t4),'Jewellery Mart',-50000]);
  return rows;
}

/* ---------- intake ---------- */
const dz=document.getElementById('dropzone'),fi=document.getElementById('fileInput');
dz.addEventListener('click',()=>fi.click());
dz.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click();}});
['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag');}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)readFile(f);});
fi.addEventListener('change',()=>{if(fi.files[0])readFile(fi.files[0]);});
document.getElementById('btnSample').addEventListener('click',()=>{RAW=sampleRows();autoMap();document.getElementById('mappingCard').classList.remove('hidden');document.getElementById('mappingCard').scrollIntoView({behavior:'smooth',block:'center'});toast('Sample statement loaded - 60 days');});
function readFile(f){
  const name=f.name.toLowerCase();
  const done=rows=>{if(!rows||rows.length<2){toast('Could not read rows from that file');return;}RAW=rows;autoMap();document.getElementById('mappingCard').classList.remove('hidden');toast('Loaded '+f.name);};
  if(/\.xlsx?$/.test(name)){const r=new FileReader();r.onload=()=>{try{const wb=XLSX.read(r.result,{type:'array'});done(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:''}));}catch(e){toast('Excel parse failed');}};r.readAsArrayBuffer(f);}
  else{const r=new FileReader();r.onload=()=>{let t=r.result;if(/\.tsv$/i.test(name))t=t.replace(/\t/g,',');done(parseCSV(t));};r.readAsText(f);}
}
function autoMap(){
  const head=RAW[0].map(h=>String(h).trim());
  const fill=(id,re)=>{const sel=document.getElementById(id);sel.innerHTML=head.map((h,i)=>`<option value="${i}">${esc(h||'Column '+(i+1))}</option>`).join('');const m=head.findIndex(h=>re.test(h.toLowerCase()));sel.value=Math.max(0,m);};
  fill('mDate',/date|time|posted/);fill('mDesc',/desc|narrat|detail|particular|memo|merchant|name/);fill('mAmt',/amount|amt|value|debit|sum/);
  document.getElementById('mDir').value='signed';
}
function pdate(v){if(v==null)return null;const s=String(v).trim();let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ](\d{1,2}):(\d{2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);if(m){const a=+m[1],b=+m[2];if(a>12)return new Date(+m[3],b-1,a);if(b>12)return new Date(+m[3],a-1,b);return new Date(+m[3],b-1,a);}const t=Date.parse(s);return isNaN(t)?null:new Date(t);}
function pnum(v){if(v==null||v==='')return null;let s=String(v).replace(/[₹$€£,\s]/g,'');let neg=false;if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}const n=parseFloat(s);return isNaN(n)?null:(neg?-n:n);}

document.getElementById('btnBuild').addEventListener('click',()=>{
  const iD=+document.getElementById('mDate').value,iT=+document.getElementById('mDesc').value,iA=+document.getElementById('mAmt').value,dir=document.getElementById('mDir').value;
  TX=[];
  for(let r=1;r<RAW.length;r++){const row=RAW[r];if(!row)continue;
    const d=pdate(row[iD]),a=pnum(row[iA]);if(!d||a==null)continue;
    const amt=dir==='out'?-Math.abs(a):a;
    TX.push({date:d,desc:String(row[iT]??'').trim()||'(no description)',amt});
  }
  if(TX.length<5){toast('Only '+TX.length+' usable rows - check mapping');return;}
  TX.sort((a,b)=>a.date-b.date);
  document.getElementById('results').classList.remove('hidden');
  analyze();
  document.getElementById('results').scrollIntoView({behavior:'smooth'});
});

/* ---------- detection ---------- */
function shopKey(desc){return desc.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+(purchase|online|payment|store|order|#.*)$/g,'').trim();}
function analyze(){
  const zTh=[3.5,2.5,2.0][+document.getElementById('rSens').value-1];
  document.getElementById('lblSens').textContent=['relaxed (z > 3.5)','standard (z > 2.5)','strict (z > 2.0)'][+document.getElementById('rSens').value-1];
  const on=id=>document.getElementById(id).checked;
  const exp=TX.filter(t=>t.amt<0);
  const vals=exp.map(t=>-t.amt).sort((a,b)=>a-b);
  const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
  const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length)||1;
  const p90=vals[Math.floor(vals.length*0.9)]||Infinity;
  FLAGS=[];
  const seen=new Map();
  exp.forEach((t,i)=>{
    const reasons=[];let score=0;
    const z=(-t.amt-mean)/sd;
    if(z>zTh){reasons.push(`Amount ${z.toFixed(1)} SD above typical spend`);score+=Math.min(60,20+z*8);}
    if(on('rDup')){
      const k=shopKey(t.desc)+'|'+(-t.amt);
      if(seen.has(k)&&(t.date-seen.get(k))<48*3600e3){reasons.push('Duplicate of an earlier charge (same shop + amount, within 48h)');score+=35;}
      seen.set(k,t.date);
    }
    if(on('rVel')){
      const window=exp.filter(o=>Math.abs(o.date-t.date)<=3600e3*2);
      if(window.length>=5){reasons.push(`Part of a burst: ${window.length} expenses within 2 hours`);score+=25;}
    }
    if(on('rNight')){
      const h=t.date.getHours();
      const hasTime=t.date.getHours()||t.date.getMinutes();
      if(hasTime&&h<5){reasons.push(`Made at ${String(h).padStart(2,'0')}:${String(t.date.getMinutes()).padStart(2,'0')} - night hours`);score+=20;}
    }
    if(on('rRound')){
      const v=-t.amt;
      if(v>=1000&&v%1000===0&&v>p90){reasons.push('Large round amount (multiple of 1000, above the 90th percentile)');score+=15;}
    }
    if(reasons.length)FLAGS.push({...t,reasons,score:Math.min(100,Math.round(score)),band:score>=50?'high':'medium'});
  });
  FLAGS.sort((a,b)=>b.score-a.score);
  render(exp,mean,sd);
}
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function render(exp,mean,sd){
  const flaggedIds=new Set(FLAGS.map(f=>f.date.getTime()+'|'+f.amt+'|'+f.desc));
  const total=exp.reduce((s,t)=>s-t.amt,0);
  const flagSum=FLAGS.reduce((s,f)=>s-f.amt,0);
  document.getElementById('kpis').innerHTML=[
    ['Expenses analysed',fmtNum(exp.length),'var(--accent)','total ₹'+fmtNum(total,0)],
    ['Flagged',FLAGS.length,FLAGS.length?'var(--bad)':'var(--ok)',((FLAGS.length/exp.length)*100).toFixed(1)+'% of transactions'],
    ['Amount flagged','₹'+fmtNum(flagSum,0),flagSum>0?'var(--bad)':'var(--ok)',((flagSum/total)*100).toFixed(1)+'% of spend'],
    ['Typical expense','₹'+fmtNum(mean,0),'var(--muted)','SD ₹'+fmtNum(sd,0)]
  ].map(([l,v,c,d])=>`<div class="card stat rise"><div class="stat-label">${l}</div><div class="stat-value" style="color:${c}">${v}</div><div class="stat-delta muted">${d}</div></div>`).join('');
  // timeline
  if(charts.t)charts.t.destroy();
  const byDay={};
  exp.forEach(t=>{const k=t.date.toISOString().slice(0,10);byDay[k]=(byDay[k]||0)+(-t.amt);});
  const days=Object.keys(byDay).sort();
  const flagDays={};FLAGS.forEach(f=>{const k=f.date.toISOString().slice(0,10);flagDays[k]=(flagDays[k]||0)+(-f.amt);});
  charts.t=new Chart(document.getElementById('chTime'),{type:'bar',data:{labels:days.map(d=>new Date(d).toLocaleDateString('en-US',{day:'numeric',month:'short'})),datasets:[
    {label:'Daily spend',data:days.map(d=>Math.round(byDay[d])),backgroundColor:css('--accent'),borderRadius:4,maxBarThickness:22},
    {label:'Flagged',data:days.map(d=>flagDays[d]?Math.round(flagDays[d]):null),backgroundColor:'#dc2626',borderRadius:4,maxBarThickness:22}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:css('--ink-2'),boxWidth:12}}},scales:{x:{ticks:{color:css('--muted'),maxTicksLimit:10},grid:{display:false}},y:{ticks:{color:css('--muted'),callback:v=>'₹'+(v>=1000?(v/1000)+'k':v)},grid:{color:css('--border')}}}}});
  renderFlags();
}
function renderFlags(){
  const band=document.getElementById('fltBand').value;
  const list=FLAGS.filter(f=>!band||f.band===band);
  document.getElementById('flagCount').textContent=list.length+' of '+FLAGS.length+' flagged';
  document.getElementById('tblFlags').innerHTML=list.length?'<thead><tr><th>Risk</th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Why flagged</th></tr></thead><tbody>'+
    list.map(f=>`<tr><td><span class="chip ${f.band==='high'?'chip-bad':'chip-warn'}">${f.band==='high'?'High':'Review'} ${f.score}</span></td><td class="mono" style="white-space:nowrap">${f.date.toLocaleString('en-US',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td><td style="font-weight:600">${esc(f.desc)}</td><td class="num mono" style="color:var(--bad)">₹${fmtNum(-f.amt)}</td><td><ul style="margin:0;padding-left:16px">${f.reasons.map(r=>'<li class="small">'+esc(r)+'</li>').join('')}</ul></td></tr>`).join('')+'</tbody>':'<tbody><tr><td class="empty" style="padding:30px">No transactions flagged at this sensitivity.</td></tr></tbody>';
}
['rSens','rDup','rVel','rNight','rRound'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{if(TX.length)analyze();}));
document.getElementById('fltBand').addEventListener('change',renderFlags);
document.getElementById('btnExport').addEventListener('click',()=>download('flagged-transactions.csv',toCSV([['date','description','amount','score','band','reasons'],...FLAGS.map(f=>[f.date.toISOString(),f.desc,-f.amt,f.score,f.band,f.reasons.join('; ')])]),'text/csv'));
document.getElementById('btnReset').addEventListener('click',()=>location.reload());
window._test={sampleRows};
})();
