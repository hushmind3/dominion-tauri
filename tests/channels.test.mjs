import test from 'node:test';
import assert from 'node:assert/strict';
import {channelCatalog,channelDefinition,validateChannelConfiguration} from '../server/channel-catalog.mjs';
import {channelDriver} from '../server/channel-registry.mjs';
import {claimInbound,finishInbound} from '../server/store.mjs';
import {verifyWebhook} from '../server/channel-security.mjs';
import {createHmac,randomUUID} from 'node:crypto';

test('channel marketplace is discovered from manifests rather than a fixed pair',()=>{
 const rows=channelCatalog();
 assert.ok(rows.length>=26);
 assert.ok(rows.every(x=>/^https:\/\//.test(x.docs)));
 assert.ok(rows.some(x=>x.id==='slack'&&x.available));
 assert.ok(rows.some(x=>x.id==='matrix'&&x.available));
 assert.ok(rows.some(x=>x.id==='whatsapp'&&x.available));
 assert.ok(rows.some(x=>x.id==='line'&&x.available));
 assert.ok(rows.some(x=>x.id==='nostr'&&!x.available));
 assert.ok(rows.every(x=>Boolean(x.available)===Boolean(channelDriver(x.id))));
 assert.equal(channelDefinition('unlisted-service'),null);
 assert.throws(()=>validateChannelConfiguration('unlisted-service',{},{}),/Unknown channel type/);
 assert.throws(()=>validateChannelConfiguration('nostr',{},{}),/Driver not installed/);
});
test('common inbound ledger prevents duplicates and permits retries after failure',()=>{
 const id=randomUUID();assert.equal(claimInbound(id),true);
 assert.equal(claimInbound(id),false);
 finishInbound(id,false);assert.equal(claimInbound(id),true);
 finishInbound(id,true);assert.equal(claimInbound(id),false);
});
test('signed LINE and WhatsApp webhooks require matching HMAC',()=>{
 const raw=Buffer.from(JSON.stringify({events:[{type:'message'}]}));
 const secret='test-only-integration-secret';
 const lineSig=createHmac('sha256',secret).update(raw).digest('base64');
 const metaSig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(verifyWebhook('line',{'x-line-signature':lineSig},raw,{channelSecret:secret}),true);
 assert.equal(verifyWebhook('whatsapp',{'x-hub-signature-256':metaSig},raw,{appSecret:secret}),true);
 assert.equal(verifyWebhook('line',{'x-line-signature':'incorrect'},raw,{channelSecret:secret}),false);
});
