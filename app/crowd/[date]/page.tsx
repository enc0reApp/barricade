import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CrowdView from "@/components/crowd/CrowdView";
import PageShell from "@/components/ui/PageShell";
import { isDateString } from "@/lib/game/day";

type Params = Promise<{ date: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { date } = await params;
  return isDateString(date) ? { title: `The Morning After · ${date}` } : {};
}

/** The Morning After: how the crowd did on a closed night. */
export default async function CrowdDatePage({ params }: { params: Params }) {
  const { date } = await params;
  if (!isDateString(date)) notFound();
  return (
    <PageShell
      kicker="LAST NIGHT'S CROWD"
      title="THE MORNING AFTER"
      intro={<p>who said what, who got closest, and the answers only one person gave.</p>}
    >
      <CrowdView date={date} />
    </PageShell>
  );
}
