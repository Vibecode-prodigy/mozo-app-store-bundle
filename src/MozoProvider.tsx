import React, { createContext, useContext, useMemo } from 'react';

import type { MozoAppContext } from './types';

const ReactMozoContext = createContext<MozoAppContext | null>(null);

interface MozoProviderProps {
    context: MozoAppContext;
    children: React.ReactNode;
}

/**
 * Makes the host context available to the app's React tree. The boilerplate wraps the
 * app in this automatically, so an app only needs `useMozo()`.
 */
export function MozoProvider({ context, children }: MozoProviderProps): React.ReactElement {
    // The context object is stable for the lifetime of a mount, so memoising on identity
    // keeps consumers from re-rendering on every parent render.
    const value = useMemo(() => context, [context]);

    return (
        <ReactMozoContext.Provider value={value}>
            <MozoErrorBoundary>{children}</MozoErrorBoundary>
        </ReactMozoContext.Provider>
    );
}

export function useMozo(): MozoAppContext {
    const context = useContext(ReactMozoContext);

    if (!context) {
        throw new Error('useMozo() must be called inside the app tree rendered by mount().');
    }

    return context;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * The app runs in the host's page, so an unhandled render error would otherwise take the
 * host down with it. This confines the failure to the app's own element.
 */
class MozoErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error('[mozo-app] render error:', error, info.componentStack);
    }

    render(): React.ReactNode {
        if (this.state.error) {
            return (
                <div className="mozo-app-error" role="alert">
                    <p>This app failed to render.</p>
                    <pre>{this.state.error.message}</pre>
                </div>
            );
        }

        return this.props.children;
    }
}
