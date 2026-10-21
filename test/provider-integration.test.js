import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.js';
import { readConfig, createInquirySender } from '../src/contact.js';

const env = { NODE_ENV:'test', PUBLIC_ORIGIN:'http://localhost:3000', RESEND_API_KEY:'fake-test-key',
  CONTACT_FROM:'sender@example.com', CONTACT_TO:'inquiries@example.net' };
const inquiry = () => ({ name:'Alex Taylor', email:'alex@example.org', company:'Example', goal:'A campaign inquiry.',
  partner_role:'Advertiser', interest:'Lead generation', request_id:randomUUID(), website_url:'' });
const accepted = () => Response.json({id:'test-accepted-id'});

async function fixture(t, settings = env, fetchImpl = async () => assert.fail('Unexpected provider request')) {
  const server = createServer({env:settings, fetchImpl, limiter:()=>true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {base, post:(data=inquiry(),origin=env.PUBLIC_ORIGIN)=>fetch(base+'/api/contact',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)
  })};
}

test('default Resend routes configured addressing, Unicode content and Reply-To without Gmail access', async t => {
  const calls=[];
  const f=await fixture(t,{...env,GOOGLE_CLIENT_ID:'bad gmail',GMAIL_SENDER:'bad'},async (url,options)=>{
    calls.push({url,...options});return accepted();
  });
  const data={...inquiry(),name:'Zo\u00eb \ud83c\udf0d\r\nBcc: untrusted@example.net',goal:'Caf\u00e9 \u2014 inquiry',
    email:'visitor@b\u00fccher.example',from:'untrusted@example.net',to:'untrusted@example.net',provider:'gmail'};
  assert.equal((await f.post(data)).status,200);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.resend.com/emails');
  const payload=JSON.parse(calls[0].body);
  assert.equal(payload.from,env.CONTACT_FROM);assert.equal(payload.to,env.CONTACT_TO);
  assert.equal(payload.reply_to,'visitor@xn--bcher-kva.example');
  assert.equal(payload.subject,'mirel-media: advertiser inquiry');
  assert(payload.text.includes(data.goal));assert(payload.text.includes(data.name));
  assert.deepEqual(Object.keys(payload),['from','to','reply_to','subject','text']);
  assert.match(calls[0].headers['Idempotency-Key'],/^[a-f0-9]{64}$/);
  assert.equal(calls[0].redirect,'error');
});

test('invalid selected config including an unknown provider leaves site and health available', async t => {
  for(const settings of [ {...env,RESEND_API_KEY:''}, {...env,CONTACT_FROM:'invalid'}, {...env,CONTACT_TO:'bad'},
    {...env,EMAIL_PROVIDER:'gmail'}, {...env,EMAIL_PROVIDER:'unsupported-private-setting'} ]) {
    const f=await fixture(t,settings);
    assert.equal((await fetch(f.base)).status,200);
    assert.equal((await fetch(f.base+'/healthz')).status,200);
    assert.deepEqual(await (await fetch(f.base+'/api/contact/config')).json(),{enabled:false});
    const result=await f.post();assert.equal(result.status,503);
    assert.doesNotMatch(await result.text(),/fake-test|unsupported|CONTACT_|GOOGLE_|RESEND_|"ok"/);
  }
  assert.match(readConfig({...env,EMAIL_PROVIDER:'invalid'}).configurationError,/EMAIL_PROVIDER must be/);
});

test('Resend preserves origin, honeypot and field validation before network access', async t => {
  const f=await fixture(t);
  assert.equal((await f.post(inquiry(),'https://unrelated.example')).status,403);
  for(const patch of [{email:'bad\r\nBcc: test@example.net'},{goal:''},{website_url:'spam'},{request_id:'bad'}])
    assert.equal((await f.post({...inquiry(),...patch})).status,400);
});

test('Resend concurrent and repeated submissions share a result and stable payload-derived key across restarts', async () => {
  const calls=[];const config=readConfig(env);const data=inquiry();
  const options={fetchImpl:async(url,options)=>{calls.push(options);return accepted();}};
  const send=createInquirySender(config,options);
  await Promise.all([send(data),send(data),send(data)]);assert.equal(calls.length,1);
  await createInquirySender(config,options)(data);
  assert.equal(calls[0].body,calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
  for(const [patch,settings] of [[{goal:'Changed message'},env],[{email:'other@example.org'},env],
    [{}, {...env,CONTACT_FROM:'different@example.com'}],[{}, {...env,CONTACT_TO:'different@example.net'}],
    [{request_id:randomUUID()},env]]) {
    await createInquirySender(readConfig(settings),options)({...data,...patch});
    assert.notEqual(calls.at(-1).headers['Idempotency-Key'],calls[0].headers['Idempotency-Key']);
  }
});

test('Resend definite 4xx rejections are sanitized and allow explicit retry, never fallback or automatic retry', async () => {
  for(const status of [400,401,403,404,422,429]) {
    let calls=0;
    const send=createInquirySender(readConfig({...env,GOOGLE_CLIENT_ID:'also-configured'}),{fetchImpl:async url=>{
      assert.equal(url,'https://api.resend.com/emails');calls++;
      return calls===1?Response.json({name:'secret-provider-error',message:'secret-details'},{status}):accepted();
    }});
    const data=inquiry();
    await assert.rejects(send(data),error=>error.status===502&&!/secret|may have been sent/.test(error.message));
    assert.equal(calls,1);await send(data);assert.equal(calls,2);
  }
});

test('Resend conflicts, timeouts, 5xx and malformed acceptance remain uncertain and suppressed', async () => {
  for(const fail of [
    ()=>{throw new TypeError('secret-network-error');},
    ()=>Response.json({name:'concurrent_idempotent_requests'},{status:409}),
    ()=>Response.json({name:'invalid_idempotent_request'},{status:409}),
    ()=>new Response('unrecognized conflict',{status:409}),
    ()=>new Response('',{status:408}),()=>new Response('',{status:500}),()=>new Response('',{status:503}),
    ()=>new Response('{broken',{status:200}),()=>Response.json({}),()=>Response.json({id:123}),
    ()=>Response.json({id:'   '}),()=>Response.json({id:'bad\r\nid'}),()=>Response.json({id:'valid',error:'secret-error'})
  ]) {
    let calls=0;
    const send=createInquirySender(readConfig(env),{fetchImpl:async()=>{calls++;return fail();}});
    const data=inquiry();
    for(let i=0;i<2;i++) await assert.rejects(send(data),error=>error.status===502&&/may have been sent/.test(error.message)&&!/secret/.test(error.message));
    assert.equal(calls,1);
  }
});

test('Resend timeouts include response reading; suppression remains bounded and expires', async () => {
  const keepAlive=setInterval(()=>{},1000);
  try {
    for(const body of [false,true]) {
      let calls=0;
      const send=createInquirySender(readConfig(env),{sendTimeoutMs:10,fetchImpl:async(url,{signal})=>{
        calls++;const wait=()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
        return body?{ok:true,json:wait}:wait();
      }});
      const data=inquiry();
      await assert.rejects(send(data),/may have been sent/);
      await assert.rejects(send(data),/may have been sent/);assert.equal(calls,1);
    }
  } finally {clearInterval(keepAlive);}
  let now=0,calls=0;
  const send=createInquirySender(readConfig(env),{now:()=>now,maxEntries:1,retentionMs:1000,fetchImpl:async()=>{calls++;return accepted();}});
  const data=inquiry();await send(data);await send(data);
  await assert.rejects(send(inquiry()),{status:503});assert.equal(calls,1);
  now=1001;await send(data);assert.equal(calls,2);
});
