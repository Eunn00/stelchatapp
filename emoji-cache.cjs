const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const VALID = /^[a-f0-9]{64}\.(png|gif|webp|jpg|jpeg)$/;
const MAX_FILE = 2 * 1024 * 1024;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
function imageType(b) {
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (/^GIF8[79]a/.test(b.subarray(0,6).toString())) return 'image/gif';
  if (b[0]===255 && b[1]===216 && b[2]===255) return 'image/jpeg';
  if (b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP') return 'image/webp';
  throw Error('Invalid image');
}
class EmojiCache {
  constructor(directory, {limit=100*1024*1024, parallel=3, fetcher=fetch}={}) {
    Object.assign(this,{directory,limit,parallel,fetcher});
    this.pending=new Map();this.failures=new Map();this.active=0;this.waiters=[];this.epoch=0;
  }
  async entries() {
    await fs.mkdir(this.directory,{recursive:true});
    const entries=[];
    for(const name of await fs.readdir(this.directory)) if(VALID.test(name)) {
      try {const s=await fs.lstat(path.join(this.directory,name));if(s.isFile())entries.push({name,size:s.size,time:s.mtimeMs});} catch {}
    }
    return entries;
  }
  async stats(){const entries=await this.entries();return {bytes:entries.reduce((n,e)=>n+e.size,0),limit:this.limit,count:entries.length};}
  async remove(name){await Promise.all([name,name+'.sha256'].map(n=>fs.unlink(path.join(this.directory,n)).catch(()=>{})));}
  async clear(){this.epoch++;this.failures.clear();for(const e of await this.entries())await this.remove(e.name);return this.stats();}
  async prune(){
    const entries=await this.entries();let size=entries.reduce((n,e)=>n+e.size,0);
    if(size<=this.limit)return;
    for(const e of entries.sort((a,b)=>a.time-b.time)){await this.remove(e.name);size-=e.size;if(size<=this.limit*.8)break;}
  }
  async cached(name){
    try {
      const file=path.join(this.directory,name), stat=await fs.lstat(file);
      if(!stat.isFile()||stat.size<12||stat.size>MAX_FILE)throw Error('Invalid cache');
      const b=await fs.readFile(file), hash=await fs.readFile(file+'.sha256','utf8');
      if(hash!==digest(b))throw Error('Corrupt cache');imageType(b);
      await fs.utimes(file,new Date(),new Date()).catch(()=>{});return b;
    }catch{await this.remove(name);return null;}
  }
  async get(name){
    if(!VALID.test(name))throw Error('Invalid filename');
    if(this.pending.has(name))return this.pending.get(name);
    const work=this.load(name).finally(()=>this.pending.delete(name));this.pending.set(name,work);return work;
  }
  async load(name){
    const epoch=this.epoch;
    if(this.active>=this.parallel)await new Promise(resolve=>this.waiters.push(resolve));
    this.active++;
    try {
      const cached=await this.cached(name);if(cached)return cached;
      if((this.failures.get(name)||0)>Date.now())throw Error('Retry later');
      const response=await this.fetcher('https://stelchat.xyz/emoji-assets/'+name,{redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok || Number(response.headers.get('content-length'))>MAX_FILE){await response.body?.cancel();throw Error('Download rejected');}
      const chunks=[];let size=0;
      for await (const chunk of response.body){size+=chunk.length;if(size>MAX_FILE)throw Error('Image too large');chunks.push(Buffer.from(chunk));}
      const bytes=Buffer.concat(chunks);imageType(bytes);
      const file=path.join(this.directory,name), temp=file+'.tmp';
      if(epoch===this.epoch)try {
        await fs.mkdir(this.directory,{recursive:true});
        await fs.writeFile(temp,bytes);await fs.rename(temp,file);
        await fs.writeFile(file+'.sha256',digest(bytes));
        if(epoch!==this.epoch)await this.remove(name);else await this.prune();
      }catch{/* Disk full must not stop image display. */}
      finally{await fs.unlink(temp).catch(()=>{});}
      return bytes;
    }catch(error){if(this.failures.size>4096)this.failures.clear();this.failures.set(name,Date.now()+30000);throw error;}
    finally{this.active--;this.waiters.shift()?.();}
  }
}
module.exports={EmojiCache,VALID,imageType};
