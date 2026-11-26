export interface CursorPosition {
  line: number;
  column: number;
}

export interface PeerPresence {
  id: string;
  name: string;
  color: string;
  cursor?: CursorPosition;
  selection?: string;
  lastActive: number;
}

export interface TimedPeerPresence extends PeerPresence {
  expiresAt: number;
}

const PRESENCE_TTL_MS = 15_000;

const FALLBACK_COLORS = [
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#a78bfa",
  "#fb923c",
];

export function colorForPeer(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

export function mergePresence(
  current: Map<string, TimedPeerPresence>,
  incoming: PeerPresence,
  now = Date.now(),
): Map<string, TimedPeerPresence> {
  const next = new Map(current);
  const previous = next.get(incoming.id);
  next.set(incoming.id, {
    ...incoming,
    color: incoming.color || previous?.color || colorForPeer(incoming.id),
    lastActive: Math.max(incoming.lastActive, previous?.lastActive ?? 0),
    expiresAt: now + PRESENCE_TTL_MS,
  });
  return next;
}

export function pruneStalePresence(
  current: Map<string, TimedPeerPresence>,
  now = Date.now(),
): Map<string, TimedPeerPresence> {
  const next = new Map(current);
  for (const [id, peer] of next) {
    if (peer.expiresAt <= now) next.delete(id);
  }
  return next;
}

export function presenceToPeers(
  current: Map<string, TimedPeerPresence>,
  selfId: string,
): PeerPresence[] {
  return Array.from(current.values())
    .filter((peer) => peer.id !== selfId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ expiresAt: _expiresAt, ...peer }) => peer);
}
