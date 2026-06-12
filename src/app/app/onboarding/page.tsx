import { Suspense } from "react";
import { OnboardingFlow } from "@/features/onboarding";

// OnboardingFlow reads ?mode=demo via useSearchParams — Suspense keeps the
// route statically renderable.
export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingFlow />
    </Suspense>
  );
}
