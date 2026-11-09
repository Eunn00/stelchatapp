const{test}=require('node:test'),assert=require('node:assert/strict');
const{PortraitCache,portraitPath}=require('./notification-portraits.cjs');
const uid='a'.repeat(32);
test('regular app notification portraits only use the member CHZZK endpoint',()=>{
 assert.equal(portraitPath(uid,'chat'),'/api/profile-images/'+uid);
 assert.equal(portraitPath(uid,'live'),'/api/profile-images/'+uid);
 assert.equal(portraitPath('invalid','chat'),null);
 assert.equal(portraitPath(uid,'unsupported'),null);
});
test('portrait requests deduplicate, cache and retry failed loads after backoff',async()=>{
 let now=1000,count=0;
 const image={portrait:true},cache=new PortraitCache({load:async()=>{count++;return Buffer.from('image')},decode:async()=>image,now:()=>now});
 assert.deepEqual(await Promise.all([cache.get(uid),cache.get(uid)]),[image,image]);assert.equal(count,1);
 assert.equal(await cache.get(uid,{kind:'live'}),image);assert.equal(count,1);
 now+=86400001;await cache.get(uid);assert.equal(count,2);
 const failed=new PortraitCache({load:async()=>{count++;return null},decode:async()=>image,now:()=>now});
 await failed.get(uid);const before=count;await failed.get(uid);assert.equal(count,before);
 now+=300001;await failed.get(uid);assert.equal(count,before+1);
});
