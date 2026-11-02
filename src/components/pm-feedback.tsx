export function PmLoading({ label = 'Loading' }: { label?: string }) {
  return <p data-pm-state="loading" role="status">{label}</p>;
}

export function PmEmpty({ label }: { label: string }) {
  return <p data-pm-state="empty">{label}</p>;
}

export function PmUnavailable({ reason }: { reason: string }) {
  return (
    <p data-pm-state="unavailable">
      <strong>UNAVAILABLE.</strong> {reason}
    </p>
  );
}

export function PmRejected({ code, message, fix }: { code: string; message: string; fix?: string | null }) {
  return (
    <div data-pm-state="error" role="alert">
      <p><strong>{code}.</strong> {message}</p>
      {fix ? <p>{fix}</p> : null}
    </div>
  );
}

export function PmSaved({ label = 'Saved.' }: { label?: string }) {
  return <p data-pm-state="saved" role="status">{label}</p>;
}
