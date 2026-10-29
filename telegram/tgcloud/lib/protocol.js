export const INTERVALS = new Set([0, 15, 30, 60, 300, 600, 1800, 2700, 3600, 7200, 10800, 21600, 43200]);
const userId = value => /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
const epoch = value => /^[A-Za-z0-9_-]{8,32}$/.test(value);
const payload = value => /^[A-Za-z0-9_-]{60,180}$/.test(value);
const sequence = value => /^[1-9][0-9]{0,14}$/.test(value) && Number.isSafeInteger(Number(value));

export function parseCommand(query) {
  if (typeof query !== 'string' || query.length > 256) return null;
  const parts = query.split(':');
  if (parts[0] !== 'H1') return null;
  const [, operation, ...args] = parts;
  if (['i', 'a', 'v', 'r', 'd'].includes(operation) && args.length === 1 && userId(args[0])) {
    return { operation, otherId: Number(args[0]) };
  }
  if (operation === 'g' && args.length === 2 && userId(args[0]) && epoch(args[1])) {
    return { operation, ownerId: Number(args[0]) };
  }
  if (operation === 's' && args.length === 5 && epoch(args[0]) && sequence(args[1]) && sequence(args[2]) && INTERVALS.has(Number(args[3])) && payload(args[4])) {
    return { operation, epoch: args[0], generation: Number(args[1]), sequence: Number(args[2]), intervalSeconds: Number(args[3]), ciphertext: args[4] };
  }
  if (operation === 'u' && args.length === 3 && epoch(args[0]) && sequence(args[1]) && payload(args[2])) {
    return { operation, epoch: args[0], sequence: Number(args[1]), ciphertext: args[2] };
  }
  if (operation === 'x' && args.length === 2 && epoch(args[0]) && sequence(args[1])) {
    return { operation, epoch: args[0], sequence: Number(args[1]) };
  }
  return null;
}

export function positionResult(position) {
  return `H1:pos:${position.ownerId}:${position.epoch}:${position.sequence}:${position.updatedAt}:${position.ciphertext}`;
}

export function freshnessMs(intervalSeconds) {
  // The position becomes unavailable soon after expected updates stop.
  if (intervalSeconds === 0) return 24 * 60 * 60 * 1000;
  return Math.min(24 * 60 * 60 * 1000, Math.max(60_000, intervalSeconds * 2_000 + 30_000));
}
