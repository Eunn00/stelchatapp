/* Images come only from StelChat's validated asset store, never from chat URLs. */
(() => {
  const valid = value => typeof value === 'string' && /^[a-f0-9]{64}\.(png|gif|webp|jpg|jpeg)$/.test(value);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let seed = {}, seedLoaded = false, checking = false, seedRetryAt = 0;
  const roots = new Map(), ready = new Map(), failed = new Set(), retryAt = new Map();
  function parts(text, refs) {
    try { if (typeof refs === 'string') refs = JSON.parse(refs); } catch { refs = {}; }
    const result = []; let end = 0, count = 0;
    for (const match of text.matchAll(/\{:([^{}]{1,200}?):\}/g)) {
      result.push({text:text.slice(end,match.index)});
      const file = (refs && Object.hasOwn(refs,match[1]) ? refs[match[1]] : undefined) || seed[match[1]];
      result.push({text:match[0],file:valid(file) && count++ < 20 ? file : null});
      end = match.index + match[0].length;
    }
    result.push({text:text.slice(end)}); return result;
  }
  function render(node, item) {
    const signature = item.visible && !document.hidden ? item.parts.map(p => p.file ? ready.get(p.file) || (failed.has(p.file) ? p.text : 'pending') : p.text).join('|') : item.text;
    if (signature === item.signature) return;
    item.signature = signature;
    node.replaceChildren();
    if (!item.visible || document.hidden) { node.textContent = item.text; return; }
    for (const p of item.parts) {
      const url = ready.get(p.file);
      if (url) {
        const img = document.createElement('img');
        img.className = 'chat-emoji'; img.width = img.height = 24;
        img.alt = img.title = p.text; img.decoding = 'async';
        img.addEventListener('error', () => { ready.delete(p.file); failed.add(p.file); retryAt.set(p.file,Date.now()+30000); repaint(); }, {once:true});
        img.src = url.startsWith('/emoji-assets/') ? 'https://stelchat.xyz'+url : url; node.append(img);
      } else node.append(document.createTextNode(p.file && !failed.has(p.file) ? '◌' : p.text));
    }
  }
  function repaint() {
    let slots = 0;
    for (const [node,item] of roots) {
      if (!node.isConnected) { observer.unobserve(node); roots.delete(node); continue; }
      const visible = item.visible;
      if (visible) { slots += item.parts.filter(p=>p.file).length; if(slots>64) item.visible=false; }
      render(node,item); item.visible=visible;
    }
  }
  async function check() {
    if (checking || document.hidden) return;
    checking = true;
    try {
      for(const [file,at] of retryAt)if(at<=Date.now()){failed.delete(file);retryAt.delete(file);}
      if (!seedLoaded && Date.now()>=seedRetryAt) {
        try{
          seed = await window.stelchat.emojiSeed(); seedLoaded = true;
          for (const item of roots.values()) { item.parts=parts(item.text,item.refs); item.signature=null; }
        }catch{seedRetryAt=Date.now()+30000;}
      }
      repaint();
      let missing = [...new Set([...roots.values()].filter(i=>i.visible).flatMap(i=>i.parts.map(p=>p.file)).filter(f=>f&&!ready.has(f)&&!failed.has(f)))].slice(0,64);
      if(missing.length && window.stelchat.emojiCacheHas){
        const cached=await window.stelchat.emojiCacheHas(missing);
        for(const file of cached)if(valid(file))ready.set(file,window.stelchat.emojiCacheUrl(file));
        missing=missing.filter(f=>!ready.has(f));repaint();
      }
      if (missing.length) {
        const response = await window.stelchat.emojiReady(missing);
        if (ready.size + failed.size > 4096) { ready.clear(); failed.clear(); }
        for (const [file,url] of Object.entries(response.ready || {}))
          if (valid(file) && /^\/emoji-assets\/[a-f0-9]{64}\.(png|gif|webp|jpg|jpeg)$/.test(url)) ready.set(file,window.stelchat.emojiCacheUrl ? window.stelchat.emojiCacheUrl(url.split('/').pop()) : url);
        for (const file of response.failed || []) if (valid(file)) {failed.add(file);retryAt.set(file,Date.now()+30000);}
        repaint();
      }
    } catch { /* Retry without interrupting chat, sound or Windows notifications. */ }
    finally { checking = false; }
  }
  const observer = new IntersectionObserver(entries => {
    for(const entry of entries) { const item=roots.get(entry.target); if(item) item.visible=entry.isIntersecting; }
    repaint(); check();
  }, {rootMargin:'40px'});
  function scan() {
    for(const node of document.querySelectorAll('.emoji-message')) if(!roots.has(node)) {
      const text=node.textContent, refs=node.dataset.emojiRefs;
      roots.set(node,{text,refs,parts:parts(text,refs),visible:false,signature:null}); observer.observe(node);
    }
    for(const [node] of roots) if(!node.isConnected) { observer.unobserve(node); roots.delete(node); }
  }
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{repaint();check();});
  setInterval(()=>{ if(roots.size) check(); },3000);
  window.stelchatEmoji = {html: (content,refs) => /\{:[^{}]+?:\}/.test(String(content ?? '')) ? `<span class="emoji-message" data-emoji-refs="${escape(typeof refs==='string'?refs:JSON.stringify(refs||{}))}">${escape(content)}</span>` : escape(content)};
})();
