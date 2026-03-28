import Link from "next/link";

const cards = [
  {
    sector: "SECTOR_01",
    href: "/blog",
    title: "Blog",
    desc: "Thoughts, diary entries, and random text",
    icon: "▤",
  },
  {
    sector: "SECTOR_02",
    href: "/gallery",
    title: "Gallery",
    desc: "Drawings, photos of cats, fish, trees, and more",
    icon: "◈",
  },
  {
    sector: "SECTOR_03",
    href: "/projects",
    title: "Projects",
    desc: "Demos and experiments from GitHub",
    icon: "⌨",
  },
  {
    sector: "SECTOR_04",
    href: "/cv",
    title: "CV",
    desc: "Professional experience and skills",
    icon: "◉",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="relative px-6 pt-16 pb-12 md:px-12 md:pt-24 md:pb-20 max-w-7xl mx-auto overflow-hidden">
        {/* Decorative geometric */}
        <div
          className="absolute top-0 right-0 w-64 h-64 md:w-96 md:h-96 opacity-5 pointer-events-none"
          style={{
            background: "linear-gradient(135deg, #FF1744 0%, transparent 70%)",
            clipPath: "polygon(100% 0, 100% 100%, 0 0)",
          }}
        />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 border-l-4 border-[#FF1744] bg-[#FF1744]/5 mb-6">
            <span
              className="text-[#FF1744] text-xs tracking-[0.3em] uppercase font-bold"
              style={{ fontFamily: "var(--font-headline)" }}
            >
              Identity Verified // Access Granted
            </span>
          </div>

          <h1
            className="text-6xl md:text-8xl lg:text-9xl font-black uppercase tracking-tighter text-white mb-6"
            style={{
              fontFamily: "var(--font-headline)",
              textShadow: "0 0 40px rgba(255,23,68,0.25)",
            }}
          >
            Hi, I&apos;m <span style={{ color: "#FF1744" }}>Nam</span>
          </h1>

          <p className="max-w-xl text-lg md:text-xl text-[#888] leading-relaxed">
            I build things, draw pictures, and write about whatever catches my
            attention.
          </p>
        </div>
      </section>

      {/* Card grid */}
      <section className="px-6 pb-16 md:px-12 md:pb-24 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {cards.map((card) => (
            <Link key={card.href} href={card.href}>
              <div
                className="group relative h-40 sm:h-52 md:h-64 flex flex-col justify-between p-5 md:p-8 transition-colors"
                style={{
                  background: "#1a1a1a",
                  borderLeft: "3px solid #FF1744",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "#2a2a2a")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "#1a1a1a")
                }
              >
                <div className="flex justify-between items-start">
                  <span
                    className="text-[#FF1744] text-xs tracking-widest"
                    style={{ fontFamily: "var(--font-headline)" }}
                  >
                    [ {card.sector} ]
                  </span>
                  <span className="text-[#FF1744] text-lg opacity-60 group-hover:opacity-100 transition-opacity">
                    ↗
                  </span>
                </div>

                <div>
                  <h3
                    className="text-2xl md:text-3xl font-bold text-white uppercase mb-2"
                    style={{ fontFamily: "var(--font-headline)" }}
                  >
                    {card.title}
                  </h3>
                  <p className="text-sm text-[#888] leading-relaxed hidden sm:block">
                    {card.desc}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Status strip */}
      <div
        className="w-full py-3 px-6 border-y"
        style={{ borderColor: "#27272a", background: "#131313" }}
      >
        <div className="flex gap-8 md:gap-16 max-w-7xl mx-auto overflow-hidden">
          {[
            "System Status: Optimal",
            "Protocol: HUD_V1",
            "Location: [REDACTED]",
          ].map((item) => (
            <span
              key={item}
              className="text-[10px] tracking-[0.3em] uppercase whitespace-nowrap"
              style={{ color: "#444", fontFamily: "var(--font-headline)" }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
