import type { AgentRow } from '../db/schema';

declare global {
  namespace Express {
    interface Request {
      /** Set by loadAgent() when the request carries a valid X-Agent-Id */
      agent?: AgentRow;
    }
  }
}

export {};
