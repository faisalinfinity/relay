/** A help-centre article a suggestion drew on. */
export interface ArticleRef {
  slug: string;
  title: string;
  url: string;
}

/** One chunk the search returned, shown so the agent can see why a suggestion says what it says. */
export interface RetrievedChunk {
  slug: string;
  title: string;
  heading: string;
  /** cosine similarity between the ticket and this chunk, 0..1 */
  similarity: number;
  /** true when it cleared the relevance cut-off and was given to the chat model */
  used: boolean;
}

interface SuggestionBase {
  retrieved: RetrievedChunk[];
  models: { embedding: string; chat: string };
  createdAt: string;
}

export type Suggestion =
  | (SuggestionBase & {
      status: 'drafted';
      /** ready to insert into the reply box; ends with links to the articles it used */
      reply: string;
      sources: ArticleRef[];
    })
  | (SuggestionBase & {
      status: 'no_coverage';
      /**
       * no_relevant_articles: nothing cleared the cut-off, so the chat model was never asked.
       * model_declined: there were articles, but the model said they don't answer the question.
       * not_grounded: the model said an excerpt answers it but named one it was never given,
       *   so Relay discarded the draft.
       * not_in_help_centre: the model drafted a reply, but no article mentions what the customer
       *   asked about (listed in `missing`), so Relay discarded the draft.
       */
      reason: 'no_relevant_articles' | 'model_declined' | 'not_grounded' | 'not_in_help_centre';
      missing?: string[];
    });
