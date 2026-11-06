/** A deliberately low-resolution festival poster. Every shape sits on the pixel grid. */
export default function FieldPoster() {
  const shirts = ["#9b8bff", "#ff805c", "#d6ff62", "#f5edda", "#343be8"];
  return (
    <svg viewBox="0 0 180 128" shapeRendering="crispEdges" role="img" aria-label="A pixel crowd in front of a festival stage" style={{ display: "block", width: "100%", height: "100%" }}>
      <rect width="180" height="128" fill="#343be8" />
      <path d="M14 0H40L87 66H69ZM144 0H166L111 66H95Z" fill="#9b8bff" />
      <path d="M60 0H68L89 67H83ZM116 0H124L101 67H95Z" fill="#d6ff62" />
      <path d="M20 16h4v-4h4v4h4v4h-4v4h-4v-4h-4zM150 31h3v-3h3v3h3v3h-3v3h-3v-3h-3z" fill="#f5edda" />
      <path d="M49 45h82v6H49zM49 45h6v39h-6zM125 45h6v39h-6z" fill="#151618" />
      <rect x="56" y="53" width="68" height="29" fill="#d6ff62" />
      <rect x="61" y="58" width="58" height="19" fill="#151618" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={64 + i * 7} y={62 + (i % 3) * 3} width="4" height={11 - (i % 3) * 3} fill={i % 2 ? "#ff805c" : "#9b8bff"} />)}
      <rect x="38" y="56" width="8" height="26" fill="#151618" />
      <rect x="134" y="56" width="8" height="26" fill="#151618" />
      <rect x="48" y="82" width="84" height="7" fill="#ff805c" />
      <rect y="89" width="180" height="39" fill="#151618" />
      {[0, 1, 2, 3].map((row) => Array.from({ length: 21 }, (_, col) => {
        const size = row < 2 ? 3 : 4;
        const x = col * 9 + (row % 2 ? -3 : 1);
        const y = 86 + row * 12 + ((col * 7 + row) % 3);
        return <g key={`${row}:${col}`}>
          <rect x={x + 2} y={y} width={size} height={size} fill={(col + row) % 4 ? "#f5edda" : "#ff805c"} />
          <path d={`M${x + 1} ${y + size}h${size + 2}v${size + 5}h-${size + 2}z`} fill={shirts[(col + row * 2) % shirts.length]} />
          {col % 4 === 0 ? <rect x={x - 1} y={y - 3} width="2" height="10" fill={shirts[(col + row * 2) % shirts.length]} /> : null}
        </g>;
      }))}
      <rect x="16" y="65" width="2" height="30" fill="#f5edda" /><path d="M18 64h16v10H18zM18 74h10v4H18z" fill="#ff805c" />
      <path d="M0 120h180v3H0z" fill="#d6ff62" />
    </svg>
  );
}
