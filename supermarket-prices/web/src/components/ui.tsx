import type { ReactNode } from "react";

export function Loading({ label = "טוען..." }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <strong>משהו השתבש</strong>
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          נסו שוב
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function ModeToggle(_props: { online: boolean; onChange: (v: boolean) => void }) {
  return <p className="muted small">חנויות אונליין בלבד: רמי לוי, קרפור, שופרסל, ויקטורי</p>;
}

export function Qty({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="qty" role="group" aria-label={`כמות: ${label}`}>
      <button type="button" aria-label="הפחתה" onClick={() => onChange(value - 1)} disabled={value <= 1}>
        −
      </button>
      <output>{value}</output>
      <button type="button" aria-label="הוספה" onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
