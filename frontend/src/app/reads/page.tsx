import type { Metadata } from "next";

import ReadsClient from "./ReadsClient";

export const metadata: Metadata = { title: "reads" };

export default function ReadsPage() {
  return <ReadsClient />;
}
