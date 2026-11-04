'use strict';
const {app,BrowserWindow,shell,dialog,session,ipcMain,Menu,clipboard} = require('electron');
const {spawn,execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const ROOT=path.resolve(__dirname,'..');
const DEV_URL=process.env.DOMINION_DEV_URL||'';
const SMOKE=process.env.DOMINION_SMOKE==='1'||process.argv.includes('--smoke');
const SMOKE_OUT=process.env.DOMINION_SMOKE_OUT||'';
try{
 app.setName('dominion-desktop');
 app.setPath('userData',path.join(app.getPath('appData'),'dominion-desktop'));
}catch{}
let window=null,engine=null,quitting=false,enginePort=0,previewWindow=null;
if(!app.requestSingleInstanceLock()){app.quit();}
else{
 app.on('second-instance',()=>{window?.restore();window?.focus();});
 app.whenReady().then(()=>{
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {role:'appMenu'},{role:'fileMenu'},{role:'editMenu'},
   {label:'보기',submenu:[{role:'reload',label:'새로고침'},{role:'forceReload',label:'강제 새로고침'},{role:'toggleDevTools',label:'개발자 도구'},{type:'separator'},{role:'resetZoom',label:'확대 초기화'},{role:'zoomIn',label:'확대'},{role:'zoomOut',label:'축소'},{type:'separator'},{role:'togglefullscreen',label:'전체 화면'}]},
   {role:'windowMenu'}
  ]));
  return start();
 }).catch(err=>{
  const message=String(err?.stack||err);
  if(SMOKE){
   try{if(SMOKE_OUT)fs.writeFileSync(SMOKE_OUT,JSON.stringify({ok:false,error:message,resources:ROOT},null,2));}catch{}
   console.error('DOMINION_SMOKE_FAIL '+message);
   app.exit(1);
   return;
  }
  dialog.showErrorBox('DOMINION 시작 실패',message);app.quit();
 });
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function windowStateFile(){return path.join(app.getPath('userData'),'window-state.json')}
function loadWindowBounds(){
 try{
  const saved=JSON.parse(fs.readFileSync(windowStateFile(),'utf8'));
  if(!saved||!Number.isFinite(saved.width)||!Number.isFinite(saved.height))return null;
  const bounds={width:Math.max(740,saved.width),height:Math.max(650,saved.height)};
  if(Number.isFinite(saved.x)&&Number.isFinite(saved.y)){bounds.x=saved.x;bounds.y=saved.y;}
  return bounds;
 }catch{return null}
}
function saveWindowBounds(win){
 try{fs.writeFileSync(windowStateFile(),JSON.stringify(win.getNormalBounds()))}catch{}
}
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
function openPreviewWindow(value){
 const parsed=new URL(String(value||''));
 if(!['127.0.0.1','localhost','::1'].includes(parsed.hostname))throw Error('로컬 미리보기 주소만 열 수 있습니다.');
 if(previewWindow&&!previewWindow.isDestroyed()){
  previewWindow.loadURL(parsed.toString());
  previewWindow.show();
  return {ok:true,url:parsed.toString()};
 }
 previewWindow=new BrowserWindow({title:'DOMINION · 개발 미리보기',width:1200,height:900,minWidth:700,minHeight:500,backgroundColor:'#f6f8fc',
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:path.join(__dirname,'preload.cjs')}
 });
 previewWindow.webContents.setWindowOpenHandler(({url})=>{
  try{if(new URL(url).protocol==='https:')void shell.openExternal(url)}catch{}
  return {action:'deny'};
 });
 previewWindow.on('closed',()=>{previewWindow=null;});
 previewWindow.loadURL(parsed.toString());
 return {ok:true,url:parsed.toString()};
}
function applyUpdate(value){
 const installer=path.resolve(String(value||''));
 if(!fs.existsSync(installer))throw Error('설치 파일을 찾을 수 없습니다.');
 if(process.platform==='win32'){
  if(!installer.endsWith('DOMINION-Setup.exe'))throw Error('Windows 업데이트는 DOMINION-Setup.exe만 사용할 수 있습니다.');
  const script=path.join(os.tmpdir(),'dominion-update-'+Date.now()+'.ps1');
  const exe=process.execPath;
  const logFile=path.join(os.tmpdir(),'dominion-update.log');
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const q=value=>"'"+String(value).replace(/'/g,"''")+"'";
  const task='DOMINIONUpdate'+Date.now();
  fs.writeFileSync(script,[
   "$ErrorActionPreference='Continue'",
   "$log="+q(logFile),
   "('helper start ' + (Get-Date -Format o)) | Out-File -FilePath $log -Append -Encoding utf8",
   "Start-Sleep -Seconds 2",
   "try {",
   "  $p=Start-Process -FilePath "+q(installer)+" -ArgumentList '/S' -Wait -PassThru",
   "  ('installer exit ' + $p.ExitCode) | Out-File -FilePath $log -Append -Encoding utf8",
   "  Start-Sleep -Seconds 3",
   "  for($i=0;$i -lt 8;$i++){",
   "    try { Start-Process -FilePath "+q(exe)+"; ('started ' + (Get-Date -Format o)) | Out-File -FilePath $log -Append -Encoding utf8; break }",
   "    catch { ('start retry ' + $i + ': ' + $_.Exception.Message) | Out-File -FilePath $log -Append -Encoding utf8; Start-Sleep -Seconds 3 }",
   "  }",
   "} catch { ($_.Exception.Message) | Out-File -FilePath $log -Append -Encoding utf8 }",
   "& "+q(path.join(process.env.SystemRoot||'C:\\Windows','System32','schtasks.exe'))+" /Delete /TN "+q(task)+" /F | Out-Null",
   "Remove-Item $PSCommandPath -Force -ErrorAction SilentlyContinue"
  ].join('\r\n'),'utf8');
  const schtasks=path.join(process.env.SystemRoot||'C:\\Windows','System32','schtasks.exe');
  try{
   execFileSync(schtasks,['/Create','/TN',task,'/TR','"'+ps+'" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+script+'"','/SC','ONCE','/ST','23:59','/F','/RL','LIMITED'],{windowsHide:true,stdio:'ignore'});
   execFileSync(schtasks,['/Run','/TN',task],{windowsHide:true,stdio:'ignore'});
  }catch{
   const child=spawn(ps,['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',script],{detached:true,windowsHide:true,stdio:'ignore'});
   child.on('error',()=>{});child.unref();
  }
  setTimeout(()=>{quitting=true;app.quit();},300);
  return {ok:true,installer,platform:process.platform,logFile};
 }
 if(process.platform==='darwin'){
  if(!installer.endsWith('.dmg'))throw Error('macOS 업데이트는 DMG만 사용할 수 있습니다.');
  const bundle=path.resolve(path.dirname(process.execPath),'..','..');
  const script=path.join(os.tmpdir(),'dominion-update-'+Date.now()+'.sh');
  const log='/tmp/dominion-update.log';
  fs.writeFileSync(script,'#!/bin/sh\necho "helper start $(date)" >> "'+log+'"\nsleep 2\nmount=$(hdiutil attach "$1" -nobrowse | tail -1 | awk \'{print $3}\')\nrm -rf "'+bundle+'"\nditto "$mount/DOMINION.app" "'+bundle+'"\nhdiutil detach "$mount"\nsleep 3\ni=0\nwhile [ $i -lt 8 ]; do\n  if open "'+bundle+'"; then echo "started $(date)" >> "'+log+'"; break; fi\n  echo "start retry $i" >> "'+log+'"\n  i=$((i+1))\n  sleep 3\ndone\nrm -f "$0"\n','utf8');
  fs.chmodSync(script,0o755);
  const child=spawn('/bin/sh',[script,installer],{detached:true,stdio:'ignore'});
  child.on('error',()=>{});child.unref();
  setTimeout(()=>{quitting=true;app.quit();},300);
  return {ok:true,installer,platform:process.platform,logFile:log};
 }
 throw Error('이 플랫폼은 자동 업데이트를 지원하지 않습니다.');
}
async function start(){
 if(window&&!window.isDestroyed()){window.show();window.focus();return;}
 ipcMain.removeHandler('dominion:pick-video');
 ipcMain.handle('dominion:pick-video',async()=>{
  const answer=await dialog.showOpenDialog(window||undefined,{title:'업로드할 영상 선택',properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','webm','mkv','avi','m4v']}]});
  return answer.canceled?'':answer.filePaths[0]||'';
 });
 ipcMain.removeHandler('dominion:show-item');
 ipcMain.handle('dominion:show-item',async(_event,target)=>{
  if(typeof target!=='string'||!target||!fs.existsSync(target))return {ok:false,error:'파일을 찾을 수 없습니다.'};
  shell.showItemInFolder(path.resolve(target));
  return {ok:true};
 });
 ipcMain.removeHandler('dominion:open-path');
 ipcMain.handle('dominion:open-path',async(_event,target)=>{
  if(typeof target!=='string'||!target||!fs.existsSync(target))return {ok:false,error:'폴더를 찾을 수 없습니다.'};
  const error=await shell.openPath(path.resolve(target));
  return error?{ok:false,error}:{ok:true};
 });
 ipcMain.removeHandler('dominion:pick-model');
 ipcMain.handle('dominion:pick-model',async(_event,format)=>{
  const folder=format==='mlx';
  const answer=await dialog.showOpenDialog(window||undefined,{
   title:folder?'MLX 모델 폴더 선택':'GGUF 모델 파일 선택',
   properties:folder?['openDirectory']:['openFile'],
   ...(folder?{}:{filters:[{name:'GGUF models',extensions:['gguf']} ]})
  });
  return answer.canceled?'':answer.filePaths[0]||'';
 });
 ipcMain.removeHandler('dominion:pick-directory');
 ipcMain.handle('dominion:pick-directory',async()=>{
  const answer=await dialog.showOpenDialog(window||undefined,{title:'DOMINION 소스 작업공간 선택',properties:['openDirectory','createDirectory']});
  return answer.canceled?'':answer.filePaths[0]||'';
 });
 ipcMain.removeHandler('dominion:open-preview');
 ipcMain.handle('dominion:open-preview',async(_event,url)=>openPreviewWindow(url));
 ipcMain.removeHandler('dominion:apply-update');
 ipcMain.handle('dominion:apply-update',async(_event,installer)=>applyUpdate(installer));
 if(!DEV_URL&&!fs.existsSync(path.join(ROOT,'dist','index.html')))throw Error('Missing compiled UI. Run npm run build in the repository root.');
 let origin=DEV_URL?DEV_URL.replace(/\/$/,''):'';
 if(!DEV_URL&&engine&&!engine.killed&&enginePort)origin='http://127.0.0.1:'+enginePort;
 const data=path.join(app.getPath('userData'),'runtime');
 const workspace=path.join(app.getPath('documents'),'DOMINION Workspace');
 fs.mkdirSync(data,{recursive:true});fs.mkdirSync(workspace,{recursive:true});
 if(!DEV_URL&&!(engine&&!engine.killed&&enginePort)){
  enginePort=await freePort();
  engine=spawn(process.execPath,[path.join(ROOT,'server/index.mjs')],{
   cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true,
   env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DOMINION_PORT:String(enginePort),DOMINION_HOST:'127.0.0.1',DOMINION_DATA:data,DOMINION_WORKSPACE:workspace,DOMINION_VERSION:app.getVersion()}
  });
  let stderr='';
  engine.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-6000);});
  engine.on('exit',(code,signal)=>{if(!quitting){dialog.showErrorBox('DOMINION Gateway 종료','Engine exited unexpectedly: '+code+' '+signal+'\n'+stderr);app.quit();}});
  origin='http://127.0.0.1:'+enginePort;
  let ready=false;
  for(let i=0;i<100;i++){
   if(engine.exitCode!==null)throw Error('Gateway exited: '+stderr);
   try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break}}catch{}
   await sleep(160);
  }
  if(!ready)throw Error('DOMINION gateway startup timed out: '+stderr);
 }
 if(SMOKE){
  const health=await (await fetch(origin+'/api/health',{signal:AbortSignal.timeout(5000)})).json();
  const presets=await (await fetch(origin+'/api/mcp/presets',{signal:AbortSignal.timeout(5000)})).json();
  const result={ok:health.ok===true,version:health.version||'',mcpPresets:Array.isArray(presets)?presets.length:-1,resources:ROOT,userData:app.getPath('userData'),node:process.versions.node,electron:process.versions.electron};
  if(SMOKE_OUT)fs.writeFileSync(SMOKE_OUT,JSON.stringify(result,null,2));
  console.log('DOMINION_SMOKE_OK '+JSON.stringify(result));
  quitting=true;
  if(engine&&!engine.killed)engine.kill();
  app.exit(result.ok?0:1);
  return;
 }
 window=new BrowserWindow({title:'DOMINION',...(loadWindowBounds()||{width:1340,height:850}),minWidth:740,minHeight:650,backgroundColor:'#f6f8fc',show:false,
   webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:path.join(__dirname,'preload.cjs')}
 });
 session.defaultSession.on('will-download',(_event,item)=>{
  const target=path.join(app.getPath('downloads'),item.getFilename());
  item.setSavePath(target);
 });
 session.defaultSession.setPermissionRequestHandler((_webContents,permission,callback)=>{
  callback(permission==='clipboard-sanitized-write');
 });
 window.webContents.setWindowOpenHandler(({url})=>{
  try{
   const u=new URL(url);
   const oauth=(u.hostname==='github.com'&&u.pathname==='/login/oauth/authorize')||
       (u.hostname==='accounts.google.com'&&u.pathname.startsWith('/o/oauth2/'));
   if(oauth&&u.protocol==='https:')return {action:'allow',overrideBrowserWindowOptions:{webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}};
   if(u.protocol==='https:')void shell.openExternal(url);
  }catch{}
  return {action:'deny'};
 });
 window.webContents.on('will-navigate',(e,url)=>{
  if(!url.startsWith(origin+'/')){
   e.preventDefault();
   try{if(new URL(url).protocol==='https:')void shell.openExternal(url)}catch{}
  }
 });
 window.webContents.on('context-menu',(_event,params)=>{
  const items=[];
  if(params.isEditable){
   items.push({role:'cut',label:'잘라내기'},{role:'copy',label:'복사'},{role:'paste',label:'붙여넣기'},{type:'separator'},{role:'selectAll',label:'전체 선택'});
  }else if(params.selectionText){
   const text=params.selectionText;
   items.push(
    {label:'복사',click:()=>clipboard.writeText(text)},
    {label:'Google로 번역',click:()=>{void shell.openExternal('https://translate.google.com/?sl=auto&tl=ko&text='+encodeURIComponent(text.slice(0,1800)))}},
    {label:'검색',click:()=>{void shell.openExternal('https://www.google.com/search?q='+encodeURIComponent(text.slice(0,400)))}},
    {type:'separator'},{role:'selectAll',label:'전체 선택'}
   );
  }
  if(params.linkURL){
   if(items.length)items.push({type:'separator'});
   items.push({label:'링크 열기',click:()=>{void shell.openExternal(params.linkURL)}});
   items.push({label:'링크 주소 복사',click:()=>clipboard.writeText(params.linkURL)});
  }
  if(params.mediaType==='image'){
   items.push({label:'이미지 복사',click:()=>window.webContents.copyImageAt(params.x,params.y)});
  }
  if(items.length)Menu.buildFromTemplate(items).popup({window});
 });
 window.once('ready-to-show',()=>window.show());
 window.on('close',()=>saveWindowBounds(window));
 await window.loadURL(origin);
}
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)void start();else{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
let quitStopping=false;
app.on('before-quit',(event)=>{
 if(quitStopping)return;
 event.preventDefault();
 quitStopping=true;quitting=true;
 const done=()=>{if(engine&&!engine.killed)engine.kill();app.quit();};
 if(enginePort){
  fetch('http://127.0.0.1:'+enginePort+'/api/video/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true,onlyManaged:true}),signal:AbortSignal.timeout(2500)}).then(done,done);
 }else done();
});
