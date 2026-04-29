// Re-export the canonical themes module from packages/core.
// This file is kept so existing imports (`./themes` from neighbors) keep
// working without touching every call site.
export * from '../../packages/core/src/themes';
