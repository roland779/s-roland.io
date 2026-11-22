const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'../..');
const read=p=>fs.readFileSync(require('node:path').join(root,p),'utf8');
const translations=JSON.parse(read('academic_website/data/i18n.json'));
const html=read('index.html');
for(const [id,file] of [['i18nData','i18n.json'],['pubData','publications.json']]) {
  const match=html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
  assert.ok(match, id);
  assert.deepEqual(JSON.parse(match[1]),JSON.parse(read('academic_website/data/'+file)));
}
for(const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) {
  for(const language of ['en','de']) assert.equal(typeof translations[language][match[1]],'string',match[1]);
}
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if(!/^(https?:|mailto:|data:)/.test(match[1])) assert.ok(fs.existsSync(require('node:path').join(root,match[1])),match[1]);
}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(ids).size,ids.length,'duplicate HTML IDs');
for(const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]),'missing anchor '+match[1]);
assert.deepEqual(Object.keys(translations.en).sort(),Object.keys(translations.de).sort());
async function checkLanguage() {
  let changed=0;
  const buttons=['en','de'].map(language=>({getAttribute:()=>language,setAttribute(){},addEventListener(_,callback){this.click=callback;}}));
  const context={localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},navigator:{language:'de-DE'},document:{readyState:'complete',documentElement:{},querySelectorAll:selector=>selector==='[data-lang]'?buttons:[],getElementById:()=>({textContent:JSON.stringify(translations)})},fetch:async()=>({ok:false,json:async()=>({})}),window:{dispatchEvent(){changed++;}},CustomEvent:class{}};
  vm.runInNewContext(read('academic_website/js/i18n.js'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.document.documentElement.lang,'de');
  assert.equal(changed,1,'initial translations must notify publications');
  buttons[0].click();
  assert.equal(context.document.documentElement.lang,'en');
  assert.equal(changed,2);
}
function checkTheme() {
  const attributes={};let click;
  const button={getAttribute:()=> 'dark',setAttribute(){},addEventListener(_,callback){click=callback;}};
  vm.runInNewContext(read('academic_website/js/theme.js'),{window:{},document:{readyState:'complete',documentElement:{setAttribute:(key,value)=>attributes[key]=value,removeAttribute:key=>delete attributes[key]},querySelectorAll:()=>[button],getElementById:()=>null},localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
  click();assert.equal(attributes['data-theme'],'dark');
}
function checkSystemTheme() {
  const attributes={};
  const buttons=['light','dark'].map(value=>({pressed:null,getAttribute:()=>value,setAttribute(_,pressed){this.pressed=pressed;},addEventListener(_,callback){this.click=callback;}}));
  const media={matches:true,addEventListener(_,callback){this.change=callback;}};
  const context={window:{matchMedia:()=>media},localStorage:{getItem:()=>null,setItem(){}},document:{readyState:'complete',documentElement:{setAttribute:(key,value)=>attributes[key]=value,removeAttribute:key=>delete attributes[key]},querySelectorAll:()=>buttons,getElementById:()=>null}};
  vm.runInNewContext(read('academic_website/js/theme.js'),context);
  assert.equal(buttons[1].pressed,'true');
  assert.equal(attributes['data-theme'],undefined);
  media.matches=false;media.change();
  assert.equal(buttons[0].pressed,'true');
  buttons[1].click();
  media.change();
  assert.equal(attributes['data-theme'],'dark');
  assert.equal(buttons[1].pressed,'true');
}
async function checkTranslationValidation() {
  for (const invalid of [{en:[],de:[]},{en:'bad',de:'bad'},null]) {
    let changed=0;
    const context={localStorage:{getItem:()=>null},navigator:{language:'en'},document:{readyState:'complete',documentElement:{},querySelectorAll:()=>[],getElementById:()=>({textContent:JSON.stringify(translations)})},fetch:async()=>({ok:true,json:async()=>invalid}),window:{dispatchEvent(){changed++;}},CustomEvent:class{}};
    vm.runInNewContext(read('academic_website/js/i18n.js'),context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(context.window.__getI18n().en.skip,translations.en.skip);
    assert.equal(changed,1);
  }
}
async function checkPublications() {
  const elements={pubList:{innerHTML:'',children:[],appendChild(child){this.children.push(child);}},pubMeta:{}};
  const data={publications:[{title:'Old',venue:'Journal (2020)',links:{bad:'javascript:alert(1)',doi:'https://example.org'}},{title:'New',venue:'Journal (2026)'},{title:'Hidden',selected:false}]};
  const context={URL,document:{getElementById:id=>elements[id],createElement:()=>({})},window:{location:{protocol:'https:'},addEventListener(){},__getLang:()=> 'de',__getI18n:()=>translations},fetch:async()=>({ok:true,json:async()=>data}),console};
  vm.runInNewContext(read('academic_website/js/publications.js'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.pubList.children.length,2);
  assert.match(elements.pubList.children[0].innerHTML,/New/);
  assert.doesNotMatch(elements.pubList.children[1].innerHTML,/javascript:/);
  assert.ok(elements.pubList.children[1].innerHTML.includes('href="https://example.org"'));
  assert.match(elements.pubMeta.textContent,/Anzeige/);
}
async function checkPublicationFailuresAndFileMode() {
  for (const mode of ['http-error','invalid-data','file']) {
    let fetched=false;
    let errorCount=0;
    const list={children:[],innerHTML:'',appendChild(item){this.children.push(item);}};
    const meta={};
    const context={URL,console:{error(){errorCount++;}},
      document:{getElementById:id=>id==='pubList'?list:id==='pubMeta'?meta:{textContent:JSON.stringify({publications:[{title:'Embedded',venue:'2024'}]})},createElement:()=>({})},
      window:{location:{protocol:mode==='file'?'file:':'https:'},addEventListener(){},__getLang:()=> 'de',__getI18n:()=>translations},
      fetch:async()=>{fetched=true;return {ok:mode!=='http-error',status:404,json:async()=>({publications:[null]})};}};
    vm.runInNewContext(read('academic_website/js/publications.js'),context);
    await new Promise(resolve=>setImmediate(resolve));
    if(mode==='file') {assert.equal(fetched,false);assert.equal(list.children.length,1);assert.equal(errorCount,0);}
    else {assert.equal(errorCount,1);assert.equal(meta.textContent,translations.de['pub.error']);}
  }
}
(async()=>{await checkLanguage();await checkTranslationValidation();checkTheme();checkSystemTheme();await checkPublications();await checkPublicationFailuresAndFileMode();console.log('Passed: embedded data, translations, local assets, blocked storage, language initialization, publication sorting and URL filtering.');})().catch(error=>{console.error(error);process.exitCode=1;});
