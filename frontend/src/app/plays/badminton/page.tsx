import type { Metadata } from "next";
import PlaysClient from "../PlaysClient";

const DESCRIPTION =
  "Upload a video of your badminton overhead clear and get a coach's breakdown: every attempt cut out, annotated slow-motion clips, measurements against a pro, and what to fix first.";

export const metadata: Metadata = {
  title: "plays — badminton",
  description: DESCRIPTION,
  alternates: { canonical: "/plays/badminton" },
  openGraph: {
    title: "Badminton clear analysis — nam685.de",
    description: DESCRIPTION,
    url: "/plays/badminton",
    type: "website",
  },
};

// Deep links: /plays/badminton?player=<slug>&s=<submission id>&a=<attempt number>
export default function PlaysBadmintonPage() {
  return <PlaysClient section="badminton" />;
}
