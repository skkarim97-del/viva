import { LEGAL } from "@/lib/legal";

// Reusable legal and responsibility notice components for Viva Analytics.
// One global anchor lives in the Shell footer. Use these on pilot metrics
// and retention surfaces where outcome language could be misread.

interface NoticeProps {
  className?: string;
}

function LegalText({ copy, className }: { copy: string; className?: string }) {
  return (
    <p className={`text-[11px] text-muted-foreground/70 leading-relaxed ${className ?? ""}`}>
      {copy}
    </p>
  );
}

export function AnalyticsGlobalNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.ANALYTICS_GLOBAL} className={className} />;
}

export function PilotMetricsNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.ANALYTICS_NOTICE} className={className} />;
}

export function RetentionNotice({ className }: NoticeProps) {
  return <LegalText copy={LEGAL.RETENTION_NOTICE} className={className} />;
}
