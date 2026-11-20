import {
  ApiErrorBody,
  type Agent,
  type DataResponse,
  type ReplyResult,
  type TicketDetail,
  type TicketPage,
  type TicketSummary,
} from '@relay/shared';
import { VIEW_QUERY, type QueueView } from '../live/views';

/** Every failed request becomes one of these, carrying the API's error code and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      "Can't reach the Relay server. Check your connection and try again.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;

  const parsed = ApiErrorBody.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    throw new ApiError(response.status, code, message, details);
  }
  throw new ApiError(response.status, 'UNKNOWN', `The server answered ${response.status}.`);
}

export async function fetchAgents(): Promise<Agent[]> {
  return (await request<DataResponse<Agent[]>>('/api/agents')).data;
}

/** API calls made as one agent. */
export function createApi(agentId: string) {
  const headers = { 'X-Agent-Id': agentId };

  const post = async <T>(path: string, json?: unknown): Promise<T> => {
    const body = await request<DataResponse<T>>(path, {
      method: 'POST',
      headers: json === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return body.data;
  };

  return {
    listTickets(view: QueueView, cursor: string | null): Promise<TicketPage> {
      const params = new URLSearchParams({ ...VIEW_QUERY[view], limit: '25' });
      if (cursor) params.set('cursor', cursor);
      return request<TicketPage>(`/api/tickets?${params.toString()}`, { headers });
    },
    async getTicket(id: string): Promise<TicketDetail> {
      return (await request<DataResponse<TicketDetail>>(`/api/tickets/${id}`, { headers })).data;
    },
    claim: (id: string) => post<TicketSummary>(`/api/tickets/${id}/claim`),
    release: (id: string) => post<TicketSummary>(`/api/tickets/${id}/release`),
    close: (id: string) => post<TicketSummary>(`/api/tickets/${id}/close`),
    reply: (id: string, body: string) => post<ReplyResult>(`/api/tickets/${id}/reply`, { body }),
  };
}

export type Api = ReturnType<typeof createApi>;
