/** Small color helpers to derive an attractive gradient from a brand color. */

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Lighten (amt > 0) or darken (amt < 0) a hex color. amt in [-1, 1]. */
export function shade(hex: string, amt: number): string {
  const c = (hex || "#5B5FC7").replace("#", "");
  const n = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const f = (v: number) => (amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  return (
    "#" +
    [f(r), f(g), f(b)]
      .map((v) => clamp(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** A 135° gradient woven from the brand color: lighter → base → deeper. */
export function brandGradient(hex: string): string {
  const base = hex || "#5B5FC7";
  return `linear-gradient(135deg, ${shade(base, 0.18)} 0%, ${base} 45%, ${shade(base, -0.32)} 100%)`;
}
