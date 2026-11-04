// Read-only public hosting diagnostic. No credentials, writes or deployment.
import { lookup } from 'node:dns/promises';
const hosts=['ilac-takip-yeni-test.pages.dev','aba733f4.ilac-takip-yeni-test.pages.dev'];
let canonicalOK=false;
for(const host of hosts){
  try{
    const addresses=await lookup(host,{all:true});
    const response=await fetch('https://'+host+'/',{signal:AbortSignal.timeout(20000)});
    const body=await response.text();
    const app=response.ok&&body.includes('id="app"')&&body.includes('src/main.js');
    console.log(JSON.stringify({host,dns:addresses.map(a=>a.address),status:response.status,finalURL:response.url,appHTML:app}));
    if(host===hosts[0])canonicalOK=app;
  }catch(error){console.log(JSON.stringify({host,error:error.code||error.cause?.code||error.name}));}
}
if(!canonicalOK)process.exitCode=1;
