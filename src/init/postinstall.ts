/**
 * Runs on `npm install` when the SDK is added as a dependency.
 * Creates e2e folder structure and default config/locators/feature in the consumer project.
 * Uses INIT_CWD (project root where npm install was run); skips overwriting existing files.
 */
import * as path from 'path';
import { scaffold } from './scaffold';

const consumerRoot = process.env.INIT_CWD || process.cwd();
scaffold({ consumerRoot: path.resolve(consumerRoot), force: false });
