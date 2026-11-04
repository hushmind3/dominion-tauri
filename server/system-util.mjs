import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);

export async function googleTranslate(text){
 const chunks=[];
 const source=String(text||'');
 for(let i=0;i<source.length;i+=3500)chunks.push(source.slice(i,i+3500));
 const out=[];
 for(const chunk of chunks){
  const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q='+encodeURIComponent(chunk);
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Google 번역 HTTP '+response.status);
  const data=await response.json();
  out.push((data?.[0]||[]).map(part=>part?.[0]||'').join(''));
 }
 return out.join('');
}
export async function pickFolder(prompt){
 const title=String(prompt||'폴더 선택').replace(/["\\]/g,'');
 if(process.platform==='darwin'){
  const script=`POSIX path of (choose folder with prompt "${title}")`;
  const {stdout}=await execFileAsync('osascript',['-e',script]);
  return String(stdout||'').trim();
 }
 if(process.platform==='win32'){
  const ps=`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='${title}'; if($d.ShowDialog() -eq 'OK'){Write-Output $d.SelectedPath}`;
  const {stdout}=await execFileAsync('powershell',['-NoProfile','-Command',ps]);
  return String(stdout||'').trim();
 }
 const {stdout}=await execFileAsync('sh',['-c',`zenity --file-selection --directory --title="${title}" 2>/dev/null || kdialog --getexistingdirectory 2>/dev/null`]);
 return String(stdout||'').trim();
}
