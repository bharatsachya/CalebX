import type { ToolDefinition } from "@calebx/core";
import type { CommunityContext } from "../context.ts";
import { savePersonaChunk } from "./persona.tool.ts";
import { findLikeMindedPeople } from "./people.tool.ts";
import { searchCommunityGroups } from "./groups.tool.ts";
import { getCuratedPlaces } from "./places.tool.ts";

/**
 * The community subagent's tools.
 *
 * The recurring shape is: traverse the graph for a candidate set, then rank it.
 * Never the other way round — an unconstrained vector search across all users is
 * both slower and a privacy boundary violation, so every retrieval starts from
 * this user's node.
 *
 * Order matters only for the recommendation pass, which runs them in this
 * sequence (people, then groups, then places) and keeps whatever answered.
 */
export const COMMUNITY_TOOLS: readonly ToolDefinition<CommunityContext>[] = [
  savePersonaChunk,
  findLikeMindedPeople,
  searchCommunityGroups,
  getCuratedPlaces,
] as const;

export { savePersonaChunk } from "./persona.tool.ts";
export { findLikeMindedPeople } from "./people.tool.ts";
export { searchCommunityGroups } from "./groups.tool.ts";
export { getCuratedPlaces } from "./places.tool.ts";
