const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EmojiCache}=require('./emoji-cache.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=','base64');
const name=n=>String(n).padStart(64,'0')+'.png';
async function setup(t,options={}){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stelchat-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return new EmojiCache(dir,options);}
test('deduplicates concurrent downloads and reuses cache after restart offline',async t=>{
 let calls=0;const c=await setup(t,{fetcher:async()=>{calls++;return new Response(png);}});
 const values=await Promise.all([c.get(name(1)),c.get(name(1))]);assert.equal(calls,1);assert.deepEqual(values[0],png);
 const restarted=new EmojiCache(c.directory,{fetcher:()=>{throw Error('offline');}});assert.deepEqual(await restarted.get(name(1)),png);
});
test('corrupt cache is repaired',async t=>{let calls=0;const c=await setup(t,{fetcher:async()=>{calls++;return new Response(png);}});await c.get(name(1));await fs.writeFile(path.join(c.directory,name(1)),Buffer.alloc(20));assert.deepEqual(await c.get(name(1)),png);assert.equal(calls,2);});
test('rejects traversal, bad images and oversized downloads; backs off',async t=>{
 let calls=0;const c=await setup(t,{fetcher:async()=>{calls++;return new Response('not an image');}});
 await assert.rejects(c.get('../private'));assert.equal(calls,0);await assert.rejects(c.get(name(1)));await assert.rejects(c.get(name(1)));assert.equal(calls,1);
 const big=await setup(t,{fetcher:async()=>new Response(Buffer.alloc(2*1024*1024+1))});await assert.rejects(big.get(name(2)));assert.equal((await big.stats()).count,0);
});
test('bounded cache evicts oldest and clear preserves unrelated files',async t=>{
 const c=await setup(t,{limit:png.length*2,fetcher:async()=>new Response(png)});
 await c.get(name(1));await fs.utimes(path.join(c.directory,name(1)),new Date(0),new Date(0));await c.get(name(2));await c.get(name(3));assert.ok((await c.stats()).bytes<=png.length*2*.8);
 await fs.writeFile(path.join(c.directory,'settings.json'),'keep');await c.clear();assert.equal((await c.stats()).count,0);assert.equal(await fs.readFile(path.join(c.directory,'settings.json'),'utf8'),'keep');
});
test('clear during download prevents repopulation',async t=>{
 let release,started;const start=new Promise(r=>started=r);const c=await setup(t,{fetcher:async()=>{started();return new Promise(r=>release=()=>r(new Response(png)));}});
 const request=c.get(name(1));await start;await c.clear();release();await request;assert.equal((await c.stats()).count,0);
});
test('download concurrency capped at three',async t=>{
 let active=0,peak=0;const c=await setup(t,{fetcher:async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,10));active--;return new Response(png);}});
 await Promise.all(Array.from({length:10},(_,i)=>c.get(name(i))));assert.ok(peak<=3);
});
test('full/read-only cache falls back to downloaded bytes',async t=>{
 const c=await setup(t,{fetcher:async()=>new Response(png)});await fs.rmdir(c.directory);await fs.writeFile(c.directory,'not a directory');assert.deepEqual(await c.get(name(1)),png);
});
