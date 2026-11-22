const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../js/analytics.js'),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
async function setup({choice='yes',privacy={},blocked=false,slowHeartbeat=false}={}){
 const requests=[],buttons=[],listeners={},observers=[],releases=[];let now=1000;
 const document={hidden:false,documentElement:{lang:'de',scrollHeight:10000},referrer:'https://example.org',addEventListener:(name,cb)=>listeners[name]=cb,
  createElement:tag=>{const element={setAttribute(){},append(){},remove(){}};if(tag==='button')buttons.push(element);return element;},
  querySelector:()=>({append(){}}),querySelectorAll:()=>[{id:'research'}],body:{append(){}}};
 const window={innerHeight:1000,scrollY:0,addEventListener:(name,cb)=>listeners[name]=cb,__analyticsLoadFailures:[]};
 class Observer{constructor(cb){this.cb=cb;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
 window.IntersectionObserver=Observer;
 vm.runInNewContext(code,{location:{protocol:'https:',pathname:'/'},window,document,navigator:privacy,IntersectionObserver:Observer,
  localStorage:{getItem(){if(blocked)throw Error();return choice;},setItem(){if(blocked)throw Error();}},
  performance:{now:()=>now},setInterval:cb=>{listeners.timer=cb;return 1;},clearInterval(){},
  fetch:async(url,options)=>{const body=options?JSON.parse(options.body):null;requests.push({url,body});if(slowHeartbeat&&body&&'seconds'in body)await new Promise(resolve=>releases.push(resolve));return{ok:true,json:async()=>url.includes('config')?{enabled:true,fullIp:false}:{id:'a'.repeat(64)}};}});
 await flush();await flush();return{requests,buttons,listeners,observers,releases,document,window,setTime:value=>now=value};
}
(async()=>{
 const s=await setup();assert.equal(s.requests.filter(r=>r.url.includes('action=visit')).length,1);
 const observer=s.observers[0];assert.ok(observer);
 observer.cb([{isIntersecting:true,intersectionRatio:0.01,target:{id:'research'}}]);await flush();
 assert.equal(s.requests.filter(r=>r.url.includes('action=event')).length,0,'A sliver of a section must not count as ten percent');
 observer.cb([{isIntersecting:true,intersectionRatio:0.1,target:{id:'research'}}]);observer.cb([{isIntersecting:true,intersectionRatio:0.5,target:{id:'research'}}]);await flush();
 assert.equal(s.requests.filter(r=>r.body?.kind==='section').length,1,'Count section once at the visibility threshold');
 s.setTime(6000);s.document.hidden=true;s.listeners.visibilitychange();await flush();
 assert.equal(s.requests.filter(r=>r.body&&'seconds'in r.body).at(-1).body.seconds,5,'Count active time before tab hides');
 s.setTime(106000);s.listeners.timer();await flush();
 assert.equal(s.requests.filter(r=>r.body&&'seconds'in r.body).at(-1).body.seconds,0,'Hidden tab must not accumulate active duration');
 const before=s.requests.length;s.buttons[1].onclick();observer.cb([{isIntersecting:true,intersectionRatio:0.5,target:{id:'contact'}}]);s.listeners.timer();await flush();assert.equal(s.requests.length,before,'Withdrawal stops section events and heartbeats');
 for(const privacy of[{doNotTrack:'1'},{globalPrivacyControl:true}]){const p=await setup({privacy});assert.equal(p.requests.length,1,'Privacy signals permit only fetching config, no visit creation');}
 const b=await setup({blocked:true});assert.equal(b.requests.filter(r=>r.url.includes('action=visit')).length,0);b.buttons[0].onclick();await flush();assert.equal(b.requests.filter(r=>r.url.includes('action=visit')).length,1,'Blocked local storage does not prevent explicit opt-in');
 const slow=await setup({slowHeartbeat:true});slow.setTime(6000);slow.listeners.timer();slow.setTime(8000);slow.document.hidden=true;slow.listeners.visibilitychange();slow.releases.shift()();await flush();
 slow.setTime(10000);slow.document.hidden=false;slow.listeners.visibilitychange();slow.releases.shift()();await flush();slow.setTime(13000);slow.listeners.timer();
 assert.equal(slow.requests.filter(r=>r.body&&'seconds'in r.body).reduce((n,r)=>n+r.body.seconds,0),10,'Slow heartbeat must not lose active seconds on tab changes');slow.releases.shift()();await flush();
 const cleared=await setup();const beforeClear=cleared.requests.length;cleared.listeners.storage({key:null,newValue:null});cleared.setTime(5000);cleared.listeners.timer();await flush();assert.equal(cleared.requests.length,beforeClear,'Clearing site storage in another tab must stop tracking');
 console.log('Passed: section threshold/deduplication, active/hidden duration, delayed heartbeats, tab changes, storage clearing, withdrawal, DNT/GPC and consent with blocked storage.');
})().catch(e=>{console.error(e);process.exitCode=1;});
