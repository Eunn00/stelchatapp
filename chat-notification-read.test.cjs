const{test}=require('node:test'),assert=require('node:assert/strict');
const{chatReadRooms,isChatRead,mergeReadRooms}=require('./chat-notification-read.cjs');
const a='a'.repeat(32),b='b'.repeat(32);
test('read boundary only dismisses older messages for the same member and room',()=>{
 const marks=new Map();mergeReadRooms(marks,chatReadRooms([{id:'10'}],a,1));
 assert(isChatRead({uid:a,session_id:1,id:9},marks));
 assert(!isChatRead({uid:a,session_id:1,id:11},marks));
 assert(!isChatRead({uid:b,session_id:1,id:9},marks));
 assert(!isChatRead({uid:a,session_id:2,id:9},marks));
 mergeReadRooms(marks,chatReadRooms([{id:8}],a,1));assert.equal(marks.get('1:'+a),'10');
});
test('large read markers retain precision and reject malformed room values',()=>{
 const rooms=chatReadRooms([{id:'90071992547409930'},{id:'90071992547409931'}],a,1);
 assert.equal(rooms[0].through_id,'90071992547409931');
 assert.deepEqual(chatReadRooms([{id:1}],'bad',1),[]);
});
