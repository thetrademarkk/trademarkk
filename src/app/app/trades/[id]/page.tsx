import { TradeDetail } from "@/features/trades";

export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TradeDetail id={id} />;
}
