import type { Agent, DataResponse } from '@relay/shared';
import { asc } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/client';
import { agents } from '../db/schema';

export function agentsRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const rows = await db
      .select({ id: agents.id, name: agents.name, email: agents.email })
      .from(agents)
      .orderBy(asc(agents.name));
    const body: DataResponse<Agent[]> = { data: rows };
    res.json(body);
  });

  return router;
}
