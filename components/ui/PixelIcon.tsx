/**
 * Tiny pixel-art icons as crisp SVG rects. Geist Pixel has ▲ but no ▼ ▶ ⟲,
 * so every arrow comes from here for a consistent look.
 */

const ICONS = {
  up: ["...#...", "..###..", ".#####.", "#######"],
  down: ["#######", ".#####.", "..###..", "...#..."],
  right: ["#...", "##..", "###.", "####", "###.", "##..", "#..."],
  left: ["...#", "..##", ".###", "####", ".###", "..##", "...#"],
  archive: ["..###.#", ".#...##", "#...###", "#......", "#.....#", ".#...#.", "..###.."],
  crowd: ["..#...#..", ".###.###.", "..#...#..", "#########", "#########"],
  help: [".###.", "#...#", "...#.", "..#..", ".....", "..#.."],
  share: ["...#...", "..###..", ".#.#.#.", "...#...", "#..#..#", "#.....#", "#######"],
  copy: ["####...", "#..#...", "#.####.", "#.#..#.", "###..#.", "..#..#.", "..####."],
  check: ["......#", ".....##", "#...##.", "##.##..", ".###...", "..#...."],
  close: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  ticket: ["#######", "#.....#", "...#...", "...#...", "#.....#", "#######"],
} as const;

export type IconName = keyof typeof ICONS;

export default function PixelIcon({
  name,
  size = 2,
  className,
  title,
}: {
  name: IconName;
  /** CSS pixels per icon pixel. */
  size?: number;
  className?: string;
  title?: string;
}) {
  const rows = ICONS[name];
  const h = rows.length;
  const w = rows[0]!.length;
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      width={w * size}
      height={h * size}
      shapeRendering="crispEdges"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ display: "inline-block", flex: "none", verticalAlign: "middle" }}
    >
      {title ? <title>{title}</title> : null}
      <path d={d} fill="currentColor" />
    </svg>
  );
}
