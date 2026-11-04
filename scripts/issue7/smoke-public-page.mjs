// Fresh, empty browser profiles; no medication, permission or subscription writes.
import { chromium, devices } from 'playwright';
const url='https://ilac-takip-yeni-test.pages.dev/';
const browser=await chromium.launch({headless:true});
try {
  for(const notificationAPI of ['native','absent']){
    const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
    // Model actual API absence; defining an existing undefined property would
    // incorrectly make legacy `in window` feature detection report support.
    if(notificationAPI==='absent')await context.addInitScript(()=>{delete window.Notification;});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin&&route.request().method()==='GET'?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>typeof openAddModal==='function'&&typeof renderAll==='function',{},{timeout:15000});
    await page.waitForTimeout(1500);
    if(!response.ok()||errors.length)throw Error(JSON.stringify({notificationAPI,status:response.status(),errors}));
    await page.locator('[data-tab="ilaclar"]').click();await page.locator('#add-drug-fab').click();
    if(!await page.locator('#drug-name').isVisible())throw Error('Medication editor is not visible');
    console.log(JSON.stringify({notificationAPI,url:page.url(),status:response.status(),appBoot:true,editorVisible:true,pageErrors:errors}));
    await context.close();
  }
}finally{await browser.close();}
