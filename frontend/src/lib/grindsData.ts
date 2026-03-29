export interface LeafConfig {
  src: string;
  top: string;
  left: string;
  width: string;
  opacity: number;
  rotate?: number;
  flipX?: boolean;
  delay?: number;
}

export interface GrindEntry {
  period: string;
  org: string;
  url: string;
  role: string;
  city: string;
  description: string;
  tags: string[];
  side: "left" | "right";
  leaf: LeafConfig;
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
    leaf: { src: "/grinds-leaves.png", top: "-30px", left: "-40px", width: "120px", opacity: 0.3, rotate: 15, delay: 0 },
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
    leaf: { src: "/grinds-vine.png", top: "-25px", left: "calc(100% - 80px)", width: "110px", opacity: 0.25, rotate: -10, flipX: true, delay: 1.5 },
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
    leaf: { src: "/grinds-leaves.png", top: "calc(100% - 60px)", left: "-35px", width: "100px", opacity: 0.2, rotate: -15, flipX: true, delay: 2 },
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
    leaf: { src: "/grinds-vine.png", top: "calc(100% - 50px)", left: "calc(100% - 70px)", width: "110px", opacity: 0.25, rotate: 20, delay: 3 },
  },
];
