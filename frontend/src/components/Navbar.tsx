"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/blog", label: "Blog" },
  { href: "/gallery", label: "Gallery" },
  { href: "/projects", label: "Projects" },
  { href: "/cv", label: "CV" },
  { href: "/now", label: "Now" },
  { href: "/uses", label: "Uses" },
  { href: "/changelog", label: "Changelog" },
  { href: "/todo", label: "Todo" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="nav">
        <Link href="/" className="nav-logo">
          [NAM LE]
        </Link>
        <ul className="nav-links">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={pathname.startsWith(link.href) ? "active" : ""}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <button
          className="nav-toggle"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? "✕" : "☰"}
        </button>
      </nav>
      {open && (
        <ul className="nav-mobile">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={pathname.startsWith(link.href) ? "active" : ""}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
