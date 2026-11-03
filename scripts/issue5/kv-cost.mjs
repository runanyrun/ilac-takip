// Planning model, never a substitute for Cloudflare operation metrics.
export const FREE_DAILY = Object.freeze({ read: 100000, write: 1000, delete: 1000, list: 1000 });
export function estimateDaily({ users, devicesPerUser, remindersPerUser, listPagesPerTick = 1, readsPerDevicePerTick = 1, writesPerDelivery = 1, expiredDevices = 0, scheduleUpdates = 0 }) {
  for (const value of Object.values(arguments[0])) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Use non-negative safe integer counts');
  }
  for (const value of [users, devicesPerUser, remindersPerUser]) {
    if (!Number.isSafeInteger(value)) throw new Error('Missing workload count');
  }
  const devices = users * devicesPerUser;
  const deliveries = devices * remindersPerUser;
  const operations = { read: 1440 * devices * readsPerDevicePerTick, write: deliveries * writesPerDelivery + scheduleUpdates, delete: expiredDevices, list: 1440 * listPagesPerTick };
  if (Object.values(operations).some(n => !Number.isSafeInteger(n))) throw new Error('Workload exceeds safe integer range');
  return { kind: 'hypothetical', ticksPerDay: 1440, deliveries, operations, exceeds: Object.keys(FREE_DAILY).filter(k => operations[k] > FREE_DAILY[k]) };
}
