/**
 * Importing anything from this package loads the root `.env` exactly once, so no
 * other package needs to know where the repo root is or that dotenv exists.
 */
export {
  env,
  repoRoot,
  rootPath,
  dataPath,
  MissingEnvError,
  type Env,
} from "./env.ts";

export { ConfigSchema, loadConfig, type Config } from "./schema.ts";
