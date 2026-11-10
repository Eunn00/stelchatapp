const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{withDeadline}=require('./portrait-deadline.cjs');
const ownerKey=(uid,kind)=>/^[a-f0-9]{32}$/.test(uid)&&['chat','live','tweet','space'].includes(kind)?uid+(['tweet','space'].includes(kind)?'-x':'-chzzk'):null;
class PortraitFiles{
 constructor(root,{io=fs.promises,limit=64,onError=()=>{}}={}){
  this.root=root;this.io=io;this.limit=limit;this.onError=onError;this.pending=new Map();this.pruning=Promise.resolve();
 }
 get(uid,image,kind=null){
  if(!image||!/^[a-f0-9]{32}$/.test(uid))return Promise.resolve(null);
  let bytes;
  try{bytes=image.toPNG();if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>262144)return Promise.resolve(null)}catch{return Promise.resolve(null)}
  const digest=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12),name=uid+'-'+digest+'.png';
  const pendingKey=name+':'+(kind||'');
  if(this.pending.has(pendingKey))return this.pending.get(pendingKey);
  const job=withDeadline(async()=>{try{const file=await this.store(name,bytes);if(file&&kind)await this.remember(uid,kind,name);return file}catch(error){this.onError(error);return null}},2500).finally(()=>this.pending.delete(pendingKey));
  this.pending.set(pendingKey,job);return job;
 }
 async latest(uid,kind='chat'){
  const owner=ownerKey(uid,kind);if(!owner)return null;
  try{
   const index=path.join(this.root,owner+'.json');if((await this.io.stat(index)).size>512)return null;
   const name=JSON.parse(await this.io.readFile(index,'utf8')).file;
   if(typeof name!=='string'||!name.startsWith(uid+'-')||!/^[a-f0-9]{32}-[a-f0-9]{12}[.]png$/.test(name))return null;
   const file=path.join(this.root,name),stat=await this.io.stat(file);
   if(stat.size<8||stat.size>262144)return null;
   const bytes=await this.io.readFile(file);
   return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?file:null;
  }catch{return null}
 }
 async remember(uid,kind,name){
  const owner=ownerKey(uid,kind);if(!owner)return;
  const index=path.join(this.root,owner+'.json'),temporary=index+'.'+crypto.randomUUID()+'.tmp';
  try{await this.io.writeFile(temporary,JSON.stringify({file:name}),{flag:'wx'});await this.io.rename(temporary,index)}
  catch(error){this.onError(error)}finally{await this.io.unlink(temporary).catch(()=>{})}
 }
 async store(name,bytes){
  await this.io.mkdir(this.root,{recursive:true});
  const destination=path.join(this.root,name);
  let complete=false;
  try{const stat=await this.io.stat(destination);complete=stat.size===bytes.length&&(await this.io.readFile(destination)).equals(bytes)}catch{}
  if(!complete){
   const temporary=path.join(this.root,'.'+name+'.'+crypto.randomUUID()+'.tmp');
   try{
    await this.io.writeFile(temporary,bytes,{flag:'wx'});
    // Publish only a complete PNG. Readers never see the in-progress file.
    await this.io.rename(temporary,destination);
   }finally{await this.io.unlink(temporary).catch(()=>{})}
  }
  await this.io.utimes(destination,new Date(),new Date()).catch(()=>{});
  // Cleanup cannot make another writer fail or remove its in-flight file.
  this.pruning=this.pruning.then(()=>this.prune(name)).catch(error=>this.onError(error));
  return destination;
 }
 async prune(keep){
  const names=(await this.io.readdir(this.root)).filter(n=>/^[a-f0-9]{32}-[a-f0-9]{12}[.]png$/.test(n));
  if(names.length<=this.limit)return;
  const files=await Promise.all(names.map(async name=>{try{return{name,at:(await this.io.stat(path.join(this.root,name))).mtimeMs}}catch{return null}}));
  files.sort((a,b)=>(a?.at||0)-(b?.at||0));let remove=names.length-this.limit;
  for(const file of files){if(remove<=0)break;if(!file||file.name===keep||[...this.pending.keys()].some(key=>key.startsWith(file.name+':')))continue;try{await this.io.unlink(path.join(this.root,file.name));remove--}catch{}}
 }
}
module.exports={PortraitFiles};
