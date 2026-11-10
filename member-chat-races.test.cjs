const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const base=fs.existsSync('public/desktop/renderer.js')?'public/desktop/':'';
const source=fs.readFileSync(base+'renderer.js','utf8');
function declaration(name){
 const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
 assert(start>=0,name);const end=source.indexOf('\n}',start)+2;
 return source.slice(start,end);
}
function harness(){
 const requests=[],previews=[],renders=[];
 const context=vm.createContext({console,document:{querySelector:()=>({click(){}})},
  renderMemberSessions:()=>renders.push(vm.runInContext('({uid:state.selectedMemberUid,owner:state.memberSessionsOwnerUid,ids:state.memberSessions.map(s=>s.id)})',context)),
  memberPreviewStateKey:(id,uid)=>`${id}:${uid}`,
  acknowledgeChatMessages:()=>{},chatRoomIsVisible:()=>false,
  window:{stelchat:{memberSessions:uid=>new Promise(resolve=>requests.push({uid,resolve})),
   sessionPreview:(id,uid)=>new Promise(resolve=>previews.push({id,uid,resolve})),acknowledgeNotifications:async()=>{}}}});
 vm.runInContext(fs.readFileSync(base+'realtime-merge-policy.js','utf8'),context);
 context.window.stelchatRealtimeMerge=context.stelchatRealtimeMerge;
 vm.runInContext(source.slice(source.indexOf('const state ='),source.indexOf('const RECENT_UNREAD_STORAGE_KEY')),context);
 vm.runInContext(['selectChatMember','loadMemberSessions','expandMemberSession'].map(declaration).join('\n'),context);
 const route=source.slice(source.indexOf('window.openChatNotification=async route=>{'),source.indexOf('\n};',source.indexOf('window.openChatNotification=async route=>{'))+3);
 vm.runInContext(route,context);
 vm.runInContext(`state.streamers=[{uid:'a'},{uid:'b'},{uid:'c'}];selectChatMember('a');state.memberSessions=[{id:1,message_count:2}];state.memberSessionsLoadedUid='a';`,context);
 return {context,requests,previews,renders,run:code=>vm.runInContext(code,context)};
}

test('notification navigation drops another member list before its request resolves',async()=>{
 const h=harness();const route=h.run(`window.openChatNotification({uid:'b',session_id:'2',event_key:'test'})`);
 assert.equal(h.run('state.memberSessionsOwnerUid'),'b');assert.equal(h.run('state.memberSessions.length'),0);
 assert(h.renders.every(r=>r.owner===r.uid));
 h.requests[0].resolve([{id:2,message_count:1}]);await new Promise(setImmediate);
 assert.equal(h.previews[0].uid,'b');h.previews[0].resolve({messages:[{id:20,sent_at:'2026-11-11T00:00:00'}]});await route;
 assert.equal(h.run('state.memberSessions.map(s=>s.id).join()'),'2');
 assert.equal(h.run(`state.memberPreviews.get('2:b').messages.length`),1);
});

test('late A response cannot overwrite B or a fresh A selection',async()=>{
 const h=harness();const old=h.run(`loadMemberSessions('a',true)`);
 h.run(`selectChatMember('b')`);h.run(`selectChatMember('a')`);
 const fresh=h.run(`loadMemberSessions('a',true)`);
 h.requests[1].resolve([{id:9,message_count:2}]);await fresh;
 h.requests[0].resolve([{id:1,message_count:2}]);await old;
 assert.equal(h.run('state.memberSessions[0].id'),9);
 assert.equal(h.run('state.memberSessionsLoading'),false);
});

test('another selection during notification navigation cannot expand its room',async()=>{
 const h=harness();const route=h.run(`window.openChatNotification({uid:'b',session_id:'1'})`);
 h.run(`selectChatMember('c')`);const current=h.run(`loadMemberSessions('c',true)`);
 h.requests[1].resolve([{id:1,message_count:1}]);await current;
 h.requests[0].resolve([{id:1,message_count:1}]);await route;
 assert.equal(h.previews.length,0);assert.equal(h.run('state.selectedMemberUid'),'c');
});

test('an empty response with a known positive count is retryable, never a permanent empty cache',async()=>{
 const h=harness();const first=h.run(`expandMemberSession(state.memberSessions[0])`);
 h.previews[0].resolve({messages:[]});await first;
 assert.equal(h.run(`state.memberPreviews.get('1:a').error`),true);
 const second=h.run(`expandMemberSession(state.memberSessions[0])`);
 assert.equal(h.previews.length,2);h.previews[1].resolve({messages:[{id:1,sent_at:'2026-11-11T00:00:00'}]});await second;
 assert.equal(h.run(`state.memberPreviews.get('1:a').messages.length`),1);
});

test('background refresh retries a failed expanded preview and rejects foreign member requests',async()=>{
 const h=harness();h.run(`state.expandedMemberSessionId=1;state.memberPreviews.set('1:a',{messages:[],error:true});`);
 const refresh=h.run(`loadMemberSessions('a',true,true)`);h.requests[0].resolve([{id:1,message_count:2}]);await refresh;
 assert.equal(h.previews.length,1);h.previews[0].resolve({messages:[{id:1,sent_at:'2026-11-11T00:00:00'}]});
 await h.run(`loadMemberSessions('b',true)`);assert.equal(h.requests.length,1);
});
