import type { Metadata } from "next";
import CrowdRedirect from "@/components/crowd/CrowdRedirect";

export const metadata: Metadata = {
  title: "Last night's crowd",
};

/** "Last night" is the player's local yesterday, so the redirect happens in the browser. */
export default function CrowdPage() {
  return <CrowdRedirect />;
}
