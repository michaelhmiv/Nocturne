/**
 * A deadline is not evidence of completion: the server/worker's committed
 * terminal event remains the only source of truth.
 */
export function activityRemaining(
  resolvesAt: string,
  serverNow: string,
  serverSnapshotReceivedAt: number,
  clientNow: number,
): { seconds: number; overdue: boolean; label: string } {
  const due = Date.parse(resolvesAt);
  const authoritativeNow = Date.parse(serverNow);
  if (!Number.isFinite(due) || !Number.isFinite(authoritativeNow)) {
    return { seconds: 0, overdue: false, label: "Completion time unavailable" };
  }
  const elapsed = Math.max(0, clientNow - serverSnapshotReceivedAt);
  const remaining = Math.ceil((due - authoritativeNow - elapsed) / 1000);
  if (remaining <= 0) {
    return { seconds: 0, overdue: true, label: "Due — awaiting world confirmation" };
  }
  if (remaining < 60)
    return { seconds: remaining, overdue: false, label: `${remaining}s remaining` };
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return {
    seconds: remaining,
    overdue: false,
    label: `${minutes}m ${String(seconds).padStart(2, "0")}s remaining`,
  };
}
