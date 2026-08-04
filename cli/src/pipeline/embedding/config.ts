import { homedir } from 'node:os';
import { join } from 'node:path';

/** BAAI, MIT-licensed, 384 dimensions. Strong on short informal text, no native build.
 *  Runner-up all-MiniLM-L6-v2 was smaller and measurably weaker on the harder behaviours. */
export const MODEL = 'Xenova/bge-small-en-v1.5';

/** These four values are one pipeline identity. A runtime, model, or batching change changes every
 *  fingerprint, so it is a versioned and announced rebuild rather than a silent implementation
 *  detail. pool.yml reads them here because this dependency-light module is the single source. */
export const RUNTIME_VERSION = '1.0.0';
/** Verified against the registry's dist.integrity for @stratless/runtime@1.0.0 on 2026-07-27. */
export const RUNTIME_TARBALL_SHA512 = 'UMoC9fxboRma2740GoMWSieCgcZ8YjgcmLakhLJxlFfQOlEj4FgYUIVEhiijOJU51cR4anwMeK3O7tj43SyADw==';
/** bge-small-en-v1.5 int8 ONNX weights; drift changes what "similar" means and is a refusal. */
export const MODEL_WEIGHTS_SHA256 = '6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4';

/** The fetched runtime stays outside node_modules so npm reinstalls do not fetch it again. */
export const runtimeDir = (): string => process.env.STRATLESS_RUNTIME_DIR || join(homedir(), '.stratless', 'runtime');
/** Weights sit beside the person's stores so `stop` can account for everything stratless placed. */
export const modelDir = (): string => process.env.STRATLESS_MODELS || join(homedir(), '.stratless', 'models');
