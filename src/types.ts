/**
 * The contract between a Mozo App Store module bundle and its host.
 *
 * A module bundle is loaded with a dynamic `import()` and runs *in-process* inside the
 * host application — there is no iframe and no postMessage hop. Everything the app is
 * allowed to do arrives through the `MozoAppContext` it is handed at mount time; the
 * host enforces the app's approved scopes on every call.
 */

export type MozoScope = string;

export interface MozoVenue {
    id: string;
    name?: string;
}

export interface MozoUser {
    id?: string;
    email?: string;
    name?: string;
}

/** Theme tokens the host exposes so an app can visually match the surrounding UI. */
export interface MozoTheme {
    mode: 'light' | 'dark';
    colors: Record<string, string>;
}

/**
 * Scoped access to the Mozo API. Each method maps to an approved scope; calling one the
 * app was not granted rejects rather than reaching the network.
 */
export interface MozoApi {
    orders: {
        list(args?: { page?: number; limit?: number; sort_direction?: string }): Promise<unknown>;
        getById(args: { id: string }): Promise<unknown>;
        create(args: Record<string, unknown>): Promise<unknown>;
        update(args: Record<string, unknown>): Promise<unknown>;
    };
    menu: {
        getItems(): Promise<unknown>;
        getCategories(): Promise<unknown>;
        getItem(args: { id: string }): Promise<unknown>;
        updateItem(args: Record<string, unknown>): Promise<unknown>;
    };
    tables: {
        list(): Promise<unknown>;
        getById(args: { id: string }): Promise<unknown>;
    };
    payments: {
        list(args?: { start_date?: string; end_date?: string; limit?: number; offset?: number }): Promise<unknown>;
        getById(args: { id: string }): Promise<unknown>;
    };
    venue: {
        getCurrent(): Promise<unknown>;
        getConfig(): Promise<unknown>;
    };
    /** Escape hatch for methods added to the host after this bundle was built. */
    call(method: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** Per-app, per-venue key/value storage. Cleared when the app is uninstalled. */
export interface MozoStorage {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
}

export interface MozoUi {
    toast(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
    setTitle(title: string): void;
}

export interface MozoAppContext {
    /** Contract version, so an app can detect an older host. */
    readonly version: 1;
    readonly app: { id: string; slug: string; name: string; version: string };
    readonly slot: string | null;
    readonly venue: MozoVenue;
    readonly user: MozoUser;
    readonly scopes: MozoScope[];
    readonly locale: string;
    readonly theme: MozoTheme;
    readonly api: MozoApi;
    readonly storage: MozoStorage;
    readonly ui: MozoUi;
    /** True when the app holds the given scope. */
    hasScope(scope: MozoScope): boolean;
    /** Subscribe to a host event; returns an unsubscribe function. */
    on(event: string, handler: (payload: unknown) => void): () => void;
}

/**
 * Every module bundle must export these two functions.
 *
 * `mount` renders into the supplied element. `unmount` must release everything it
 * created — the host calls it on navigation and may mount the app again afterwards.
 */
export interface MozoAppModule {
    mount(element: HTMLElement, context: MozoAppContext): void | Promise<void>;
    unmount(): void | Promise<void>;
}
