/** Deadlines are enforced in Electron's main process, not the page being decoded. */
function withDeadline(work,ms,fallback=null,onTimeout=()=>{}){
 return new Promise(resolve=>{
  let finished=false;
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value)};
  const timer=setTimeout(()=>{try{onTimeout()}catch{}finish(fallback)},ms);
  Promise.resolve().then(()=>typeof work==='function'?work():work).then(finish,()=>finish(fallback));
 });
}
async function preparePortrait(uid,options,{cache,files,onTimeout=()=>{},timeoutMs=3000}){
 const kind=options?.kind||'chat';
 const previous=await withDeadline(()=>files.latest(uid,kind),Math.min(200,timeoutMs),null,onTimeout);
 return withDeadline(async()=>{
  const image=await cache.get(uid,options);
  if(!image)return previous;
  return await files.get(uid,image,kind)||previous;
 },timeoutMs,previous,onTimeout);
}
function boundedDecoder(limit=2){
 let active=0;
 return async work=>{if(active>=limit)return null;active++;try{return await work()}finally{active--}};
}
module.exports={withDeadline,preparePortrait,boundedDecoder};
