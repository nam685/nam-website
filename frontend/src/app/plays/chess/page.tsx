import type { Metadata } from "next";
import PlaysClient from "../PlaysClient";

export const metadata: Metadata = { title: "plays — chess" };

export default function PlaysChessPage() {
  return <PlaysClient section="chess" />;
}
