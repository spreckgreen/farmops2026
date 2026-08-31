import { planJboxRacewayPopulation, orderedJunctionPoints } from "../src/lib/electrical-raceway-path";
import { parseHierarchicalId } from "../src/lib/electrical";
console.log(parseHierarchicalId("JB-104-01"), parseHierarchicalId("CON-104"));
const g:any={panel:[],circuit_group:[],load:[],branch:[],raceway:[{id:"r1",conduit_id:"CON-104"}],jbox:[{id:"j1",jbox_id:"JB-104-01"},{id:"j2",jbox_id:"JB-104-02"},{id:"j3",jbox_id:"JB-104-03"}]};
console.log(planJboxRacewayPopulation(g).map(p=>[p.jbox_id,p.status,p.proposed_sequence,p.evidence]));
