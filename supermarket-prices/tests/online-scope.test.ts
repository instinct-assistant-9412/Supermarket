import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { configuredSources } from '../src/downloader/registry.js';
import { openStorage } from '../src/db/storage.js';
import { ingestSource } from '../src/ingest/ingest.js';
import { MemoryRepository } from '../src/ingest/memoryRepository.js';
import { PriceService } from '../src/service.js';
import { createApp } from '../src/api/app.js';
import { MockSource, gtin13, priceXml, storesXml } from './helpers.js';
const chain='7290027600007', code=gtin13('729001000001'), physical=gtin13('729001000002');
const config=loadConfig({});
const time=new Date('2026-10-08T06:00:00Z');
function source(){
 const s=new MockSource('shufersal','שופרסל');
 s.add(`Stores${chain}-000-20261008-0500.xml`,'stores',chain,'000',null,time,storesXml(chain,[{sub:'2',id:'413',name:'ONLINE',city:'',address:'',type:2},{sub:'1',id:'1',name:'תלפיות',city:'',address:'',type:1}]));
 s.add(`PriceFull${chain}-001-413-20261008-0600.gz`,'pricefull',chain,'001','413',time,priceXml(chain,'1','413',[{code,name:'חלב תנובה',price:8}]));
 s.add(`PriceFull${chain}-001-001-20261008-0600.gz`,'pricefull',chain,'001','001',time,priceXml(chain,'1','1',[{code,name:'חלב תנובה',price:1},{code:physical,name:'מוצר פיזי בלבד',price:2}]));
 return s;
}
describe('production online scope',()=>{
 it('defaults to the four requested chains; legacy mode is explicit',()=>{
  expect(config.onlineOnly).toBe(true);
  expect(configuredSources({userAgent:'test'}).map(s=>s.key)).toEqual(['rami-levy','carrefour','shufersal','victory']);
  expect(loadConfig({ONLINE_ONLY:'false'}).onlineOnly).toBe(false);
 });
 it('canonicalizes Shufersal sub-chain and writes no physical store',async()=>{
  const repo=new MemoryRepository();
  const sum=await ingestSource(repo,source(),{config,onlineOnly:true,now:()=>time});
  expect(sum.failures).toEqual([]);expect(sum.filesIngested).toBe(1);
  expect(sum.runs[0]?.storeId).toBe('2-413');expect(repo.stores.size).toBe(1);
 });
 it('reports missing online metadata, never uses a physical fallback',async()=>{
  const s=new MockSource('victory','ויקטורי');
  const sum=await ingestSource(new MemoryRepository(),s,{config,onlineOnly:true});
  expect(sum.filesIngested).toBe(0);expect(sum.failures[0]?.file).toBe('online-store-selection');
 });
 it('hides old physical prices everywhere, keeps them in the database',async()=>{
  const storage=await openStorage({...config,sqlitePath:':memory:'});
  try {
   await storage.migrate();
   await ingestSource(storage.repo,source(),{config,now:()=>time}); // simulate an existing mixed database
   const service=new PriceService(storage.repo);
   const hits=await service.searchProducts('חלב תנובה');expect(hits[0]).toMatchObject({minPrice:8,maxPrice:8,chains:1});
   expect(await service.searchProducts('מוצר פיזי בלבד')).toEqual([]);
   const history=await service.priceHistory({gtin:code},{});expect(history?.points.map(p=>p.price)).toEqual([8]);
   expect((await service.cheapestBasket([{gtin:code}],{online:false})).stores[0]).toMatchObject({isOnline:true,total:8});
   expect((await service.listStores({})).every(s=>s.isOnline)).toBe(true);
   expect((await service.freshness()).find(c=>c.chainId===chain)).toMatchObject({stores:1,currentPrices:1});
   const app=createApp(service,config);
   const res=await app.request('/products/search?q='+encodeURIComponent('חלב תנובה'));expect((await res.json()).results[0].minPrice).toBe(8);
  }finally{await storage.close();}
 });
});
