const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{PortraitFiles}=require('./portrait-files.cjs');
const uid='a'.repeat(32),bytes=Buffer.from('89504e470d0a1a0a00000001020304','hex'),image={toPNG:()=>bytes};
test('100 simultaneous alerts share one atomic, complete PNG publication',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stelchat-portrait-fix-'));let writes=0,renames=0;const errors=[];
 const io={...fs.promises,writeFile:async(...args)=>{writes++;await new Promise(r=>setTimeout(r,15));return fs.promises.writeFile(...args)},rename:async(...args)=>{renames++;return fs.promises.rename(...args)}};
 const cache=new PortraitFiles(root,{io,onError:e=>errors.push(e.code)});
 try{
  const results=await Promise.all(Array.from({length:100},async()=>{const result=await cache.get(uid,image);assert(result);assert((await fs.promises.readFile(result)).equals(bytes));return result}));
  await cache.pruning;assert.equal(new Set(results).size,1);assert.equal(writes,1);assert.equal(renames,1);assert.deepEqual(errors,[]);
  assert.equal(cache.pending.size,0);assert.deepEqual(fs.readdirSync(root),[path.basename(results[0])]);
 }finally{await cache.pruning;fs.rmSync(root,{recursive:true,force:true})}
});
test('incomplete legacy files are repaired and later hits do not rewrite them',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stelchat-portrait-repair-'));const cache=new PortraitFiles(root);
 try{
  const file=await cache.get(uid,image);await cache.pruning;fs.writeFileSync(file,Buffer.from('partial'));
  assert.equal(await cache.get(uid,image),file);await cache.pruning;assert(fs.readFileSync(file).equals(bytes));
  assert.equal(await cache.get(uid,image),file);await cache.pruning;
 }finally{await cache.pruning;fs.rmSync(root,{recursive:true,force:true})}
});
test('failed writes clear the shared job, remove temporary files and can retry',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stelchat-portrait-retry-'));let broken=true;const errors=[];
 const io={...fs.promises,rename:async(...args)=>{if(broken)throw Object.assign(Error('disk'),{code:'EACCES'});return fs.promises.rename(...args)}};
 const cache=new PortraitFiles(root,{io,onError:e=>errors.push(e.code)});
 try{
  assert.equal(await cache.get(uid,image),null);assert.equal(cache.pending.size,0);assert.deepEqual(fs.readdirSync(root),[]);assert.deepEqual(errors,['EACCES']);
  broken=false;assert(await cache.get(uid,image));await cache.pruning;
 }finally{await cache.pruning;fs.rmSync(root,{recursive:true,force:true})}
});
