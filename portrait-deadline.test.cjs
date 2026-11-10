const{test}=require('node:test'),assert=require('node:assert/strict');
const{withDeadline,preparePortrait,boundedDecoder}=require('./portrait-deadline.cjs');
const{PortraitCache}=require('./notification-portraits.cjs');
const{PortraitFiles}=require('./portrait-files.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const uid='a'.repeat(32),never=()=>new Promise(()=>{});
test('main-process deadline returns fallback even when renderer never starts its timer',async()=>{
 let expired=0;
 assert.equal(await withDeadline(never,15,'fallback',()=>expired++),'fallback');
 assert.equal(expired,1);
 let reject;await withDeadline(()=>new Promise((_,r)=>reject=r),15,null);reject(Error('late'));
 await new Promise(setImmediate);
});
test('stalled decoding frees pending cache entries and keeps the last good portrait',async()=>{
 let now=0,stalled=false;const image={png:true};
 const cache=new PortraitCache({load:async()=>Buffer.from('webp'),decode:()=>stalled?never():image,now:()=>now,timeoutMs:15});
 assert.equal(await cache.get(uid),image);
 now=86400001;stalled=true;assert.equal(await cache.get(uid),image);
 assert.equal(cache.pending.size,0);
 const fresh=new PortraitCache({load:async()=>Buffer.from('webp'),decode:never,timeoutMs:15});
 assert.equal(await fresh.get(uid),null);assert.equal(fresh.pending.size,0);
});
test('unfinished renderer decodes cannot accumulate beyond the gate limit',async()=>{
 const gate=boundedDecoder(2);let calls=0,finish;
 const first=gate(()=>{calls++;return new Promise(r=>finish=r)});
 const second=gate(()=>{calls++;return never()});
 assert.equal(await gate(()=>{calls++;return 'unexpected'}),null);assert.equal(calls,2);
 finish('ok');assert.equal(await first,'ok');assert.equal(await gate(async()=>'next'),'next');
 void second;
});
test('notification preparation uses source-scoped disk fallback and never blocks on cache or disk',async()=>{
 const calls=[];
 const files={latest:async(_uid,kind)=>{calls.push(kind);return '/last-good.png'},get:never};
 assert.equal(await preparePortrait(uid,{kind:'chat'},{cache:{get:never},files,timeoutMs:15}),'/last-good.png');
 assert.equal(await preparePortrait(uid,{kind:'tweet'},{cache:{get:async()=>({})},files,timeoutMs:15}),'/last-good.png');
 assert.deepEqual(calls,['chat','tweet']);
 assert.equal(await preparePortrait(uid,{kind:'chat'},{cache:{get:async()=>null},files:{latest:never},timeoutMs:15}),null);
});
test('disk fallback survives restart and isolates X from CHZZK without guessing legacy files',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stelchat-persisted-portrait-'));
 const png=Buffer.from('89504e470d0a1a0a01020304','hex'),other=Buffer.concat([png,Buffer.from('x')]);
 const cache=new PortraitFiles(root);
 try{
  const chat=await cache.get(uid,{toPNG:()=>png},'chat');
  const x=await cache.get(uid,{toPNG:()=>other},'tweet');
  await cache.pruning;const restarted=new PortraitFiles(root);
  assert.equal(await restarted.latest(uid,'chat'),chat);assert.equal(await restarted.latest(uid,'live'),chat);
  assert.equal(await restarted.latest(uid,'tweet'),x);assert.equal(await restarted.latest(uid,'space'),x);
  assert.notEqual(chat,x);assert.equal(await restarted.latest('invalid','tweet'),null);
  fs.writeFileSync(path.join(root,uid+'-x.json'),JSON.stringify({file:'../private.png'}));
  assert.equal(await restarted.latest(uid,'tweet'),null);
 }finally{await cache.pruning;fs.rmSync(root,{recursive:true,force:true})}
});
