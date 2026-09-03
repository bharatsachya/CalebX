import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { KnowsEdge, UserInterests } from "@calebx/graph";

/**
 * Turning a set of users into cohorts that can become groups.
 *
 * Two mechanisms, in this order:
 *
 * 1. **Tag cohorts** — `category + city`. This is what actually produces
 *    "cafe likers in Delhi" on day one, at twenty users, where Louvain returns
 *    one blob or a pile of singletons.
 * 2. **Louvain** — community detection over the `KNOWS` graph, run in-process
 *    with graphology rather than in the database, because hosted AuraDB does not
 *    ship the GDS library that `gds.louvain` needs.
 *
 * Both write the same `communityId`, so nothing downstream changes when the
 * second takes over from the first.
 */

/** A cohort key is stable, lowercase, and readable in a log line. */
export function cohortKey(category: string, city: string): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${clean(category)}:${clean(city)}`;
}

export interface TagCohort {
  cohortKey: string;
  category: string;
  city: string;
  members: string[];
}

/**
 * Vocabulary that maps a chunk's free text onto a cohort category.
 *
 * Deliberately a small controlled list rather than anything learned: a cohort
 * becomes a real Telegram group with a real name, so the categories have to be
 * ones a human would agree to create a group for.
 */
export const COHORT_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  cafe: ["cafe", "coffee", "espresso", "filter coffee", "work cafe"],
  coworking: ["coworking", "co-working", "workspace", "shared office"],
  fitness: ["gym", "running", "cycling", "yoga", "climbing", "swim"],
  outdoors: ["trek", "trekking", "hike", "hiking", "camping", "trail"],
  tech: [
    "indie hacker",
    "startup",
    "developer",
    "ai",
    "programming",
    "hackathon",
  ],
  music: ["gig", "concert", "band", "vinyl", "music"],
  books: ["book", "reading", "library", "poetry"],
  food: ["street food", "supper club", "cooking", "restaurant"],
};

/** First matching category, or null. */
export function categoriseInterest(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(COHORT_CATEGORIES)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return null;
}

export interface CohortInput extends UserInterests {
  city: string | null;
}

/**
 * Groups users by (category, city).
 *
 * A user with no city is skipped rather than pooled into a global cohort: a
 * "cafe likers" group spanning three countries is not a group anyone wants to
 * be added to.
 */
export function buildTagCohorts(
  users: CohortInput[],
  minMembers = 3,
): TagCohort[] {
  const buckets = new Map<string, TagCohort>();

  for (const user of users) {
    if (!user.city) continue;
    const categories = new Set<string>();
    for (const interest of user.interests) {
      const category = categoriseInterest(interest);
      if (category) categories.add(category);
    }
    for (const category of categories) {
      const key = cohortKey(category, user.city);
      const bucket = buckets.get(key) ?? {
        cohortKey: key,
        category,
        city: user.city,
        members: [],
      };
      if (!bucket.members.includes(user.userId))
        bucket.members.push(user.userId);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()]
    .filter((cohort) => cohort.members.length >= minMembers)
    .sort(
      (a, b) =>
        b.members.length - a.members.length ||
        a.cohortKey.localeCompare(b.cohortKey),
    );
}

/**
 * Louvain community detection over the `KNOWS` graph.
 *
 * Returns a userId → communityId map. An empty or edgeless graph returns an
 * empty map rather than assigning everyone to community 0 — "we could not
 * cluster this" and "everyone is one community" must not look the same
 * downstream.
 */
export function louvainCommunities(
  edges: KnowsEdge[],
  options: { minComponentSize?: number } = {},
): Map<string, number> {
  const result = new Map<string, number>();
  if (edges.length === 0) return result;

  const graph = new Graph({ type: "undirected", multi: false });
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (!graph.hasNode(edge.from)) graph.addNode(edge.from);
    if (!graph.hasNode(edge.to)) graph.addNode(edge.to);
    if (!graph.hasEdge(edge.from, edge.to)) {
      graph.addUndirectedEdge(edge.from, edge.to, {
        weight: Number.isFinite(edge.strength) ? edge.strength : 1,
      });
    }
  }
  if (graph.order === 0 || graph.size === 0) return result;

  const assignments = louvain(graph, { getEdgeWeight: "weight" }) as Record<
    string,
    number
  >;

  // Singletons and pairs are not communities in any useful sense; leaving them
  // unassigned keeps them out of group suggestions until the graph fills in.
  const minSize = options.minComponentSize ?? 3;
  const sizes = new Map<number, number>();
  for (const community of Object.values(assignments)) {
    sizes.set(community, (sizes.get(community) ?? 0) + 1);
  }
  for (const [userId, community] of Object.entries(assignments)) {
    if ((sizes.get(community) ?? 0) >= minSize) result.set(userId, community);
  }
  return result;
}
