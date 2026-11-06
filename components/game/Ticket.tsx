import { barcode } from "@/lib/share/barcode";
import { encodeShareCode } from "@/lib/share/code";
import { ticketClipPathCss } from "@/lib/share/ticket-shape";
import { formatSetDateLong, formatPercentNumber } from "@/lib/client/format";
import { MISS, outcomePoints, TIERS, type Outcome } from "@/lib/game/tiers";
import styles from "./Ticket.module.css";

export interface TicketProps {
  number: number;
  date: string;
  outcomes: Outcome[];
  distance: number;
  beatPct: number | null;
  mode: "today" | "archive";
}

const STUB_W = 132;
const STUB_H = 104;

const CLIP_LANDSCAPE = ticketClipPathCss({ orientation: "landscape", stub: STUB_W, step: 3, notch: 4, corner: 2 });
const CLIP_PORTRAIT = ticketClipPathCss({ orientation: "portrait", stub: STUB_H, step: 3, notch: 4, corner: 2 });

function Barcode({ code, vertical = false }: { code: string; vertical?: boolean }) {
  const bc = barcode(code);
  const h = 22;
  return (
    <svg
      className={vertical ? styles.barcodeV : styles.barcode}
      viewBox={`0 0 ${bc.length} ${h + 3}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {bc.bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={b.guard ? h + 3 : h} fill="currentColor" />
      ))}
    </svg>
  );
}

export default function Ticket({ number, date, outcomes, distance, beatPct, mode }: TicketProps) {
  const code = encodeShareCode(number, outcomes);
  const points = outcomes.reduce((sum, outcome) => sum + outcomePoints(outcome), 0);
  const label = outcomes.map((o, i) => `${i + 1}: ${o === "miss" ? MISS.label : TIERS[o].label}`).join(", ");
  return (
    <div className={styles.wrap}>
      <article
        className={styles.ticket}
        style={{ ["--clip-l" as string]: CLIP_LANDSCAPE, ["--clip-p" as string]: CLIP_PORTRAIT, ["--stub-w" as string]: `${STUB_W}px`, ["--stub-h" as string]: `${STUB_H}px` }}
        aria-label={`Ticket for BARRICADE set ${number}: ${distance === 0 ? "on the barricade" : `${distance} metres from the stage`}`}
      >
        <div className={styles.main}>
          <div className={styles.head}>
            <span className={styles.brand}>BARRICADE</span>
            <span className={styles.set}>SET #{number}</span>
          </div>
          <p className={styles.date}>{formatSetDateLong(date)}</p>
          {distance === 0 ? (
            <p className={styles.barricade}>
              ON THE
              <br />
              BARRICADE
            </p>
          ) : (
            <p className={styles.distance}>
              <span className={styles.metres}>{distance}m</span>
              <span className={styles.from}>FROM THE STAGE</span>
            </p>
          )}
          <div className={styles.squares} role="img" aria-label={label}>
            {outcomes.map((o, i) => (
              <span key={i} className={styles.sq} data-tier={o} />
            ))}
          </div>
          <p className={styles.stats}>
            POINTS {points}
            {beatPct !== null ? ` · BEAT ${formatPercentNumber(beatPct)}% OF THE CROWD` : ""}
          </p>
          <div className={styles.foot}>
            <span>fstvl.xyz</span>
            <span className={`mono ${styles.serial}`}>Nº {String(number).padStart(4, "0")}-{code.split("-")[1]?.toUpperCase()}</span>
          </div>
          {mode === "archive" ? <span className={styles.stamp}>ARCHIVE · NOT SCORED</span> : null}
        </div>
        <div className={styles.perf} aria-hidden="true" />
        <div className={styles.stub}>
          <div className={styles.stubTop}>
            <span className={styles.admit}>ADMIT ONE</span>
            <span className={styles.stubSet}>
              <span>SET</span> <span>#{number}</span>
            </span>
          </div>
          <Barcode code={code} />
        </div>
      </article>
    </div>
  );
}
