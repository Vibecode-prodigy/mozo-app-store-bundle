import type { MozoAppContext, MozoScope } from './types';

/**
 * The context the host hands to `mount()` is a plain object crossing a bundle boundary,
 * so it cannot be trusted to be complete: a host older than this bundle may not supply
 * every field. These helpers normalise it and fail loudly when an app uses something the
 * host does not provide, rather than throwing `undefined is not a function` deep inside
 * app code.
 */

let activeContext: MozoAppContext | null = null;

const missing = (path: string) => () => {
    throw new Error(
        `Mozo app context: "${path}" is not available in this host. ` +
        `Check the host version and the scopes granted to this app.`
    );
};

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * Normalise the raw context object into a complete MozoAppContext.
 * Called by `mount()` before any app code runs.
 */
export function normalizeContext(raw: unknown): MozoAppContext {
    const record = asRecord(raw);
    const scopes = Array.isArray(record.scopes) ? (record.scopes as MozoScope[]) : [];

    const context = {
        version: 1,
        app: {
            id: '',
            slug: '',
            name: '',
            version: '',
            ...asRecord(record.app),
        },
        slot: typeof record.slot === 'string' ? record.slot : null,
        venue: { id: '', ...asRecord(record.venue) },
        user: { ...asRecord(record.user) },
        scopes,
        locale: typeof record.locale === 'string' ? record.locale : 'en',
        theme: {
            mode: 'light',
            colors: {},
            ...asRecord(record.theme),
        },
        api: record.api ?? { call: missing('api.call') },
        storage: record.storage ?? {
            get: missing('storage.get'),
            set: missing('storage.set'),
            remove: missing('storage.remove'),
        },
        ui: record.ui ?? { toast: () => undefined, setTitle: () => undefined },
        hasScope: (scope: MozoScope) => scopes.includes(scope),
        on: typeof record.on === 'function'
            ? (record.on as MozoAppContext['on'])
            : () => () => undefined,
    } as MozoAppContext;

    activeContext = context;
    return context;
}

export function clearContext(): void {
    activeContext = null;
}

/**
 * Access the context outside of a React tree (utilities, stores, event handlers).
 * Only valid between mount() and unmount().
 */
export function useMozoContext(): MozoAppContext {
    if (!activeContext) {
        throw new Error('Mozo app context is not available — the app is not mounted.');
    }

    return activeContext;
}
