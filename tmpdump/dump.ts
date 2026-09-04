import { PROPOSED_POST_POSITIONS, postObservationFeet } from "@/lib/electrical-grid-post-geometry";
console.log(PROPOSED_POST_POSITIONS.map(p=>`${p.ref} ${p.wall}${p.corner?"*":""} ${p.xFt},${p.yFt} ${p.gridCell}`).join("\n"));
for (const [a,b] of [["05SE","06SE"],["06SE","07SE"],["26NE","01NE"],["01NE","01NE"],["19NW","06SE"]] as const)
  console.log(a,b,JSON.stringify(postObservationFeet({pole_location_kind:"BETWEEN_POSTS",pole_ref_start:a,pole_ref_end:b})?.xFt)+","+postObservationFeet({pole_location_kind:"BETWEEN_POSTS",pole_ref_start:a,pole_ref_end:b})?.yFt);
