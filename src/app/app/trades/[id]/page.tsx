import { TradeDetail } from "@/features/trades";

// Pure client shell — trade data lives in the user's own journal DB and loads
// client-side, so the document is viewer-independent. Static per id avoids a
// per-request SSR invocation on every trade-detail visit.
export function generateStaticParams() {
  return [];
}

export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TradeDetail id={id} />;
}
