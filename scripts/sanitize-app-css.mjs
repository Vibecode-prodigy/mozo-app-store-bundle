/**
 * Catalog check style.global_leakage rejects a sibling .css file that targets
 * html, body, or the universal selector. The admin iframe sets those on a
 * <style> tag. App styles are scoped under .kit-app, which mount() adds to the
 * host element.
 */

const ELEMENT_WHERE =
    ':where(div,span,p,a,button,input,textarea,select,label,li,ul,ol,h1,h2,h3,h4,h5,h6,section,article,header,footer,nav,main,form,table,thead,tbody,tr,th,td,img,svg,dialog,pre,code,blockquote,figure,figcaption,fieldset,legend,hr,dl,dt,dd,strong,em,small,video,canvas,iframe)';

const DOCUMENT_SELECTOR =
    /^(?:\*|html|body|::?before|::?after|\*::before|\*::after|:root)$/;

const GLOBAL_SELECTOR =
    /(^|[\s>+~(])(\*|html|body)(?=$|[\s>+~:.#\],)])/;

const splitSelectors = (prelude) => {
    const parts = [];
    let current = '';
    let paren = 0;
    let bracket = 0;
    let quote = '';

    for (let i = 0; i < prelude.length; i += 1) {
        const ch = prelude[i];
        if (quote) {
            current += ch;
            if (ch === '\\') {
                current += prelude[i + 1] ?? '';
                i += 1;
                continue;
            }
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(') paren += 1;
        else if (ch === ')') paren -= 1;
        else if (ch === '[') bracket += 1;
        else if (ch === ']') bracket -= 1;
        else if (ch === ',' && paren === 0 && bracket === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts;
};

const isDocumentSelector = (selector) => DOCUMENT_SELECTOR.test(selector.trim());

/** Scope one selector so it cannot restyle the host document. */
export const scopeSelector = (selector) => {
    const original = selector.trim();
    if (!original || original.startsWith('@')) return original;
    if (/^(from|to|\d+(?:\.\d+)?%)$/.test(original)) return original;

    if (original === '*') return `.kit-app, .kit-app ${ELEMENT_WHERE}`;
    if (original === 'html' || original === 'body' || original === ':root') return '.kit-app';
    if (/^::?before$/.test(original) || /^::?after$/.test(original)) return `.kit-app ${original}`;
    if (/^\*::?before$/.test(original) || /^\*::?after$/.test(original)) {
        return `.kit-app ${original.replace(/^\*/, '')}`;
    }

    let next = original.replace(/(^|[\s>+~(])(?:html|body|:root)(?=$|[\s>+~:.#\],)])/g, '$1.kit-app');
    next = next.replace(/(^|[\s>+~(])\*::/g, '$1');
    next = next.replace(/(^|[\s>+~(])\*(?=$|[\s>+~.#\],)])/g, `$1${ELEMENT_WHERE}`);

    if (!next.includes('.kit-app')) next = `.kit-app ${next}`;
    return next.replace(/\.kit-app\s+\.kit-app\b/g, '.kit-app');
};

const stripDocumentLock = (block) =>
    block
        .replace(/(^|;)\s*height\s*:\s*100%\s*(?:!important)?\s*/gi, '$1')
        .replace(/(^|;)\s*overflow(?:-[xy])?\s*:\s*hidden\s*(?:!important)?\s*/gi, '$1')
        .replace(/;{2,}/g, ';')
        .replace(/^\s*;\s*/, '')
        .replace(/;\s*$/, '');

const dedupeSelectors = (selectors) => {
    const seen = new Set();
    const unique = [];
    for (const selector of selectors) {
        const key = selector.replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(key);
    }
    return unique;
};

const readBalanced = (css, openIndex) => {
    let depth = 0;
    let quote = '';
    let comment = false;
    for (let i = openIndex; i < css.length; i += 1) {
        const ch = css[i];
        const next = css[i + 1];
        if (comment) {
            if (ch === '*' && next === '/') {
                comment = false;
                i += 1;
            }
            continue;
        }
        if (quote) {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '/' && next === '*') {
            comment = true;
            i += 1;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return css.length - 1;
};

/**
 * @param {string} css
 * @returns {string}
 */
export const sanitizeAppCss = (css) => {
    let out = '';
    let cursor = 0;

    const findNextOpen = (from) => {
        let quote = '';
        let comment = false;
        for (let i = from; i < css.length; i += 1) {
            const ch = css[i];
            const next = css[i + 1];
            if (comment) {
                if (ch === '*' && next === '/') {
                    comment = false;
                    i += 1;
                }
                continue;
            }
            if (quote) {
                if (ch === '\\') {
                    i += 1;
                    continue;
                }
                if (ch === quote) quote = '';
                continue;
            }
            if (ch === '/' && next === '*') {
                comment = true;
                i += 1;
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }
            if (ch === '{') return i;
        }
        return -1;
    };

    while (cursor < css.length) {
        const open = findNextOpen(cursor);
        if (open === -1) {
            out += css.slice(cursor);
            break;
        }

        const prelude = css.slice(cursor, open);
        const trimmed = prelude.trim();
        const close = readBalanced(css, open);
        const body = css.slice(open + 1, close);

        if (/^@(?:keyframes|font-face|property|page|counter-style)\b/i.test(trimmed)) {
            out += css.slice(cursor, close + 1);
            cursor = close + 1;
            continue;
        }

        if (trimmed.startsWith('@')) {
            out += `${prelude}{${sanitizeAppCss(body)}}`;
            cursor = close + 1;
            continue;
        }

        const originalSelectors = splitSelectors(prelude);
        const documentOnly =
            originalSelectors.length > 0 &&
            originalSelectors.every((selector) => isDocumentSelector(selector));
        const scoped = dedupeSelectors(originalSelectors.map((selector) => scopeSelector(selector)));
        const nextBody = documentOnly ? stripDocumentLock(sanitizeAppCss(body)) : sanitizeAppCss(body);
        out += `${scoped.join(', ')}{${nextBody}}`;
        cursor = close + 1;
    }

    return out;
};

/** Selector text that would still fail style.global_leakage. Ignores declarations. */
export const findGlobalSelectors = (css) => {
    const hits = [];
    let cursor = 0;

    const findNextOpen = (from) => {
        let quote = '';
        let comment = false;
        for (let i = from; i < css.length; i += 1) {
            const ch = css[i];
            const next = css[i + 1];
            if (comment) {
                if (ch === '*' && next === '/') {
                    comment = false;
                    i += 1;
                }
                continue;
            }
            if (quote) {
                if (ch === '\\') {
                    i += 1;
                    continue;
                }
                if (ch === quote) quote = '';
                continue;
            }
            if (ch === '/' && next === '*') {
                comment = true;
                i += 1;
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }
            if (ch === '{') return i;
        }
        return -1;
    };

    while (cursor < css.length) {
        const open = findNextOpen(cursor);
        if (open === -1) break;
        const prelude = css.slice(cursor, open);
        const trimmed = prelude.trim();
        const close = readBalanced(css, open);
        const body = css.slice(open + 1, close);

        if (/^@(?:keyframes|font-face|property|page|counter-style)\b/i.test(trimmed)) {
            cursor = close + 1;
            continue;
        }
        if (trimmed.startsWith('@')) {
            hits.push(...findGlobalSelectors(body));
            cursor = close + 1;
            continue;
        }

        for (const selector of splitSelectors(prelude)) {
            if (GLOBAL_SELECTOR.test(selector)) {
                hits.push(selector.trim());
            }
        }
        hits.push(...findGlobalSelectors(body));
        cursor = close + 1;
    }

    return hits;
};
