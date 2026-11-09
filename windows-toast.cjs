const{pathToFileURL}=require('node:url');
function escape(value){return String(value||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}
function windowsToast(title,body,portraitPath){
 const image=portraitPath?`<image placement="appLogoOverride" hint-crop="circle" src="${escape(pathToFileURL(portraitPath).href)}"/>`:'';
 return `<toast duration="short"><visual><binding template="ToastGeneric">${image}<text>${escape(title)}</text><text>${escape(body)}</text></binding></visual><audio silent="true"/></toast>`;
}
module.exports={windowsToast};
