import test from 'node:test';
import assert from 'node:assert/strict';
import {SectionLoader,readSection} from '../../frontend/section-loader.ts';

test('section queue isolates failure, bounds requests and discards old navigation results',async()=>{
 const originalFetch=globalThis.fetch,originalDocument=globalThis.document;
 const requests=[],drawn=[];
 const target=()=>({textContent:'',setAttribute(){},append(_space,button){this.button=button;}});
 globalThis.document={createElement:()=>({addEventListener(_event,fn){this.click=fn;}})};
 globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,signal:options.signal,resolve}));
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const loader=new SectionLoader(),first=target(),failed=target(),next=target();
 try {
 loader.enqueue('summary',first,v=>drawn.push(v));loader.enqueue('chart',failed,v=>drawn.push(v));
 assert.equal(requests.length,1);
 requests[0].resolve(Response.json({pageviews:12}));await tick();assert.equal(requests.length,2);assert.deepEqual(drawn,[{pageviews:12}]);
 requests[1].resolve(Response.json({message:'Unavailable'},{status:503}));await tick();assert.equal(failed.textContent,'Unavailable');assert.equal(requests.length,2);
 failed.button.click();await tick();assert.equal(requests.length,3);
 loader.reset();assert.equal(requests[2].signal.aborted,true);
 loader.enqueue('new-scope',next,v=>drawn.push(v));
 requests[2].resolve(Response.json({stale:true}));await tick();assert.equal(requests.length,4);
 requests[3].resolve(Response.json({scope:'new'}));await tick();assert.deepEqual(drawn,[{pageviews:12},{scope:'new'}]);
 loader.stop();assert.equal(requests[3].signal.aborted,true);
 } finally {loader.stop();globalThis.fetch=originalFetch;globalThis.document=originalDocument;}
});

import {sectionStream} from '../src/section-stream.ts';
test('report progress preserves exact results and incomplete streams fail without rendering totals',async()=>{
 let calls=0,progress=0;
 const sql={all:async()=>{calls++;return [{pageviews:12}];},run:async()=>{throw Error('read only');}};
 const response=sectionStream(sql,new AbortController().signal,async read=>Response.json(await read.all('SELECT totals')));
 assert.deepEqual(await readSection(response,()=>progress++),[{pageviews:12}]);
 assert.equal(calls,1);assert.equal(progress,2);
 await assert.rejects(()=>readSection(new Response('{"state":"pending"}\n'),()=>{}),/before completion/);
 const failed=sectionStream(sql,new AbortController().signal,async()=>{throw Error('private query details');});
 await assert.rejects(()=>readSection(failed,()=>{}),/could not complete/);
 let resume;
 const waiting=new Promise(r=>resume=r);
 const cancelled=sectionStream(sql,new AbortController().signal,async read=>{await waiting;await read.all('not executed');return Response.json({});});
 await cancelled.body.cancel();resume();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});

test('completed-statement progress permits long sections but silence still aborts',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const native=globalThis.fetch,doc=globalThis.document;
 let controller,requestSignal,rendered;
 globalThis.document={createElement:()=>({addEventListener(){}})};
 globalThis.fetch=async(_path,options)=>{
  requestSignal=options.signal;
  return new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'Content-Type':'application/x-ndjson'}});
 };
 const target={textContent:'',setAttribute(){},append(){}};
 const tick=()=>new Promise(r=>setImmediate(r));
 const frame=value=>controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));
 const loader=new SectionLoader();
 try {
  loader.enqueue('summary',target,v=>rendered=v);await tick();
  for(let i=0;i<3;i++){t.mock.timers.tick(20000);assert.equal(requestSignal.aborted,false);frame({state:'pending',statements:i});await tick();}
  assert.equal(rendered,undefined);
  frame({state:'complete',value:{pageviews:12}});await tick();assert.deepEqual(rendered,{pageviews:12});
  loader.enqueue('stalled',target,()=>{});await tick();t.mock.timers.tick(30000);assert.equal(requestSignal.aborted,true);
 }finally{loader.stop();globalThis.fetch=native;globalThis.document=doc;controller.close();}
});

test('a stalled SQL wait ends explicitly and never starts the next query',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;
 const sql={all:()=>{calls++;return new Promise(()=>{});},run:async()=>{}};
 const stream=sectionStream(sql,new AbortController().signal,async read=>{
  await read.all('stalled');await read.all('must not execute');return Response.json({});
 });
 const verdict=assert.rejects(()=>readSection(stream,()=>{}),/query took too long/);
 t.mock.timers.tick(25000);await verdict;assert.equal(calls,1);
});

test('render errors remain retryable when partial rendering replaces the status node',async()=>{
 const native=globalThis.fetch,doc=globalThis.document;
 let attempts=0,drawn;
 const parent={isConnected:true,child:null,replaceChildren(node){this.child=node;node.isConnected=true;}};
 const target={parentElement:parent,isConnected:true,textContent:'',setAttribute(){},append(_space,button){this.button=button;}};
 parent.child=target;
 globalThis.fetch=async()=>Response.json({completions:2});
 globalThis.document={createElement:()=>({addEventListener(_event,fn){this.click=fn;}})};
 const loader=new SectionLoader(),tick=()=>new Promise(r=>setImmediate(r));
 try{
  loader.enqueue('goals',target,value=>{if(++attempts===1){parent.child=null;target.isConnected=false;throw Error('Incomplete section metadata');}drawn=value;});
  await tick();
  assert.equal(parent.child,target,'The error and Retry must remain attached to the visible section');
  assert.equal(target.textContent,'Incomplete section metadata');
  target.button.click();await tick();assert.deepEqual(drawn,{completions:2});
 }finally{loader.stop();globalThis.fetch=native;globalThis.document=doc;}
});
