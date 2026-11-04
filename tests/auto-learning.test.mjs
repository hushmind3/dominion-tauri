import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {newSession,runTurn,learnFromSession} from '../server/engine.mjs';
import {get,all,put,remove,db} from '../server/store.mjs';

test('normal chat automatically enqueues learning; durable facts are saved once',async()=>{
 const suffix=crypto.randomUUID().replaceAll('-','');
 const preference='auto-learning-fixture-'+suffix;
 const providerId='auto-learn-provider-'+suffix;
 let learns=0;
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  const data=JSON.parse(body);
  const learning=String(data.messages?.[0]?.content||'').includes('Extract durable reusable knowledge');
  if(learning)learns++;
  const answer=learning?JSON.stringify({memories:[{text:'User prefers '+preference,scope:'shared'}],skill:null}):'Noted your preference.';
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:answer},finish_reason:'stop'}],usage:{total_tokens:9}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 put('provider',{id:providerId,name:'Auto learning test',kind:'openai',enabled:true,local:true,baseUrl:'http://127.0.0.1:'+server.address().port+'/v1'});
 const sess=newSession({providerId,model:'mock-chat'});
 try{
  const answer=await runTurn({sessionId:sess.id,providerId,model:'mock-chat',input:'I prefer '+preference});
  assert.match(answer.content,/Noted/);
  let job;
  for(let n=0;n<80;n++){
   job=all('job').find(x=>x.kind==='learn'&&x.input?.sessionId===sess.id);
   if(job?.status==='completed'||job?.status==='failed')break;
   await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(job?.status,'completed',job?.error);
  const memory=all('memory').find(x=>x.text==='User prefers '+preference);
  assert.ok(memory,'Automatic learning should save a durable fact');
  const again=await learnFromSession(sess.id,{providerId,model:'mock-chat',automatic:true});
  assert.equal(again.skipped,'already_processed');
  assert.equal(learns,1);
  remove('memory',memory.id);remove('learning_checkpoint',sess.id);
  if(job)remove('job',job.id);
 }finally{
  remove('provider',providerId);remove('session',sess.id);
  db.prepare('DELETE FROM messages WHERE session_id=?').run(sess.id);
  await new Promise(resolve=>server.close(resolve));
 }
});
