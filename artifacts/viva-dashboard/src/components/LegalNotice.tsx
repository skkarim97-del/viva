import { LEGAL } from "@/lib/legal";

// Reusable legal and clinical responsibility notice components for Viva Clinic.
// One global anchor lives in the Shell footer. Use these only on higher-risk
// surfaces (escalation detail, generated summaries, risk review).

interface NoticeProps {
  className?: string;
}

function LegalText({ copy, className }: { copy: string; className?: string }) {
  return (
    <p className={`text-[11px] text-muted-foreground leading-relaxed ${className ?? ""}`}>
      {copy}
    </p>
  );
}

export function ClinicalResponsibilityNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.CORE_CLINICAL_RESPONSIBILITY} className={className} />;
}

export function ProviderDecisionSupportNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.PROVIDER_DECISION_SUPPORT} className={className} />;
}

export function GeneratedSummaryNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.GENERATED_SUMMARY_NOTICE} className={className} />;
}

export function PatientInsightsNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.PATIENT_INSIGHTS_NOTICE} className={className} />;
}

export function EscalationNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.ESCALATION_NOTICE} className={className} />;
}

export function RiskReviewNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.RISK_REVIEW_NOTICE} className={className} />;
}
