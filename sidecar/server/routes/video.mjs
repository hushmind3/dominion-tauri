import fs from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import {videoStatus,saveVideoConfig,startComfyUI,stopComfyUI,videoWorkflows,startVideoJob,videoJob,videoJobs,videoConfig,openVideoFile,openModelFolder,openWorkflowFolder,searchVideoModels,videoOutputs,videoLocations,videoModelOptions,videoRepoFiles,startVideoDownload,videoDownloadJob} from '../video-generator.mjs';

export async function handleVideoRoutes({url,method,res,json,body,req}){
 if(url==='/api/video/status'&&method==='GET')return json(res,await videoStatus());
 if(url==='/api/video/config'&&method==='POST')return json(res,await saveVideoConfig(await body(req)));
 if(url==='/api/video/start'&&method==='POST')return json(res,await startComfyUI());
 if(url==='/api/video/stop'&&method==='POST')return json(res,await stopComfyUI(await body(req)));
 if(url==='/api/video/reveal'&&method==='POST')return json(res,openVideoFile((await body(req)).file));
 if(url==='/api/video/open-models'&&method==='POST')return json(res,openModelFolder());
 if(url==='/api/video/open-workflows'&&method==='POST')return json(res,openWorkflowFolder());
 if(url==='/api/system/pick-folder'&&method==='POST'){
  const {prompt='폴더 선택'}=await body(req);
  return json(res,{path:await pickFolder(String(prompt))});
 }

 if(url==='/api/video/outputs'&&method==='GET')return json(res,videoOutputs());
 if(url==='/api/video/locations'&&method==='GET')return json(res,videoLocations());
 if(url==='/api/video/models'&&method==='GET')return json(res,await videoModelOptions());
 if(url==='/api/video/catalog'&&method==='GET')return json(res,await searchVideoModels({q:u.searchParams.get('q')||'',limit:u.searchParams.get('limit')||30}));
 if(url==='/api/video/files'&&method==='GET')return json(res,await videoRepoFiles(u.searchParams.get('repo')||''));
 if(url==='/api/video/download'&&method==='POST')return json(res,startVideoDownload(await body(req)));
 const vdl=url.match(/^\/api\/video\/download\/([^/]+)$/);
 if(vdl&&method==='GET')return json(res,videoDownloadJob(vdl[1])||{});

 if(url==='/api/video/workflows'&&method==='GET')return json(res,videoWorkflows());
 if(url==='/api/video/generate'&&method==='POST')return json(res,await startVideoJob(await body(req)),202);
 if(url==='/api/video/jobs'&&method==='GET')return json(res,videoJobs());
 const videoJobMatch=url.match(/^\/api\/video\/jobs\/([^/]+)$/);
 if(videoJobMatch&&method==='GET'){const job=videoJob(videoJobMatch[1]);return json(res,job||{error:'Video job not found'},job?200:404)}
 const videoFile=url.match(/^\/api\/video\/files\/([^/]+)$/);
 if(videoFile&&method==='GET'){
  const filename=path.basename(decodeURIComponent(videoFile[1]));
  const file=path.join(videoConfig().outputDir,filename);
  if(!file.startsWith(videoConfig().outputDir+path.sep))return json(res,{error:'Invalid file'},400);
  try{
   const stat=await fs.stat(file);
   if(!stat.isFile())throw Error('Not a file');
   const type=/\.webm$/i.test(filename)?'video/webm':/\.gif$/i.test(filename)?'image/gif':/\.webp$/i.test(filename)?'image/webp':'video/mp4';
   res.writeHead(200,{'Content-Type':type,'Content-Length':stat.size,'Cache-Control':'no-store'});
   fsSync.createReadStream(file).pipe(res);return;
  }catch{return json(res,{error:'Video file not found'},404)}
 }
 if(url==='/api/video/workflows/import'&&method==='POST'){
  const input=await body(req);
  const source=String(input.source||'');
  const config=videoConfig();
  if(!source||!fs.existsSync(source))throw Error('업로드된 파일을 찾을 수 없습니다');
  fs.mkdirSync(config.workflowDir,{recursive:true});
  const name=path.basename(source).replace(/[^\w.-]+/g,'_');
  const target=path.join(config.workflowDir,name.endsWith('.json')?name:name+'.json');
  fs.copyFileSync(source,target);
  return json(res,{ok:true,name:path.basename(target),workflows:videoWorkflows()});
 }

 if(url==='/api/video/models/import'&&method==='POST'){
  const input=await body(req);
  const source=String(input.source||'');
  const config=videoConfig();
  if(!source||!fs.existsSync(source))throw Error('업로드된 파일을 찾을 수 없습니다');
  const dir=path.join(config.comfyDir,'models');
  fs.mkdirSync(dir,{recursive:true});
  const name=path.basename(source);
  fs.copyFileSync(source,path.join(dir,name));
  return json(res,{ok:true,name});
 }
 return false;
}
