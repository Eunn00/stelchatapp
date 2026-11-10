const https=require('node:https');
const{withDeadline}=require('./portrait-deadline.cjs');
function portraitPath(uid,kind='chat',avatarPath=''){
 if(!/^[a-f0-9]{32}$/.test(uid))return null;
 if(kind==='chat'||kind==='live')return '/api/profile-images/'+uid;
 return null;
}
function fetchPortrait(uid,sourcePath='/api/profile-images/'+uid){
 return new Promise(resolve=>{
  if(!/^[a-f0-9]{32}$/.test(uid)||sourcePath!=='/api/profile-images/'+uid){resolve(null);return}
  let finished=false,timer,request;
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value)};
  request=https.get('https://stelchat.xyz'+sourcePath,{headers:{'User-Agent':'StelChat-PC-Notification'}},response=>{
   if(response.statusCode!==200||!String(response.headers['content-type']||'').startsWith('image/')||Number(response.headers['content-length']||0)>262144){response.destroy();finish(null);return}
   let size=0;const parts=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>262144){request.destroy();finish(null)}else parts.push(chunk)});
   response.on('end',()=>finish(Buffer.concat(parts)));response.on('error',()=>finish(null));
  });
  timer=setTimeout(()=>{request.destroy();finish(null)},1500);
  request.on('error',()=>finish(null));
 });
}
class PortraitCache{
 constructor({load=fetchPortrait,decode,now=Date.now,limit=32,timeoutMs=2200,onTimeout=()=>{}}){
  Object.assign(this,{load,decode,now,limit,timeoutMs,onTimeout});this.cache=new Map();this.pending=new Map();this.lastGood=new Map();
 }
 async get(uid,{kind='chat',avatarPath=''}={}){
  const key=portraitPath(uid,kind,avatarPath);if(!key)return null;
  const owner=uid+(['tweet','space'].includes(kind)?':x':':chzzk');
  const previous=this.lastGood.get(owner)||null;
  const hit=this.cache.get(key);if(hit&&hit.until>this.now())return hit.image||previous;
  if(this.pending.has(key))return this.pending.get(key);
  if(this.pending.size>=4)return hit?.image||previous;
  const job=(async()=>{
   const image=await withDeadline(async()=>{
    const bytes=await this.load(uid,key);
    return bytes?.length&&bytes.length<=262144?await this.decode(bytes):null;
   },this.timeoutMs,null,this.onTimeout);
   if(image){this.lastGood.delete(owner);this.lastGood.set(owner,image);while(this.lastGood.size>this.limit)this.lastGood.delete(this.lastGood.keys().next().value)}
   const fallback=image||previous;
   this.cache.delete(key);this.cache.set(key,{image:fallback,until:this.now()+(image?86400000:300000)});
   while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);
   return fallback;
  })();
  this.pending.set(key,job);
  try{return await job}finally{this.pending.delete(key)}
 }
}
module.exports={PortraitCache,fetchPortrait,portraitPath};
