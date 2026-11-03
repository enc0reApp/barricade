import type { Metadata } from "next";
import ArchiveList from "@/components/archive/ArchiveList";
import PageShell from "@/components/ui/PageShell";

export const metadata: Metadata = {
  title: "Archive",
  description: "Every BARRICADE set since #1. Archive plays aren't scored.",
};

export default function ArchivePage() {
  return (
    <PageShell
      kicker="EVERY SET SINCE #1"
      title="THE ARCHIVE"
      intro={<p>missed a night? play it here. archive sets aren&apos;t scored and never touch your streak.</p>}
    >
      <ArchiveList />
    </PageShell>
  );
}
