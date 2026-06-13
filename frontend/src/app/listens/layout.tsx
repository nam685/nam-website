import type { ReactNode } from "react";

export default function ListensLayout({ children }: { children: ReactNode }) {
  return <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0.5rem 1rem 2rem" }}>{children}</div>;
}
