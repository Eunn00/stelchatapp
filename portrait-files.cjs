const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class PortraitFiles{
 constructor(root,{io=fs.promises,limit=64,onError=()=>{}}={}){
  this.root=root;this.io=io;this.limit=limit;this.onError=onError;this.pending=new Map();this.pruning=Promise.resolve();
 }
 get(uid,image){
  if(!image||!/^[a-f0-9]{32}$/.test(uid))return Promise.resolve(null);
  let bytes;
  try{bytes=image.toPNG();if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>262144)return Promise.resolve(null)}catch{return Promise.resolve(null)}
  const digest=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12),name=uid+'-'+digest+'.png';
  if(this.pending.has(name))return this.pending.get(name);
  const job=this.store(name,bytes).catch(error=>{this.onError(error);return null}).finally(()=>this.pending.delete(name));
  this.pending.set(name,job);return job;
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
  for(const file of files){if(remove<=0)break;if(!file||file.name===keep||this.pending.has(file.name))continue;try{await this.io.unlink(path.join(this.root,file.name));remove--}catch{}}
 }
}
module.exports={PortraitFiles};
