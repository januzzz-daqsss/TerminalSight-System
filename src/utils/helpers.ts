export function formatTimer(seconds: number): string {
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60)
    .toString()
    .padStart(2, "0");
  const s = (abs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
