const uidPattern=/^[a-f0-9]{32}$/,idPattern=/^[1-9][0-9]{0,19}$/;
function chatReadRooms(messages,uid='',sessionId=null){
  const marks=new Map();
  for(const message of messages||[]){
    const target=message.target_uid||uid,sid=String(message.session_id??sessionId??''),id=String(message.id??'');
    if(!uidPattern.test(target)||!idPattern.test(sid)||!idPattern.test(id))continue;
    const key=sid+':'+target,old=marks.get(key);
    if(!old||BigInt(id)>BigInt(old.through_id))marks.set(key,{uid:target,session_id:sid,through_id:id});
  }
  return [...marks.values()];
}
function isChatRead(message,marks){
  if(!message||!uidPattern.test(message.uid)||!idPattern.test(String(message.id)))return false;
  const through=marks.get(String(message.session_id)+':'+message.uid);
  return idPattern.test(String(through))&&BigInt(message.id)<=BigInt(through);
}
function mergeReadRooms(marks,rooms){
  for(const room of rooms){
    const key=room.session_id+':'+room.uid,old=marks.get(key);
    if(!old||BigInt(room.through_id)>BigInt(old))marks.set(key,room.through_id);
  }
  while(marks.size>2000)marks.delete(marks.keys().next().value);
}
module.exports={chatReadRooms,isChatRead,mergeReadRooms};
