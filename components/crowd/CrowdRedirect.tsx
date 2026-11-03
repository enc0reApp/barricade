"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isMockActive } from "@/lib/client/api";
import { addDays, localDateString } from "@/lib/game/day";
import StatusScreen from "@/components/game/StatusScreen";
import Scene from "@/components/scene/Scene";

export default function CrowdRedirect() {
  const router = useRouter();
  useEffect(() => {
    isMockActive(); // remembers a ?mock= flag for the tab before the URL changes (dev only)
    router.replace(`/crowd/${addDays(localDateString(), -1)}${window.location.search}`);
  }, [router]);
  return (
    <>
      <Scene distance={700} horizon={0.36} dim={0.38} />
      <StatusScreen title="THE MORNING AFTER" busy body={<p>finding last night&apos;s crowd…</p>} />
    </>
  );
}
