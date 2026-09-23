import type { ErrorToast } from "../../src/services/errorToastQueue";

export function ErrorToastStack(props: { toasts: ErrorToast[]; onDismiss: (id: string) => void }) {
  if (props.toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-label="Console errors">
      {props.toasts.map((toast) => (
        <div className="toast-item" key={toast.id}>
          <div>
            <strong>{toast.source}</strong>
            <div className="muted">
              {toast.reason}{toast.count > 1 ? ` · x${toast.count}` : ""}
            </div>
            <div>{toast.message}</div>
          </div>
          <button type="button" className="toast-close" onClick={() => props.onDismiss(toast.id)}>Close</button>
        </div>
      ))}
    </div>
  );
}
