import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

const temp=await mkdtemp(path.join(os.tmpdir(),'dominion-ui-'));
const shots=path.resolve(process.env.DOMINION_SCREENSHOT_DIR||path.join(temp,'screenshots'));
await mkdir(shots,{recursive:true});
const available=()=>new Promise((resolve,reject)=>{
 const server=createServer();server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
});
const port=await available(),origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server/index.mjs'],{
 cwd:process.cwd(),env:{...process.env,DOMINION_PORT:String(port),
 DOMINION_DATA:path.join(temp,'db'),DOMINION_WORKSPACE:path.join(temp,'workspace')},
 stdio:['ignore','pipe','pipe']
});
let logs='';
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-12000));
let browser;
try{
 let connected=false;
 for(let attempt=0;attempt<100;attempt++){
  if(child.exitCode!==null)throw Error('DOMINION server exited: '+logs);
  try{const response=await fetch(origin+'/api/health');if(response.ok){connected=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(connected,'Server never became healthy: '+logs);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.getByText('DOMINION',{exact:true}).first().waitFor();
 const firstNav=page.locator('aside nav button').first();
 assert.equal(await firstNav.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px','Sidebar items should not render as bordered pills');
 await page.locator('aside nav button').filter({hasText:'고급'}).first().click();
 const links=[
  ['채팅','chat'],['모델 관리','models'],['에이전트','agents'],['영상 제작','video'],
  ['연결 · 채널','capabilities'],['MCP · 스킬','extensions'],['메모리','memory'],
  ['자동화','automations'],['실행 기록','activity'],['설정','settings'],
  ['멀티 에이전트','rooms'],['반복 작업','workflows'],['소스 개발','developer']
 ];
 for(const [label,id] of links){
  await page.locator('aside nav button').filter({hasText:label}).first().click();
  await page.waitForFunction(expected=>window.location.hash==='#/'+expected,id);
  await page.locator('aside nav button[aria-current="page"]').waitFor();
  assert.equal(await page.locator('aside nav button[aria-current="page"]').count(),1,'Exactly one active navigation item: '+id);
  await page.locator('main').waitFor({state:'visible'});
  assert.ok((await page.locator('main').innerText()).length>20,'Empty page: '+id);
  if(id==='models'){
   await page.getByRole('button',{name:/API 연결 추가/}).first().click();
   await page.getByRole('dialog').waitFor();
   await page.keyboard.press('Escape');
   await page.getByRole('dialog').waitFor({state:'hidden'});
  }
  if(id==='agents'){
   await page.getByRole('button',{name:/에이전트 만들기/}).first().click();
   await page.getByRole('dialog').waitFor();
   await page.keyboard.press('Escape');
   await page.getByRole('dialog').waitFor({state:'hidden'});
  }
  await page.screenshot({path:path.join(shots,id+'.png'),fullPage:false});
 }
 assert.deepEqual(errors,[], 'Browser runtime exceptions across desktop routes');
 // A shared workspace URL must survive direct load and reload.
 await page.goto(origin+'/#/models',{waitUntil:'domcontentloaded'});
 await page.locator('aside nav button[aria-current="page"]').waitFor();
 assert.equal((await page.locator('aside nav button[aria-current="page"]').innerText()).trim(),'모델 관리','Deep-linked model route');
 await page.reload({waitUntil:'domcontentloaded'});
 assert.equal((await page.locator('aside nav button[aria-current="page"]').innerText()).trim(),'모델 관리','Reload preserves route');
 // Command palette should be navigable without the pointer.
 await page.keyboard.press('Control+k');
 const palette=page.getByRole('dialog',{name:'빠른 이동'});
 await palette.waitFor();
 await page.getByRole('textbox',{name:'메뉴 검색'}).fill('채팅');
 await page.keyboard.press('Enter');
 await palette.waitFor({state:'hidden'});
 assert.equal(new URL(page.url()).hash,'#/chat','Command palette navigates to selected workspace');
 // Slash commands should be discoverable from the message composer and executable without a model.
 const composer=page.getByPlaceholder('무엇을 도와드릴까요?  / 로 명령어');
 await composer.fill('/');
 const slash=page.getByRole('listbox',{name:'슬래시 명령어'});
 await slash.waitFor();
 assert.ok(await slash.getByRole('option').count()>=15,'Slash palette should expose real built-in commands');
 await composer.fill('/sta');
 await slash.getByRole('option').filter({hasText:'/status'}).first().waitFor();
 await composer.press('Enter');
 await page.getByRole('status').getByText(/에이전트.*제공자/).waitFor();
 assert.equal(await composer.inputValue(),'','Executing /status should reset the composer');
 await composer.fill('/model ');
 await slash.waitFor();
 await composer.press('Escape');
 await slash.waitFor({state:'hidden'});

 // The narrow navigation must remain usable after the CSS migration.
 await page.setViewportSize({width:390,height:844});
 await page.reload({waitUntil:'domcontentloaded'});
 const nav=page.locator('aside[aria-label="주 탐색"]');
 const menu=page.getByTitle('메뉴 펼치기');
 if(await menu.count())await menu.first().click();
 else await page.locator('header button').first().click();
 await nav.waitFor({state:'visible'});
 await page.screenshot({path:path.join(shots,'mobile-sidebar-open.png'),fullPage:false});
 await nav.locator('nav button').filter({hasText:'채팅'}).first().click();
 await page.waitForFunction(()=>document.querySelector('aside[aria-label="주 탐색"]')?.getBoundingClientRect().right<=2,null,{timeout:3000});
 await page.screenshot({path:path.join(shots,'mobile-chat.png'),fullPage:false});
 assert.deepEqual(errors,[],'Browser runtime exceptions on mobile');
 console.log('UI smoke passed: '+links.length+' desktop routes + mobile navigation. Screenshots: '+shots);
}finally{
 if(browser)await browser.close();
 child.kill('SIGTERM');
 await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();
  else{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();}});
 await rm(temp,{recursive:true,force:true});
}

