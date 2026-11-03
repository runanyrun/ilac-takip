// Conditional bound for the seven audited direct sites, not live telemetry.
// Caller must bound HTTP volume, enumerated devices and per-tick alarm iterations.
export function estimateAuditedPutBudget({users,devicesPerUser=1,ticksPerDay=1440,deliveryIterationsPerDevicePerTick=0,syncRequestsPerDay=0,testRequestsPerDay=0}) {
  const inputs={users,devicesPerUser,ticksPerDay,deliveryIterationsPerDevicePerTick,syncRequestsPerDay,testRequestsPerDay};
  if(Object.values(inputs).some(v=>!Number.isSafeInteger(v)||v<0))throw new TypeError('Finite non-negative integer workload bounds required');
  const devices=users*devicesPerUser;
  const writes={scheduledMetadata:ticksPerDay,scheduledDeviceMaintenance:ticksPerDay*devices,deliveryAndDedup:2*ticksPerDay*devices*deliveryIterationsPerDevicePerTick,subscriptionSync:syncRequestsPerDay,manualTests:2*testRequestsPerDay,cleanupDirectPutSites:0};
  const total=Object.values(writes).reduce((sum,n)=>sum+n,0);
  if(!Number.isSafeInteger(total))throw new TypeError('Workload exceeds safe integer range');
  return {kind:'conditional-static-bound',notProductionMeasurement:true,inputs,writes,total,exceedsFreeWriteQuota:total>1000};
}
