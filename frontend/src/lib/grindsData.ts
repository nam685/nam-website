export interface GrindEntry {
  period: string;
  org: string;
  url: string;
  role: string;
  city: string;
  description: string;
  tags: string[];
  side: "left" | "right";
}

export const ENTRIES: GrindEntry[] = [
  {
    period: "now",
    org: "ellamind",
    url: "https://ellamind.com",
    role: "Button pressing but AI",
    city: "Bremen",
    description: "I get skill gapped by agent.",
    tags: ["vibecode"],
    side: "right",
  },
  {
    period: "2023 – 2026",
    org: "Peregrine.ai",
    url: "https://peregrine.ai",
    role: "Button pressing",
    city: "Berlin",
    description: "I write actual understandable code.",
    tags: ["software engineer"],
    side: "left",
  },
  {
    period: "2019 – 2023",
    org: "Sorbonne University",
    url: "https://www.sorbonne-universite.fr",
    role: "Button pressing practice",
    city: "Paris",
    description: "I beat other kids but in french.",
    tags: ["computer science"],
    side: "right",
  },
  {
    period: "2004 – 2019",
    org: "Vietnamese Education System",
    url: "https://moet.gov.vn/page/sitemapPortal",
    role: "Battle Royale",
    city: "Hanoi",
    description: "I beat other kids.",
    tags: ["math"],
    side: "left",
  },
];
