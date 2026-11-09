const https=require('node:https');
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
 constructor({load=fetchPortrait,decode,now=Date.now,limit=32}){
  this.load=load;this.decode=decode;this.now=now;this.limit=limit;this.cache=new Map();this.pending=new Map();
 }
 async get(uid,{kind='chat',avatarPath=''}={}){
  const key=portraitPath(uid,kind,avatarPath);if(!key)return null;
  const hit=this.cache.get(key);if(hit&&hit.until>this.now())return hit.image;
  if(this.pending.has(key))return this.pending.get(key);
  // Fail open to a normal text toast rather than delaying an alert burst.
  if(this.pending.size>=4)return hit?.image||null;
  const job=(async()=>{
   let image=null;try{const bytes=await this.load(uid,key);if(bytes?.length&&bytes.length<=262144)image=await this.decode(bytes)}catch{}
   this.cache.delete(key);this.cache.set(key,{image,until:this.now()+(image?86400000:300000)});
   while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);
   return image;
  })();
  this.pending.set(key,job);
  try{return await job}finally{this.pending.delete(key)}
 }
}
module.exports={PortraitCache,fetchPortrait,portraitPath};
