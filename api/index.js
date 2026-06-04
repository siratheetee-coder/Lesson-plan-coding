// Vercel serverless entry — re-exports the Express app from /server.
// All /api/* and /auth/* requests are rewritten to /api (this file) by vercel.json.
import app from '../server/server.js';
export default app;
