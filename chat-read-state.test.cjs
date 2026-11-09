const{test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('renderer-state-policy.js','utf8'),context);const{reconcileRecentReadState:reconcile,markChatRoomRead:read}=context.module.exports;
test('member bulk read clears all that member rooms only, including rooms outside recent',()=>{const {markMemberChatRoomsRead:all}=context.module.exports;const unread=new Set(['1:alice','1:bob','99:alice']);const next=all(unread,'alice');assert.deepEqual([...next],['1:bob']);assert.equal(unread.size,3);assert.equal(all(next,'').size,1);const fresh=reconcile([{id:15,session_id:1,target_uid:'alice'}],new Map([['1:alice','10']]),next,{baselineReady:true});assert(fresh.unreadKeys.has('1:alice'));});
test('reading one member/session clears only the shared room and survives snapshots/restart',()=>{
 const a='1:alice',b='1:bob',c='2:alice';let s={knownIds:new Map([[a,'10'],[b,'11'],[c,'12']]),unreadKeys:new Set([a,b,c])};
 s=read(a,'10',s.knownIds,s.unreadKeys);assert(!s.unreadKeys.has(a));assert(s.unreadKeys.has(b)&&s.unreadKeys.has(c));
 s=reconcile([{session_id:1,target_uid:'alice',id:9}],s.knownIds,s.unreadKeys,{baselineReady:true});assert(!s.unreadKeys.has(a));assert.equal(s.knownIds.get(a),'10');
 s=reconcile([{session_id:1,target_uid:'alice',id:10}],new Map(JSON.parse(JSON.stringify([...s.knownIds]))),new Set([...s.unreadKeys]),{baselineReady:true});assert(!s.unreadKeys.has(a));
 s=reconcile([{session_id:1,target_uid:'alice',id:13}],s.knownIds,s.unreadKeys,{baselineReady:true});assert(s.unreadKeys.has(a));
 const stale=read(a,'10',s.knownIds,s.unreadKeys);assert(stale.unreadKeys.has(a));
});
test('new messages in a visible shared member view clear an existing unread marker',()=>{
 const s=reconcile([{session_id:1,target_uid:'alice',id:12}],new Map([['1:alice','10']]),new Set(['1:alice']),{baselineReady:true,isBeingRead:()=>true});assert(!s.unreadKeys.has('1:alice'));assert.equal(s.knownIds.get('1:alice'),'12');
});
test('historical first load remains a baseline, not all unread',()=>{const s=reconcile([{session_id:1,target_uid:'alice',id:100}],new Map(),new Set());assert.equal(s.unreadKeys.size,0)});
