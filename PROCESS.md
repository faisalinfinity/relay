# Process notes

A summary; every decision and surprise is in [docs/decision-log.md](docs/decision-log.md).

## How I broke it down

One branch per part, in this order: repo and tooling; the API and the claim rule, first because
everything depends on ownership, with CI from then on; the live inbox, event log before UI; suggested
replies, with search and drafting as separate functions, then the evaluation; the write-up and
one-command setup. Each part went in as one commit. Before submitting I reworded those commit messages
to say what each contains (content and dates unchanged); later fixes are separate commits.

## Decisions I went back and forth on

- **One owner:** a conditional `UPDATE … WHERE owner_id IS NULL`, not read-then-write. The row lock is
  the mutex, across any number of API instances.
- **Merging in the browser:** I first patched each cached list per event, then moved to one store
  where the highest ticket `version` wins, so a slow response can't bring back an old owner.
- **Saying "no article covers this":** similarity can't tell "on topic" from "answered", so the cut-off
  only drops unrelated tickets; the model judges the rest, and code checks the help centre names what
  was asked.

## Three prompts I used

My notes say what I asked for in my own words; the quoted prompts are ones the AI drafted with me and I
ran as written.

1. My note: "In Plan mode : I attached the requirements and ask it to divide each task in phases and then I tell tech-stacks to use"

   > Before I submit, check main against the brief line by line. For every requirement (the four parts, the ground rules and "What to submit"), find where it is met: the file, the test that proves it, or the README section. Mark each met, partly met or missing, and for anything not fully met say what's missing and how long a fix would take. Don't trust the README's own claims: open the code or run the test. Don't change code; report.

   Why: the brief drove the plan from the start, phase by phase with a stack I chose, so before
   submitting I used it again as the checklist. It found the weakest spot: the local model still
   drafted for questions no article covers.

2. My note: "I asked to to use hybrid model, a local modal and claud API key default is local model."

   > Reviewers will run this on their own laptops, so check that main works from nothing. Clone main from GitHub into a new folder, build with no Docker cache and empty volumes, and run the exact README command. Time it until the log says "Relay API listening". Then use it like a reviewer: send test tickets with the README commands (new, resent, bad signature), open two browsers as two agents and check presence, typing, a live claim and the loser's 409, and get one suggestion for a covered ticket and one for an uncovered ticket. Report what happened, then clean up containers, volumes and the image.

   Why: local by default means a reviewer needs no key, so it has to run from nothing on their
   laptop. From a fresh clone it was ready in 2 min 45 s, every check passed, and it caught a draft
   with leaked chat-template text.

3. My note, on that audit finding: "Review and fix all the findings and gaps and check if everything will work one anyone's device"

   > The local model still drafts confident replies for questions no article covers. "Can clients pay with crypto?" gets an answer from the deposits article, and the gift card and Zoom questions in the eval get drafts too. Make the draft step check that the excerpts actually mention what the customer is asking about, so those come back as "no article covers this", without losing any of the 12 answerable eval questions. Also, one cold-start draft leaked chat-template text ("}user assistant") mid-reply and rambled on: cut a draft off where that starts. Write failing tests first with these real examples, and run pnpm eval --generate before and after to prove it.

   Why: "no article covers this" is Part 3's headline rule. End to end went from 15/18 to 18/18, and
   the seed tickets reached 30/30.

## Where the AI was wrong

The AI wrote a test meant to prove that events committed _while_ a reconnecting browser catches up
are neither lost nor duplicated. It still passed with that code deleted: the "concurrent" events always
landed after the replay. I caught it by breaking the code on purpose. Injecting the replay read lets
the test commit events just before and after it, and it now fails for each of three ways of breaking
that code.

## In my own words

**What an embedding model does that a chat model does not:** It turns text into numbers (a vector)
that stand for its meaning, so texts about the same thing land close together and I can measure which
help sections are nearest a ticket. It writes nothing; a chat model writes but can't measure that. One
finds the articles, the other writes the reply.

**Why I chose this chunk size:** One `##` section per chunk, at most 220 words, with the article title
and heading on top. A section answers one question, so a chunk is one answer: whole articles mix
answers and match loosely, tiny pieces lose context.

**Why vector search alone would miss a ticket that quotes an exact error code:** It compares meaning,
not characters. SW-1042 and SW-1043 look nearly the same to an embedding, so a ticket can get another
code's section or a page listing every code; in my evaluation, SW-6029 ranked the code list above its
own article. Keyword search alongside catches the exact match.

## Time and what I skipped

From session timestamps, start of each part to its commit, breaks left out. Part 3 includes the later
fix for uncovered questions.

| Part                         | Time          |
| ---------------------------- | ------------- |
| Setup                        | 0.25 h        |
| 1 API and the claim rule     | 1 h           |
| 2 Live inbox                 | 0.75 h        |
| 3 Suggested replies          | 2 h           |
| 4 Pipeline, Docker, write-up | 4 h           |
| **Total**                    | **about 8 h** |

Skipped, in the order I'd pick them up: shared presence across instances and drafting in a background
job (DESIGN.md); keyword search for exact error codes; browser tests in CI (the two-agent flows were
checked with Playwright scripts outside the repo); real login, emailing replies and webhook rate limits.
