import {
  ListTicketsQuery,
  ReplyBody,
  TicketParams,
  type DataResponse,
  type OwnerFilter,
  type ReplyResult,
  type TicketDetail,
  type TicketPage,
  type TicketSummary,
} from '@relay/shared';
import { Router, type Request } from 'express';
import type { Db } from '../db/client';
import { requireAgent } from '../http/agent';
import { parse } from '../http/validate';
import {
  claimTicket,
  closeTicket,
  getTicketDetail,
  listTickets,
  releaseTicket,
  replyToTicket,
  type OwnerQuery,
} from './service';

export function ticketsRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parse(ListTicketsQuery, req.query);
    const page: TicketPage = await listTickets(db, {
      status: query.status,
      owner: resolveOwner(query.owner, req),
      limit: query.limit,
      cursor: query.cursor === undefined ? undefined : Number(query.cursor),
    });
    res.json(page);
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(TicketParams, req.params);
    const body: DataResponse<TicketDetail> = { data: await getTicketDetail(db, id) };
    res.json(body);
  });

  router.post('/:id/claim', async (req, res) => {
    const agent = requireAgent(req);
    const { id } = parse(TicketParams, req.params);
    const body: DataResponse<TicketSummary> = { data: await claimTicket(db, id, agent) };
    res.json(body);
  });

  router.post('/:id/release', async (req, res) => {
    const agent = requireAgent(req);
    const { id } = parse(TicketParams, req.params);
    const body: DataResponse<TicketSummary> = { data: await releaseTicket(db, id, agent) };
    res.json(body);
  });

  router.post('/:id/reply', async (req, res) => {
    const agent = requireAgent(req);
    const { id } = parse(TicketParams, req.params);
    const reply = parse(ReplyBody, req.body);
    const body: DataResponse<ReplyResult> = {
      data: await replyToTicket(db, id, agent, reply.body),
    };
    res.status(201).json(body);
  });

  router.post('/:id/close', async (req, res) => {
    const agent = requireAgent(req);
    const { id } = parse(TicketParams, req.params);
    const body: DataResponse<TicketSummary> = { data: await closeTicket(db, id, agent) };
    res.json(body);
  });

  return router;
}

function resolveOwner(owner: OwnerFilter | undefined, req: Request): OwnerQuery | undefined {
  if (owner === undefined) return undefined;
  if (owner === 'unassigned') return { kind: 'unassigned' };
  if (owner === 'me') return { kind: 'agent', agentId: requireAgent(req).id };
  return { kind: 'agent', agentId: owner };
}
