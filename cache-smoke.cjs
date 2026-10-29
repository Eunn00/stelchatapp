// Isolated local integration run; never shares real app settings or enables alerts.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'stelchat-cache-ui-'));
app.setPath('userData',root);app.setLoginItemSettings=()=>{};
process.env.STELCHAT_UPDATE_PREVIEW='1';
const originalFetch=global.fetch;let downloads=0,offline=false;
global.fetch=(url,options)=>{
 if(String(url).startsWith('https://stelchat.xyz/emoji-assets/')){downloads++;if(offline)throw Error('offline test');}
 return originalFetch(url,options);
};
require('./main.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 try{
  await delay(3000);const win=BrowserWindow.getAllWindows()[0];
  for(let i=0;i<20;i++){if(await win.webContents.executeJavaScript('Boolean(window.stelchat && document.querySelector("#emoji-cache-clear"))'))break;await delay(500);}
  const seed=await originalFetch('https://stelchat.xyz/api/emoji-seed').then(r=>r.json());const name=Object.values(seed)[0];
  const ready=await originalFetch('https://stelchat.xyz/api/emoji-ready?files='+name).then(r=>r.json());
  const actual=Object.values(ready.ready)[0].split('/').pop();
  const load=`new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth);i.onerror=()=>resolve(0);i.src=window.stelchat.emojiCacheUrl(${JSON.stringify(actual)});document.body.append(i);})`;
  assert.ok(await win.webContents.executeJavaScript(load));assert.equal(downloads,1);
  offline=true;assert.ok(await win.webContents.executeJavaScript(load));assert.equal(downloads,1);
  await win.webContents.executeJavaScript('document.querySelector("#settings-button").click()');await delay(200);
  assert.ok((await win.webContents.executeJavaScript('window.stelchat.emojiCacheStats()')).bytes>0);
  await win.webContents.executeJavaScript('window.stelchat.emojiCacheClear()');
  assert.equal((await win.webContents.executeJavaScript('window.stelchat.emojiCacheStats()')).bytes,0);
  console.log('PASS Electron: real image, protocol/CSP, offline cache hit, stats, clear; profile '+root);
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
