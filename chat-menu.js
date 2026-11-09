(() => {
function installChatMenu(){
  const toggle=document.querySelector('#chat-menu-toggle'),submenu=document.querySelector('#chat-submenu');
  const group=document.querySelector('#chat-nav-group');
  submenu.hidden=false;submenu.inert=true;
  let last='member';
  group.setAttribute('role','group');group.setAttribute('aria-label','채팅');
  function expand(value){group.classList.toggle('expanded',value);submenu.inert=!value;toggle.setAttribute('aria-expanded',String(value));toggle.setAttribute('aria-label',value?'채팅 메뉴 접기':'채팅 메뉴 펼치기');}
  function mark(){const selected=!!submenu.querySelector('[data-tab].active');toggle.classList.remove('active');group.classList.toggle('active',selected);}
  toggle.addEventListener('click',()=>{
    const open=toggle.getAttribute('aria-expanded')!=='true';expand(open);
    if(open&&!submenu.querySelector('[data-tab].active'))submenu.querySelector(`[data-tab="${last}"]`).click();
    mark();
  });
  for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
    if(submenu.contains(button))last=button.dataset.tab;else expand(false);
    mark();
  });
}
installChatMenu();
})();
