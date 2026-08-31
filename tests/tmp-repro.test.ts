import { describe, it } from "vitest";
import { planJboxRacewayPopulation } from "@/lib/electrical-raceway-path";
describe("repro",()=>{it("x",()=>{
const rw=[{id:"u-con104",conduit_id:"CON-104",dest_jbox_uuid:"u-jb1"}];
const jb=[{id:"u-jb1",jbox_id:"JB-104-01"},{id:"u-jb2",jbox_id:"JB-104-02"},{id:"u-jb3",jbox_id:"JB-104-03"}];
console.log(JSON.stringify(planJboxRacewayPopulation({panel:[],circuit_group:[],load:[],raceway:rw,jbox:jb,branch:[]} as never),null,1));
})});
