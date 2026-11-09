const{test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const{windowsToast}=require('./windows-toast.cjs');
test('Windows toast explicitly uses a local circular member portrait and silent audio',()=>{
 const xml=windowsToast('유니 & 친구','<채팅> "내용"',path.resolve('profile.png'));
 assert.match(xml,/placement="appLogoOverride" hint-crop="circle"/);
 assert.match(xml,/src="file:\/\//);assert.match(xml,/유니 &amp; 친구/);
 assert.match(xml,/&lt;채팅&gt; &quot;내용&quot;/);assert.match(xml,/<audio silent="true"/);
 assert(!windowsToast('제목','본문').includes('<image'));
});
