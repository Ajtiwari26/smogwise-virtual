/**
 * Bilingual EN/HI React ErrorBoundary catching runtime rendering errors gracefully.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { LanguageCode } from '../domain/types.js';

export interface ErrorBoundaryProps {
  readonly language: LanguageCode;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

/** Catches unexpected UI errors and renders an accessible EN/HI recovery card. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Error state is already captured in getDerivedStateFromError
  }

  private readonly handleReset = (): void => {
    this.setState({ hasError: false });
  };

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const isHindi = this.props.language === 'hi';
    return (
      <section
        role="alert"
        aria-live="assertive"
        className="mx-auto my-6 max-w-2xl rounded-2xl border border-rose-200 bg-rose-50/90 p-6 shadow-sm"
      >
        <h2 className="text-base font-semibold text-rose-900">
          {isHindi
            ? 'इस अनुभाग को लोड करते समय एक अस्थायी त्रुटि हुई।'
            : 'Something went wrong while rendering this panel.'}
        </h2>
        <p className="mt-1.5 text-sm text-rose-800">
          {isHindi
            ? 'आपका घरेलू डेटा सुरक्षित है। इस अनुभाग को पुनः प्रारंभ करने के लिए नीचे क्लिक करें।'
            : 'Your household inputs remain safe. Click below to restore this view.'}
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-4 inline-flex items-center rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
        >
          {isHindi ? 'पुनः प्रयास करें' : 'Reset Panel'}
        </button>
      </section>
    );
  }
}
