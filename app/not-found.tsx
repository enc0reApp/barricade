import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import PixelIcon from "@/components/ui/PixelIcon";

export default function NotFound() {
  return (
    <PageShell kicker="404" title="LOST IN THE CROWD" intro={<p>this page wandered off to find the toilets. it isn&apos;t coming back.</p>}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="px-btn" href="/" style={{ flex: "1 1 auto" }}>
          <span className="tri" aria-hidden="true">▲</span> BACK TO THE FRONT
        </Link>
        <Link className="px-btn px-btn--ghost" href="/archive" style={{ flex: "1 1 auto" }}>
          THE ARCHIVE <PixelIcon name="archive" size={2} />
        </Link>
      </div>
    </PageShell>
  );
}
