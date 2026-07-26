import type { Metadata } from "next";
import PlaysClient from "../PlaysClient";

export const metadata: Metadata = { title: "plays — empires" };

// AoE2 match deep links use ?game=N (see gameSharePath). The room for future
// /plays/aoe2/builds/<id> pages lives under this segment.
export default function PlaysAoe2Page() {
  return <PlaysClient section="aoe2" />;
}
