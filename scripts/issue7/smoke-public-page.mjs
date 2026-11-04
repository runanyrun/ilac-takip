// Fresh, empty browser profile; no medication, permission or subscription writes.
import { chromium, devices } from 'playwright';
const url='https://ilac-takip-yeni-test.pages.dev/';
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  await context.addInitScript(()=>Object.defineProperty(window,'Notification',{value:undefined,configurable:true}));
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin&&route.request().method()==='GET'?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>typeof openAddModal==='function'&&typeof renderAll==='function',{},{timeout:15000});
  if(!response.ok()||errors.length)throw Error(JSON.stringify({status:response.status(),errors}));
  await page.locator('[data-tab="ilaclar"]').click();await page.locator('#add-drug-fab').click();
  if(!await page.locator('#drug-name').isVisible())throw Error('Medication editor is not visible');
  console.log(JSON.stringify({url:page.url(),status:response.status(),appBoot:true,editorVisible:true,pageErrors:errors}));
  await context.close();
}finally{await browser.close();}
