/**
 * Pure routing logic for the multi-warehouse feature.
 *
 * Users can declare rules like:
 *   { categoryPrefix: "Personal", repo: "fadymondy/private-notes" }
 *   { categoryPrefix: "Work",     repo: "acme/team-notes",       branch: "main" }
 *
 * The first matching rule wins. Notes whose category matches no rule
 * fall through to the default warehouse repo (configured at the
 * top-level `markItDown.warehouse.repo` setting).
 */

import { categoryHasPrefix } from '../categories/path';

export interface RouteRule {
  /** Category path prefix the rule matches; segment-aware (Reference matches Reference + Reference/Postgres but NOT References/Foo). */
  categoryPrefix: string;
  /** GitHub repo in `owner/repo` form. Empty / missing repo disables the rule. */
  repo: string;
  /** Optional branch override; falls back to the default config's branch. */
  branch?: string;
  /** Optional subdir override; falls back to the default config's subdir. */
  subdir?: string;
}

export interface RouteMatch {
  /** Stable identifier for telemetry / logs. `default` for the fallback route. */
  routeId: string;
  /** Repo for the route (default route uses the top-level repo). */
  repo: string;
  /** Branch (overridden by rule.branch when present). */
  branch: string;
  /** Subdir (overridden by rule.subdir when present). */
  subdir: string;
  /** Predicate over a note's category — true when the note belongs to this route. */
  match: (category: string) => boolean;
  /** Source rule index (0-based) or -1 for the default fallback. */
  ruleIndex: number;
}

export interface RouteResolution {
  routes: RouteMatch[];
  /** Indices in `rules` that were dropped (no repo, duplicate, or invalid). Useful for warnings. */
  rejected: { index: number; reason: string }[];
}

export function buildRoutes(
  rules: RouteRule[] | undefined,
  fallback: { repo: string; branch: string; subdir: string },
): RouteResolution {
  const routes: RouteMatch[] = [];
  const rejected: { index: number; reason: string }[] = [];
  const claimedPrefixes = new Set<string>();
  const cleanedRules = (rules ?? []).map((r, i) => ({ rule: r, index: i }));

  for (const { rule, index } of cleanedRules) {
    const categoryPrefix = (rule.categoryPrefix ?? '').trim().replace(/\/+$/, '');
    const repo = (rule.repo ?? '').trim();
    if (categoryPrefix.length === 0 || repo.length === 0) {
      rejected.push({ index, reason: 'rule must have non-empty categoryPrefix and repo' });
      continue;
    }
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) {
      rejected.push({ index, reason: `repo "${repo}" must be in owner/repo form` });
      continue;
    }
    if (claimedPrefixes.has(categoryPrefix)) {
      rejected.push({ index, reason: `duplicate categoryPrefix "${categoryPrefix}"` });
      continue;
    }
    claimedPrefixes.add(categoryPrefix);
    const branch = rule.branch?.trim() || fallback.branch;
    const subdir = (rule.subdir?.trim() || fallback.subdir).replace(/^\/+|\/+$/g, '');
    routes.push({
      routeId: `rule:${index}:${categoryPrefix}`,
      repo,
      branch,
      subdir,
      ruleIndex: index,
      match: cat => categoryHasPrefix(cat, categoryPrefix),
    });
  }

  // Sort by descending prefix specificity so deeper rules win over shallower ones
  // when both are declared (e.g. Personal/Finance beats Personal).
  routes.sort((a, b) => b.routeId.length - a.routeId.length);

  // Default fallback route — matches anything no other route claimed.
  if (fallback.repo.trim().length > 0) {
    routes.push({
      routeId: 'default',
      repo: fallback.repo.trim(),
      branch: fallback.branch,
      subdir: fallback.subdir,
      ruleIndex: -1,
      match: cat => !routes.some(r => r.routeId !== 'default' && r.match(cat)),
    });
  }

  return { routes, rejected };
}

/**
 * Resolve the single route a note belongs to. Returns undefined when no
 * route matches (e.g. no rules + no default repo configured).
 */
export function routeForCategory(
  routes: RouteMatch[],
  category: string,
): RouteMatch | undefined {
  return routes.find(r => r.match(category));
}
