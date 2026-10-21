import puppeteer from 'puppeteer-core';
import fs from 'fs';
const out='/tmp/shots57';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars']});
let fails=[];
const check=(name,ok,extra='')=>{console.log((ok?'PASS':'FAIL')+' '+name+(extra?' — '+extra:''));if(!ok)fails.push(name);};
for(const v of [{name:'desktop',w:1440,h:900},{name:'mobile',w:390,h:844}]){
 for(const theme of ['light','dark']){
  const page=await browser.newPage();
  await page.setViewport({width:v.w,height:v.h,deviceScaleFactor:1});
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await page.evaluateOnNewDocument(t=>localStorage.setItem('theme',t),theme);
  await page.goto('http://localhost:8054',{waitUntil:'networkidle2'});
  await page.click('#btnSample');
  await page.waitForSelector('#mappingCard:not(.hidden)');
  await page.evaluate(()=>document.getElementById('btnBuild').click());
  await page.waitForSelector('#results:not(.hidden)');
  await new Promise(s=>setTimeout(s,900));
  const flags=await page.$$eval('#tblFlags tbody tr',els=>els.length);
  check(`${v.name}/${theme} anomalies flagged`,flags>=8,flags+' rows');
  const txt=await page.$eval('#tblFlags',e=>e.textContent);
  check(`${v.name}/${theme} night-hours flag`,txt.includes('night hours'));
  check(`${v.name}/${theme} duplicate flag`,txt.includes('Duplicate'));
  check(`${v.name}/${theme} burst flag`,txt.includes('burst'));
  check(`${v.name}/${theme} reasons listed`,txt.includes('SD above typical'));
  // sensitivity change reduces flags on relaxed
  const before=flags;
  await page.$eval('#rSens',el=>{el.value=1;el.dispatchEvent(new Event('change'));});
  await new Promise(s=>setTimeout(s,400));
  const relaxed=await page.$$eval('#tblFlags tbody tr',els=>els.length);
  check(`${v.name}/${theme} relaxed sensitivity lowers flags`,relaxed<=before,`${before} -> ${relaxed}`);
  // band filter
  await page.select('#fltBand','high');await new Promise(s=>setTimeout(s,200));
  const high=await page.$eval('#flagCount',e=>e.textContent);
  check(`${v.name}/${theme} band filter`,/^(\d+) of/.test(high),high);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${out}/top-${v.name}-${theme}.png`});
  await page.evaluate(()=>document.getElementById('tblFlags').scrollIntoView({block:'center'}));
  await new Promise(s=>setTimeout(s,250));
  await page.screenshot({path:`${out}/flags-${v.name}-${theme}.png`});
  check(`${v.name}/${theme} no console errors`,errs.length===0,errs.slice(0,3).join('|'));
  await page.close();
 }
}
await browser.close();
if(fails.length){console.log('\nFAILURES: '+fails.join(', '));process.exit(1);}
console.log('\nALL PASS');
