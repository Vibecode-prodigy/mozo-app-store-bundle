// Placeholder — replaced by scripts/wrap-lovable.mjs at build time with a re-export of
// the Lovable app's root component. Kept in the repo so `npm run dev` and `tsc` work on
// a fresh clone, before any app has been wrapped.
import React from 'react';

export default function PlaceholderApp(): React.ReactElement {
    return React.createElement(
        'div',
        { className: 'mozo-app-placeholder' },
        'No app wrapped yet. Run `npm run wrap -- --source <path-to-lovable-app>`.'
    );
}
