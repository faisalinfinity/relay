import { TicketParams, type DataResponse, type Suggestion } from '@relay/shared';
import { Router } from 'express';
import { z } from 'zod';
import { ModelOutputError, ModelUnavailableError } from '../ai/models';
import { AppError } from '../http/errors';
import { parse } from '../http/validate';
import type { SuggestionService } from './service';

const SuggestionQuery = z.object({ refresh: z.enum(['true', 'false']).optional() });

export function suggestionsRouter(service: SuggestionService): Router {
  const router = Router();

  /** A suggested reply for the ticket. ?refresh=true drafts a new one instead of reusing the last. */
  router.get('/:id/suggestion', async (req, res) => {
    const { id } = parse(TicketParams, req.params);
    const { refresh } = parse(SuggestionQuery, req.query);
    try {
      const body: DataResponse<Suggestion> = {
        data: await service.forTicket(id, { refresh: refresh === 'true' }),
      };
      res.json(body);
    } catch (error) {
      if (error instanceof ModelUnavailableError) {
        throw new AppError('SUGGESTIONS_UNAVAILABLE', error.message);
      }
      if (error instanceof ModelOutputError) {
        throw new AppError('SUGGESTION_FAILED', error.message);
      }
      throw error;
    }
  });

  return router;
}
