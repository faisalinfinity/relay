# Process notes

The full working log, one entry per decision or surprise, is in
[docs/decision-log.md](docs/decision-log.md). This page is the summary.

## How I broke it down

In the order I built it, one branch per part:

1. **Repo and tooling.** pnpm workspace, strict TypeScript, lint, Postgres with pgvector in Docker.
2. **API and the claim rule.** First, because everything else depends on ticket ownership being right.
   CI went in here rather than at the end, so every later push was checked.
3. **Live inbox.** The event log and WebSocket hub first, then the React UI on top of them.
4. **Suggested replies.** Ingest, retrieval and drafting as separate functions, then the evaluation,
   then the panel.
5. **Write-up and one-command setup.**

Each part went in as one commit when it was done; the decision log is the step-by-step record.

## Decisions I went back and forth on

- **One owner.** One conditional `UPDATE … WHERE owner_id IS NULL`, not read-then-write or an
  advisory lock. The row lock is the mutex, and it holds across any number of API instances.
- **WebSocket or SSE.** WebSocket, because presence needs the browser to talk back, and a closed
  socket is itself the "they left" signal.
- **Merging updates in the browser.** I first patched each cached list on every event, then switched
  to one store where the highest ticket `version` wins and queues are derived from it. A slow response
  can no longer bring back an old owner.
- **One cut-off or two gates.** The evaluation showed that answerable and unanswerable questions
  overlap in similarity, so the cut-off only drops clearly unrelated tickets, and the model judges
  whether an excerpt actually answers.

## Three prompts I used

1. Drafted with the AI from my note, then run as written:

   > Before I submit, check main against the brief line by line. For every requirement (the four parts, the ground rules and "What to submit"), find where it is met: the file, the test that proves it, or the README section. Mark each met, partly met or missing, and for anything not fully met say what's missing and how long a fix would take. Don't trust the README's own claims: open the code or run the test. Don't change code; report.

   Why: a check against the brief itself, not my memory of it. It confirmed the race test really
   races and a resend makes one ticket, and flagged the weakest spot: the local 3B model still drafts
   for some questions no article covers.

2. Drafted with the AI from my note, then run as written:

   > Reviewers will run this on their own laptops, so check that main works from nothing. Clone main from GitHub into a new folder, build with no Docker cache and empty volumes, and run the exact README command. Time it until the log says "Relay API listening". Then use it like a reviewer: send test tickets with the README commands (new, resent, bad signature), open two browsers as two agents and check presence, typing, a live claim and the loser's 409, and get one suggestion for a covered ticket and one for an uncovered ticket. Report what happened, then clean up containers, volumes and the image.

   Why: passing on my laptop isn't passing on a reviewer's. From a fresh clone it was ready in 2 min
   45 s and every check passed, including a real simultaneous claim. It also caught one draft where
   the small model leaked chat-template text (`}user assistant`) into the reply.

3. Drafted with the AI from my notes on the bug, then run as written:

   > The suggested reply for ticket #1022 ("How do I refund someone") ends with "...then proceed with the refund as described in." The model wrote "as described in [1]", and finishReply in apps/api/src/suggestions/draft.ts deletes every [n] marker, so the sentence is left hanging. An agent who inserts the draft without reading it closely would send that to the customer.
   >
   > Fix it so that a marker which completes a phrase ("as described in [1]", "see [2]") is replaced with the title of the cited article in quotes, and any other marker is still removed. Look the title up by the excerpt number. Leave the article links at the end of the reply as they are.
   >
   > Write the test first with this exact refund sentence, run it and show me it fails, then make the change. The existing finishReply tests must keep passing.
   >
   > Two small setup fixes in the same change, because reviewers will run this on their own laptops:
   >
   > - pin ollama/ollama to 0.40.17 in docker-compose.yml, the version I tested from a clean clone
   > - in the README's run section, say Docker needs about 4 GB of memory (the Ollama container used 2.8 GB), and to wait for "Relay API listening" in the log before opening the page
   >
   > Then run typecheck, lint, the tests and format:check.

   Why: I found the bug by running the Docker setup from a fresh clone, the way a reviewer would.
   Giving the real example, the rule and a failing test first got a fix I could check, not a guess.

## Where the AI was wrong

While building the live inbox, the AI wrote a test meant to show that events committed _while_ a
reconnecting browser catches up are neither lost nor duplicated. It passed, and it still passed with
the code it protected deleted: the "concurrent" events always landed after the replay. I caught it by
breaking the code on purpose to see whether the test noticed. The fix injects the replay read, so the
test commits events just before and just after it; it now fails for each of three ways of breaking
that code. The claim-race test got the same check: remove `owner_id IS NULL` and every race test fails.

## In my own words

**What an embedding model does that a chat model does not:** It turns text into a list of numbers
(a vector) that stands for its meaning, so texts about the same thing land close together. That lets
me measure which help sections are nearest to a ticket. It writes nothing. A chat model writes text
but gives no such distance. So the embedding model finds the articles, and the chat model writes the
reply from them.

**Why I chose this chunk size:** One chunk is one `##` section of an article, at most 220 words, with
the article title and heading on top. Each section answers one question, so one chunk is one answer.
Whole articles mix answers and match loosely; tiny pieces lose their context. The title and heading
help short sections, like an error code, match. The 25 articles make 122 chunks.

**Why vector search alone would miss a ticket that quotes an exact error code:** Vector search
compares meaning, not exact characters. To an embedding, SW-1042 and SW-1043 are nearly the same:
both are "a Slotwise error code". So a ticket quoting one can get another code's section, or a page
listing every code. In my evaluation, the SW-6029 question ranked the error-code list above the
SW-6029 article. A keyword search alongside would catch the exact match.

## Time and what I skipped

From my session timestamps: the start of each part to its commit, overnight breaks left out. Part 4
includes the final checks and fixes.

| Part                         | Time            |
| ---------------------------- | --------------- |
| Setup                        | 0.25 h          |
| 1 API and the claim rule     | 1 h             |
| 2 Live inbox                 | 0.75 h          |
| 3 Suggested replies          | 1 h             |
| 4 Pipeline, Docker, write-up | 3.5 h           |
| **Total**                    | **about 6.5 h** |

Skipped, roughly in the order I'd pick them up:

- Shared presence across API instances (Redis), and drafting in a background job when a ticket arrives
  (see DESIGN.md).
- A stronger "does this excerpt really answer it" check for the local model, which still drafts for 3
  of the 6 uncovered evaluation questions.
- Keyword search alongside vectors for exact error codes.
- Browser tests in CI. The two-agent flows were checked with Playwright scripts kept outside the repo.
- Real login, sending replies by email, reopening closed tickets, rate limiting on the webhook.
- A compiled production build; the container runs the TypeScript with `tsx`.
