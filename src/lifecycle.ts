import type { MozoAppContext } from './types';

/**
 * Optional lifecycle hooks. An app can register these from its own module scope to run
 * setup and teardown that is not tied to React rendering (timers, subscriptions,
 * websockets). Everything registered here is torn down by `unmount()`, which is what
 * keeps a repeatedly mounted app from leaking.
 */

type MountHook = (context: MozoAppContext) => void | (() => void) | Promise<void | (() => void)>;

const mountHooks: MountHook[] = [];
let cleanups: Array<() => void> = [];

/** Register a hook to run on every mount. Return a function to undo it on unmount. */
export function onMount(hook: MountHook): void {
    mountHooks.push(hook);
}

/** Register a teardown callback from anywhere while the app is mounted. */
export function onUnmount(cleanup: () => void): void {
    cleanups.push(cleanup);
}

export async function runMountHooks(context: MozoAppContext): Promise<void> {
    for (const hook of mountHooks) {
        const cleanup = await hook(context);
        if (typeof cleanup === 'function') {
            cleanups.push(cleanup);
        }
    }
}

export function runCleanups(): void {
    // Iterate over a copy: a cleanup may register another one.
    const pending = cleanups;
    cleanups = [];

    for (const cleanup of pending) {
        try {
            cleanup();
        } catch (error) {
            // One broken teardown must not strand the rest — the host is about to reuse
            // this element and needs every other cleanup to have run.
            console.error('[mozo-app] cleanup failed:', error);
        }
    }
}
