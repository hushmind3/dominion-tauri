import net from 'node:net';
import * as driver from '../../channel-drivers/irc.mjs';

export default function activate(){
 return {...driver,async diagnose(record){
  return new Promise(resolve=>{
   const started=Date.now();
   const timer=setTimeout(()=>resolve({verified:false,reason:'timeout'}),9000);
   const socket=net.connect({host:record.host,port:Number(record.port||6667)},()=>{
    clearTimeout(timer);socket.destroy();resolve({verified:true,ms:Date.now()-started});
   });
   socket.on('error',error=>{clearTimeout(timer);resolve({verified:false,reason:String(error?.message||error)});});
  });
 }};
}
