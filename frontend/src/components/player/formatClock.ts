/** Format seconds as a compact clock label: `0:00`, `4:09`, `1:02:30`. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const minuteLabel = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes}`;
  return `${minuteLabel}:${String(secs).padStart(2, "0")}`;
}
