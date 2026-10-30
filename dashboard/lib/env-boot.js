// Imported first by each program (dashboard/server.js, bin/starbase.js, the demo): fills the
// STARBASE_* names from their old names before any other module reads process.env (lib/env-names.js).
import { withOldNames } from './env-names.js';

withOldNames(process.env);
