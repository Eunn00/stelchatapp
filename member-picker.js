(() => {
// Keep the shared select/change flow as the data source; mobile owns presentation.
function installMemberPicker(){
  const select=document.querySelector('#member-chat-select');
  const trigger=document.createElement('button');trigger.type='button';trigger.id='mobile-member-trigger';
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  select.hidden=true;select.after(trigger);
  document.querySelector('label[for="member-chat-select"]')?.setAttribute('for','mobile-member-trigger');
  const dialog=document.createElement('dialog');dialog.className='mobile-member-picker';
  dialog.innerHTML='<header><strong id="member-picker-title">멤버 선택</strong><button type="button" aria-label="멤버 선택 닫기">×</button></header><div class="mobile-member-choices"></div>';
  dialog.setAttribute('aria-labelledby','member-picker-title');document.body.append(dialog);
  const list=dialog.querySelector('.mobile-member-choices');
  function decorate(button,option){
    const members=window.stelchat?.memberProfiles?.()||(typeof state!=='undefined'?state.streamers:[]);
    const member=members.find(m=>m.uid===option?.value),path=member?.avatar_url||'';
    if(/^\/api\/profile-images\/[a-f0-9]{32}\?v=[a-f0-9]{12}$/.test(path)){
      const image=document.createElement('img');image.src='https://stelchat.xyz'+path;image.alt='';image.loading='lazy';image.draggable=false;image.className='mobile-picker-avatar';button.prepend(image);
    }
    if(option?.dataset.unread==='true'){
      const dot=document.createElement('span');dot.className='chat-unread-indicator';dot.setAttribute('aria-label','읽지 않은 채팅 있음');button.append(dot);
    }
  }
  function render(){
    trigger.textContent=(select.selectedOptions[0]?.textContent||'멤버 선택')+' ▾';
    decorate(trigger,select.selectedOptions[0]);
    list.replaceChildren();
    for(const option of select.options){
      const button=document.createElement('button');button.type='button';button.textContent=option.textContent;
      decorate(button,option);
      button.classList.toggle('selected',option.value===select.value);button.setAttribute('aria-pressed',String(option.value===select.value));
      button.addEventListener('click',()=>{
        if(select.value!==option.value){select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
        render();dialog.close();
      });list.append(button);
    }
  }
  trigger.addEventListener('click',()=>{render();dialog.showModal();trigger.setAttribute('aria-expanded','true');list.querySelector('.selected')?.focus();});
  dialog.querySelector('header button').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');trigger.focus();});
  select.addEventListener('change',render);
  document.addEventListener('stelchat-members-updated',render);
  new MutationObserver(render).observe(select,{childList:true,subtree:true,attributes:true});
  window.closeMobileMemberPicker=()=>{if(!dialog.open)return false;dialog.close();return true;};
  render();
}
installMemberPicker();
})();
