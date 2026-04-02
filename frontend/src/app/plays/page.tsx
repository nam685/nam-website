import type { Metadata } from "next";
import PlaysClient from "./PlaysClient";

export const metadata: Metadata = { title: "plays" };

export default function PlaysPage() {
  return <PlaysClient />;
}
