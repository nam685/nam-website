import { redirect } from "next/navigation";

// Back-compat: /plays now lives under game-namespaced paths (/plays/chess,
// /plays/aoe2). Old deep links like /plays?game=N redirect to the AoE2 match view.
export default async function PlaysPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  if (game) redirect(`/plays/aoe2?game=${encodeURIComponent(game)}`);
  redirect("/plays/chess");
}
