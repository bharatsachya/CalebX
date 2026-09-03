export {
  adminPrincipal,
  isUserPrincipal,
  isWellFormed,
  ownsId,
  principalLabel,
  systemPrincipal,
  userPrincipal,
  type AdminPrincipal,
  type Principal,
  type PrincipalKind,
  type SystemPrincipal,
  type UserPrincipal,
} from "./principal.ts";

export {
  ownedBy,
  shared,
  type Action,
  type ResourceKind,
  type ResourceRef,
} from "./resource.ts";

export { authorize, type Decision, type Projection } from "./policy.ts";

export { assertAuthorized, can, filterAuthorized } from "./guard.ts";

export {
  anonymizePeer,
  peerHandle,
  project,
  projectAll,
  type AnonymizedPeer,
  type PeerProfile,
} from "./projection.ts";

export {
  CYPHER_BULK_MARKER,
  SQL_BULK_MARKER,
  SQL_DISCOVERABLE_MARKER,
  assertBulkAllowed,
  assertCypherScoped,
  assertSqlScoped,
  isCypherScoped,
  isSqlScoped,
  ownerPredicate,
  scopedCypher,
  scopedSql,
  type CypherExecutor,
  type SqlExecutor,
} from "./scope.ts";
