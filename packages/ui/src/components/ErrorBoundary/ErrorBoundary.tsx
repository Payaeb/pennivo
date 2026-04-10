import { Component, type ReactNode, type ErrorInfo, createRef } from "react";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };
  private recoverBtnRef = createRef<HTMLButtonElement>();

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught rendering error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.state.hasError && !prevState.hasError) {
      this.recoverBtnRef.current?.focus();
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRecover = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-content">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2>Something went wrong</h2>
          <p className="error-boundary-message">
            The editor encountered an error. Your work has been auto-saved.
          </p>
          {this.state.error && (
            <pre className="error-boundary-detail">
              {this.state.error.message}
            </pre>
          )}
          <div className="error-boundary-actions">
            <button
              ref={this.recoverBtnRef}
              className="error-boundary-btn error-boundary-btn--primary"
              onClick={this.handleRecover}
            >
              Try to recover
            </button>
            <button className="error-boundary-btn" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
