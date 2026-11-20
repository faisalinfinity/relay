import type { Agent } from '@relay/shared';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { readAgentId, saveAgentId } from './agent';
import { fetchAgents } from './api/client';
import { Inbox } from './components/Inbox';
import { EmptyState, ErrorState, Spinner } from './components/Status';
import { LiveProvider } from './live/LiveProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live events keep cached data current, so there is no need to refetch on a timer or on
      // focus. After a reconnect that can't be replayed, everything is refetched explicitly.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

function Shell() {
  const agents = useQuery({ queryKey: ['agents'], queryFn: fetchAgents });
  const [agentId, setAgentId] = useState(readAgentId);

  const pick = (id: string | null) => {
    saveAgentId(id);
    // Another agent sees different "Mine" lists and presence: start from nothing
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'agents' });
    setAgentId(id);
  };

  if (agents.isPending) {
    return (
      <div className="fullpage">
        <Spinner label="Loading Relay…" />
      </div>
    );
  }
  if (agents.isError) {
    return (
      <div className="fullpage">
        <ErrorState
          title="Relay can't reach its API"
          message={agents.error.message}
          onRetry={() => void agents.refetch()}
        />
      </div>
    );
  }

  const me = agents.data.find((agent) => agent.id === agentId);
  if (!me) return <AgentGate agents={agents.data} onPick={pick} />;

  return (
    <LiveProvider
      key={me.id}
      me={me}
      onRejected={() => {
        // The agent no longer exists (e.g. the database was re-seeded): choose again
        pick(null);
        void agents.refetch();
      }}
    >
      <Inbox agents={agents.data} onSwitchAgent={pick} />
    </LiveProvider>
  );
}

function AgentGate({ agents, onPick }: { agents: Agent[]; onPick: (id: string) => void }) {
  return (
    <main className="fullpage gate">
      <h1>Relay</h1>
      <p>
        Who is working the queue? There is no login in this demo, so pick an agent. Each browser tab
        can be a different agent.
      </p>
      {agents.length === 0 ? (
        <EmptyState title="No agents yet">
          <p>
            Run <code>pnpm db:seed</code> and reload.
          </p>
        </EmptyState>
      ) : (
        <ul className="gate-list">
          {agents.map((agent, index) => (
            <li key={agent.id}>
              <button
                type="button"
                className="button"
                autoFocus={index === 0}
                onClick={() => onPick(agent.id)}
              >
                {agent.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
