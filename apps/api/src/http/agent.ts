import { eq } from 'drizzle-orm';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { Db } from '../db/client';
import { agents, type AgentRow } from '../db/schema';
import { AppError } from './errors';

/**
 * There is no login: the acting agent is whoever the X-Agent-Id header names.
 * The UI fills it from an agent picker.
 */
export const AGENT_HEADER = 'X-Agent-Id';

const AgentId = z.uuid();

/** Resolves X-Agent-Id (when present) to an agent and puts it on req.agent. */
export function loadAgent(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get(AGENT_HEADER);
    if (header === undefined) {
      next();
      return;
    }
    const id = AgentId.safeParse(header);
    const [agent] = id.success
      ? await db.select().from(agents).where(eq(agents.id, id.data)).limit(1)
      : [];
    if (!agent) {
      throw new AppError('UNKNOWN_AGENT', `${AGENT_HEADER} "${header}" is not a known agent.`);
    }
    req.agent = agent;
    next();
  };
}

export function requireAgent(req: Request): AgentRow {
  if (!req.agent) {
    throw new AppError('AGENT_REQUIRED', `Send the ${AGENT_HEADER} header to act as an agent.`);
  }
  return req.agent;
}
