"use strict";
/**
 * Tiny semver comparison sufficient for "is the released version newer than
 * what we have installed". Handles `vX.Y.Z` prefix, drops pre-release tags,
 * zero-pads short versions, and falls back to 0 for malformed parts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareSemver = compareSemver;
exports.parseSemver = parseSemver;
function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i])
            return pa[i] - pb[i];
    }
    return 0;
}
function parseSemver(v) {
    const cleaned = v.replace(/^v/, '').split('-')[0];
    const parts = cleaned.split('.').map(p => Number.parseInt(p, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
//# sourceMappingURL=compare.js.map