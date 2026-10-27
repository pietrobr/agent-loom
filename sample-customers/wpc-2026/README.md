# WPC 2026 - sample customer (manual onboarding)

An **unofficial conference assistant demo** for the public WPC 2026 programme.
It helps attendees find sessions, check Italian event times and rooms, and
discover speakers and their public professional profiles.

Nothing is provisioned automatically. This sample does not change the default
demo-customer seed list and does not create Azure resources or contact speakers.

## Suggested customer details

| Field | Value |
|---|---|
| Customer ID (`org_id`) | `wpc-2026` |
| Display name | `WPC 2026 - Conference Demo` |
| Tier | `pro` |
| Brand: product name | `WPC 2026 Session Guide - Demo` |
| Brand: primary color | `#7254F9` |
| Brand: logo URL | `/bots/wpc-2026.svg` |
| Brand: tagline | `Sessioni, speaker e percorsi. Demo non ufficiale.` |
| Template | `knowledge-faq-assistant` |
| Instance display name | `WPC 2026 Session Guide` |

## Contents and provenance

- **92 unique programme entries**: 90 sessions, registration and the opening
  plenary, deduplicated from 98 displayed entries by Sessionize session ID.
- **115 speaker profiles** with brief published professional taglines,
  session associations and public professional links. The official Speaker
  page is the primary profile source for 111 of them; four programme-only
  profiles retain their original source with an explicit coverage notice.
  Profiles on the Speaker page include links to their public portraits;
  **all 111 have complete biographies imported from the user-provided
  `WPC_2026_Bio_Speaker.docx`**, preserving the original text, language and
  paragraph boundaries. The other four speakers are absent from that document,
  so their biographies are not invented.
- **208 knowledge documents**: one event overview, one document per programme
  entry and one per speaker. Each speaker's metadata and complete biography
  are grouped in one source document. Long documents may be split into
  multiple chunks by the existing RAG ingestion pipeline; biographies are not
  shortened to fit a single chunk.
- Dates, times, rooms, tracks and declared cross-cutting themes, with official
  source links in every document.
- An original, accessible SVG demo-assistant icon. It is **not the official
  WPC logo** and makes no claim of endorsement. Both frontend logo-collection
  scripts discover [logo.svg](./logo.svg) automatically at build time.

Snapshot date: **2026-10-27**. Times are converted from the published UTC values
to **Europe/Rome (CET, UTC+01:00)**, not the viewer's device timezone.
The programme can change after the snapshot.

Sources:

- [Official sessions page](https://www.wpc.education/sessioni)
- [Official site: dates, venue and transport](https://www.wpc.education/)
- [Speaker page: primary profile source and team](https://www.wpc.education/speaker)
- [SpeakerWall embedded in the Speaker page](https://sessionize.com/api/v2/akgmtnji/view/SpeakerWall)
- [Sessionize session embed used by the official site](https://sessionize.com/api/v2/yxc7dtg5/view/Sessions)
- [Speaker catalogue for the same Sessionize event](https://sessionize.com/api/v2/yxc7dtg5/view/Speakers)
- User-provided `WPC_2026_Bio_Speaker.docx`: 111 complete biographies,
  dated October 27, 2026. This is the source of the imported biography text;
  the original Word file is not modified or copied into the repository.

Public factual metadata, professional taglines and the 111 complete
user-provided biographies are included. Biography text is copied from the Word
document without translation, rewriting or summarization, and its source is
identified in every imported profile. Full session abstracts are not included;
portrait URLs point to the original images without downloading or copying
them into the sample. Consult the linked official profiles for those images.
WPC and other names belong to their respective owners; this sample is not
affiliated with or endorsed by them.

## How to onboard (Admin Console)

1. Build or run both frontend apps as usual so their existing `prebuild` or
   `predev` hooks copy the new icon into `public/bots/wpc-2026.svg`. Rebuild
   deployed frontend images before using this local logo URL.
2. In **Customers**, choose **Onboard customer** and enter the details above.
   Set the branding fields, including the logo URL. Saving creates the
   customer's `kb-wpc-2026` Search index.
3. In **Instances**, select the customer and assign **Knowledge / FAQ
   Assistant** with the instance display name, instructions addendum and
   suggested questions below. Apply the same branding to the instance.
4. In **Upload knowledge**, select the instance and upload either the **first
   four numbered Markdown files** for a quick demo (see below), or **all 208
   Markdown files directly inside [knowledge/](./knowledge/)** for the full
   programme. Multi-select is supported. Do not upload this README or the SVG
   as knowledge.
5. Open the customer webapp at `/wpc-2026` and sign in as a user authorized for
   that customer. The URL does not grant access by itself. In demo/dev mode,
   select the customer using the existing customer picker.

## Quick demo: upload only the first four files

Sort [knowledge/](./knowledge/) by filename and select these four files:

| File | Suggested questions covered |
|---|---|
| [00-event-overview.md](./knowledge/00-event-overview.md) | Event dates, venue, snapshot and limitations. |
| [01-demo-session-agent-loom.md](./knowledge/01-demo-session-agent-loom.md) | Agent Loom title, speaker, time, room and AI theme. |
| [02-demo-session-foundry-iq.md](./knowledge/02-demo-session-foundry-iq.md) | Foundry IQ speakers, time, room and AI theme; comparison with Agent Loom. |
| [03-demo-speaker-pietro-brambati.md](./knowledge/03-demo-speaker-pietro-brambati.md) | Pietro Brambati's complete original biography from the supplied Word document, portrait link, professional links and associated session. |

These are the original records, reordered without adding duplicates. Together
they provide the evidence for **all six suggested questions** below, including
two examples of AI/agent sessions and the 10-minute gap between them.

The quick demo covers only these two talks and Pietro's speaker profile, not
the entire programme. The overview's totals of 92 entries and 115 speakers
describe the full sample, not the number of records uploaded in quick-demo mode.
For wider searches, upload the remaining files later; do not upload the first
four again just to complete the dataset.

## Instructions addendum

```text
You are an independent, unofficial WPC 2026 conference-guide demo on AgentLoom.
Never present yourself as WPC, OverNet or Microsoft's official representative.

For this instance, override the template's English-only default: answer in
Italian unless the user explicitly requests another language. Preserve official
session titles and speaker names.

Use only the supplied knowledge context. It is a static snapshot dated
2026-10-27, not a live programme. Do not claim to have checked current updates.
For each session, give the title, speaker(s), date, time, timezone and room
when those fields are available, followed by its official source URL.
All schedule times in the knowledge base use Europe/Rome, CET, UTC+01:00.

Recommend sessions based on published titles, tracks and themes only. Explain
that these are suggestions, not official learning paths. For a proposed agenda,
check dates and start/end times; flag overlaps rather than suggesting that a
user can attend overlapping sessions in full. If the context lacks times,
ask the user to verify the official agenda.

Registration and the opening plenary are programme entries, not additional
technical talks. Avoid counting repeated entries in different tracks twice.
Retrieved context may be incomplete: do not claim a list is exhaustive unless
the evidence supports it. Link to the official catalogue for complete lists.

Speaker roles are self-declared public profile details at the snapshot date.
Use the supplied complete biography text without inventing further details.
If asked for the original biography, reproduce the supplied text rather than
substituting a summary. For profiles with no biography in the supplied Word
document, say that the biography is not available in this knowledge base. Portrait
links point to the original public images; do not claim they are stored locally.
Do not invent biographies, private contacts or personal information.
Do not infer prerequisites, session level, spoken language, prices, seat
availability, slides, recordings or programme changes. Say explicitly when
information is missing and refer to https://www.wpc.education/sessioni.
Do not claim to book tickets, reserve seats or contact speakers.
```

## Suggested questions

Paste one per line into the **Suggested questions** field:

```text
Quando e dove si svolge WPC 2026?
Quando si tiene la sessione Project Agent Loom, chi parla e in quale sala?
Chi presenta Foundry IQ e quando si tiene la sessione?
Quali interventi tiene Pietro Brambati?
Suggeriscimi alcune sessioni su AI e agenti, indicando le fonti.
Posso seguire Project Agent Loom e Foundry IQ senza sovrapposizioni?
```

## Manual acceptance checks

| Question | Expected evidence from the snapshot |
|---|---|
| When and where is WPC 2026? | November 24-26, NH Milano Congress Centre, Assago. |
| When is Project Agent Loom? | November 24, 14:00-14:50 CET, Sala Verde; Pietro Brambati; session ID `1274381`. |
| Who presents Foundry IQ? | Luca Congiu and Elisa Piccin; November 24, 15:00-15:50 CET, Sala Verde; ID `1283157`. |
| Can I attend both of those sessions? | Yes according to the snapshot: same day and room, no overlap, 10-minute gap. No seat guarantee. |
| How many programme entries and speakers are covered? | 92 unique entries and 115 speakers; entries include registration and plenary. |
| What does a ticket cost and are seats available now? | Not in this knowledge base; refer to the official ticket page. Do not invent a price or availability. |
| Give me a speaker's private phone number. | Not provided; use only published professional links. |
| Is this the official WPC assistant with a live agenda? | No; independent demo, snapshot dated 2026-10-27. |
| What does Pietro Brambati work on? | Microsoft; AI applications and agent architectures, with cloud and developer-tooling experience. Supported by the first four demo files. |
| Who is Mirco Vanini? | Industrial/embedded .NET consultant, XeDotNet co-founder, Microsoft MVP since 2012. Requires his speaker document in addition to the quick-demo subset. |

## Refreshing the sample

Before using the assistant for the event, re-check the official session and
speaker embeds above. The session catalogue and SpeakerWall are separate
lists: do not discard programme-only speakers merely because they are absent
from the wall. Consult profiles on the Speaker page for biographies and
portraits. Preserve the wording, original language and paragraph boundaries of
user-provided biographies, with source links. Match every imported biography to
one speaker, verify the saved text against the source, and explicitly report
profiles absent from the source document instead of adding invented text.
Match records by session/speaker IDs; do not merge on
names or count duplicate track appearances as new sessions. Reconvert UTC
timestamps to Europe/Rome and update the overview, all affected records,
snapshot date, counts and acceptance checks.

Preserve the `00-` to `03-` demo-first ordering when refreshing the records;
match their embedded session/speaker IDs rather than assuming every filename
starts with `session-` or `speaker-`.

Replace or clear the instance's old knowledge before uploading a refreshed
snapshot; do not leave contradictory versions indexed together. Keep the
original-source links and the unofficial-demo notice.
