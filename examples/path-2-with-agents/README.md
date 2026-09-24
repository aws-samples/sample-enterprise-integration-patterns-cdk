# Path 2 walkthrough: five BizTalk interfaces, two agents, one handoff

A scripted demo of the agent-assisted path. You play an integration lead at a mid-size retailer
whose BizTalk Server 2016 licence expires next year. You have five interfaces to move. The
`integration-advisor` agent runs discovery and writes an assessment; the `eip-architect` agent
picks that assessment up and writes the CDK.

It takes about 25 minutes to run end to end. Every prompt below is one you type; every "what to
expect" block describes what the agent does in response, grounded in the agent's actual
instructions and the library's real `*Props` interfaces. Nothing here is a mock-up.

The five interfaces are chosen so each maps to a **different construct in a different lane**, and
so that two of them look identical in BizTalk terms but map to different constructs depending on
one answer. That contrast is the most useful thing the demo teaches.

| # | BizTalk artifact | What it does | Lane | Maps to |
|---|---|---|---|---|
| 1 | Orchestration with a compensation block | Order fulfilment: reserve stock, charge card, book courier; undo on failure | Orchestration | `SagaOrchestration` |
| 2 | Orchestration, sequential, no rollback | Nightly product-catalogue publish: validate, enrich, push to e-commerce | Orchestration | `ProcessManager` |
| 3 | FTP receive location + flat-file disassembler + map | Supplier price files arrive nightly as pipe-delimited flat files | File-based | `FileTransfer` + `MessageTranslator` + `Splitter` |
| 4 | Send port group with filter expressions | Inventory-change events fanned to warehouse, e-commerce and finance | Event-driven | `ContentBasedRouter` |
| 5 | Send port with ordered delivery | Stock adjustments from the warehouse must apply in sequence per SKU | Event-driven, ordered | `Resequencer` |

Interfaces 1 and 2 are the contrast pair. Both are XLANG orchestrations. The only thing that
separates them is whether a failed step has to be undone.

## Before you start

```bash
git clone https://github.com/aws-samples/sample-enterprise-integration-patterns-cdk.git
cd sample-enterprise-integration-patterns-cdk
npm ci
npm run build
```

Open the folder in Kiro and accept the workspace trust prompt (agents only load in a trusted
workspace). Or run `claude` from the repo root. The README's
[Kiro](../../README.md#kiro) and [Claude Code](../../README.md#claude-code) sections cover both.

Two things worth knowing before the first prompt:

- **The advisor writes one file and touches no code.** Its output is `assessments/<name>.md`. It
  is denied write access to `lib/`, `test/` and `bin/`. If it seems to be "just asking questions",
  that is the design.
- **The architect does not deploy.** It writes `bin/app.ts` and runs `npm run build`, `npm test`
  and `cdk synth`. `cdk deploy` and `cdk destroy` are on its deny list. The last command is yours.

---

## Part 1: discovery with `integration-advisor`

Select **integration-advisor** as the agent. In Kiro, click the agent name in the bottom bar of
the chat input. In Claude Code, start your first message with *"use the integration-advisor agent"*.

### Prompt 1 — open the engagement

```
We run BizTalk Server 2016 with about 40 interfaces. The licence renews in 14 months and
we are not renewing. I want to work through five representative interfaces today and
understand what each becomes on AWS. Start from the interfaces, not the inventory.
```

**What to expect.** A welcome of roughly a paragraph: what the library is (29 CDK constructs,
each a complete pattern with DLQs, encryption and IAM already wired), what it is not (not ETL,
not an EDI platform, not a visual designer), and how the session will run. Then it asks its Stage 1
questions **in one numbered message**, not one per turn. Expect questions on: what is forcing the
change, the split of your 40 interfaces across protocol families, who operates BizTalk today and
whether they will operate AWS, and hard constraints such as data residency or systems that cannot
move.

It should not name a construct yet. If it does, that is a bug in the session, not the design.

### Prompt 2 — answer Stage 1

```
1. Driver is the licence, plus the two people who know BizTalk are both retiring within
   two years.
2. Of the 40, roughly 15 are file-based (FTP and SFTP), 15 are event fan-out from our ERP,
   6 are orchestrations, 4 are SOAP.
3. A two-person integration team operates it. They will operate the AWS estate. Neither has
   written TypeScript or CDK. One has done some Python Lambda.
4. The ERP is on-premises and stays there for at least three years. We have a Direct Connect.
   No data residency constraint beyond staying in one Region. Change freeze from mid-November
   to mid-January.
```

**What to expect.** It reflects back a two- or three-line summary of what it heard. Watch for it
to pick up two things unprompted: that the skills gap on the team is a project risk (it is
instructed to volunteer this), and that the ERP staying on-premises means every ERP-facing
interface needs the Direct Connect path rather than a public endpoint. If you disagree with the
summary, correct it. The agent is told that your correction is the most valuable input in the
session.

### Prompt 3 — the five interfaces

```
Here are the five. For each I've given what it does today in BizTalk terms.

1. OrderFulfilment orchestration. Reserves stock in the WMS, charges the card via the
   payment gateway, books a courier. Has a compensation block: if the courier booking
   fails, it releases the reservation and refunds. About 3,000 orders a day, peaks at
   40 a minute on sale days. Each order is under 50 KB. Must complete within about a
   minute or the customer sees a spinner.

2. CataloguePublish orchestration. Runs nightly. Pulls the product catalogue from the
   ERP, validates it, enriches it with images from the DAM, pushes it to the e-commerce
   platform. Three steps in sequence. If a step fails it just stops and someone reruns
   it in the morning. No undo needed. About 80,000 products, one run a night.

3. SupplierPriceFile. Twelve suppliers drop pipe-delimited flat files on our FTP server
   overnight. A receive pipeline with a flat-file disassembler splits each file into
   one message per line, a map converts each line to our canonical price XML, and it
   goes to the ERP. Files are 5 to 200 MB. About 1.2 million lines a night across all
   suppliers. Nothing needs to be in order.

4. InventoryEvents. The ERP publishes a stock-change message. A send port group with
   three filtered send ports routes it: warehouse gets everything, e-commerce gets only
   sellable SKUs, finance gets only movements over $10,000. About 200,000 a day. Each
   under 4 KB. Consumers tolerate a few seconds.

5. StockAdjustments. The WMS sends adjustment messages for each SKU. They must be applied
   in the order the WMS sent them, per SKU, or the stock count drifts. BizTalk does this
   with ordered delivery on the send port. About 50,000 a day. Under 2 KB each. Ordering
   matters more than latency.
```

**What to expect.** This is where the session earns its keep. The advisor works Stage 2 and 3
together. For each interface it should:

- **Translate your vocabulary first.** "Your compensation block is a Saga" before any AWS service
  name. "Your flat-file disassembler is a Splitter; the map after it is a Message Translator."
- **Name the construct with the five deciding facts stated.** Trigger, payload size, volume,
  latency, ordering, each with the consequence it drives.
- **Ask about the three things BizTalk hid** for each one: what happens today when the target is
  down, whether duplicate delivery causes harm, and whether anything has to be provable afterwards.
  BizTalk's MessageBox gave everything durable store-and-forward and automatic retry; that
  requirement is now unstated and the advisor is told to surface it.

The mappings you should see:

| Interface | Advisor's mapping | Why |
|---|---|---|
| 1 OrderFulfilment | `SagaOrchestration` | Compensation block → saga. Step Functions with a catch per step routing to a compensation Lambda. |
| 2 CataloguePublish | `ProcessManager` | Sequential, no rollback → process manager, **not** a saga. Same BizTalk artifact type as #1; one answer separates them. |
| 3 SupplierPriceFile | `FileTransfer` + `MessageTranslator` + `Splitter` | Three constructs composed. Transfer Family for the SFTP endpoint, a Lambda per line for the map, a splitter for debatching. |
| 4 InventoryEvents | `ContentBasedRouter` | Send port group with filters → EventBridge rules with event patterns. Three rules, one target each. |
| 5 StockAdjustments | `Resequencer` | Ordered delivery → resequencer. DynamoDB holds out-of-order arrivals, a dispatcher releases them in sequence. |

Two things the advisor should raise on its own:

- **On #3, the 200 MB files.** The library's guardrail is no files over 50 MB through a single
  Lambda invocation. Expect it to say the `Splitter` handles this by design (it splits the object
  into per-line messages rather than loading the file into memory), but to ask what the largest
  single file has been and whether any supplier is growing.
- **On #1, the one-minute latency.** It should ask whether the customer is waiting synchronously
  on the whole saga or only on the reservation step. A 40-second synchronous orchestration is the
  anti-pattern its instructions tell it to challenge by name.

If it asks these, answer plainly: largest file was 240 MB once; the customer waits only on
reservation, the rest is asynchronous with an email.

### Prompt 4 — the hidden requirements

The advisor will have asked about failure handling, duplicates and audit. Answer for all five:

```
Failure: today BizTalk retries every send port 3 times at 5-minute intervals, then suspends
the message and someone resubmits it from the admin console. We never wrote that down; it
is just how BizTalk works.

Duplicates: #1 must never charge twice. #4 and #5 are idempotent at the consumer. #3 would
double-insert prices if a file were processed twice, and it has happened.

Audit: #1 must be provable for PCI. #3 the suppliers occasionally dispute a price and we
have to show what they sent us. The others do not matter.
```

**What to expect.** This is the payoff of asking. The advisor should:

- Point out that the "3 retries at 5 minutes then suspend" is now an explicit design decision
  rather than a platform default. Every construct in the library has a DLQ with `maxReceiveCount`
  and retention configurable through `BasePatternProps`; the DLQ is the suspended-message queue,
  but someone has to build the resubmit tooling and alarms, because no construct creates alarms.
- Recommend `IdempotentReceiver` in front of the payment step in #1, and in front of the price
  insert in #3. These are the patterns BizTalk hid from you.
- Note that `SagaOrchestration` runs on Step Functions with tracing on, which gives you the PCI
  audit trail for #1 out of the box, and that #3's landing bucket in `FileTransfer` is versioned
  with a configurable retention, which is the supplier-dispute evidence.
- Flag the library's honest gaps: no CloudWatch alarms, no customer-managed KMS keys,
  `RemovalPolicy.DESTROY` as the default everywhere. For a PCI interface, `RETAIN` on the saga's
  state and the DLQ is not optional.

### Prompt 5 — sequence and hand off

```
Which one do we build first, and write the assessment file so I can circulate it.
```

**What to expect.** It recommends a sequence ordered by risk, not ease. The likely answer is
**#2 CataloguePublish first**: it is representative (an orchestration, so the team learns Step
Functions), it runs once a night so a failure is survivable, and it has no compensation so the
state machine is simple. Then #4 (event fan-out, teaches EventBridge), then #5, then #3, and #1
last because it is the PCI-scoped one where mistakes are expensive.

Then it writes `assessments/<name>.md` — something like `assessments/biztalk-retail-five-interfaces.md`.
Open it. It follows the template in `skills/integration-discovery/references/interface-assessment-template.md`:
a portfolio summary, five per-interface tables with the deciding facts and hidden requirements, an
anti-patterns list, gaps against the library, open questions, a build sequence, and the
cross-cutting work (alarms, `RETAIN` overrides, handler code for every BizTalk map).

It should end by telling you explicitly that it is handing off to `eip-architect`, and that the
architect will read the assessment file rather than re-asking.

Check the file exists before moving on:

```bash
ls assessments/
```

---

## Part 2: implementation with `eip-architect`

Switch agents. In Kiro, pick **eip-architect** from the same menu; discovery findings stay in the
conversation. In Claude Code, start with *"use the eip-architect agent"*.

### Prompt 6 — pick up the assessment

```
Read the assessment in assessments/ and build the first interface in the recommended sequence.
```

**What to expect.** The architect is instructed to check `assessments/` and `docs/` at the start of
a session and treat what it finds as confirmed requirements. It should **not** re-ask the five
deciding facts. If it does, point it at the file.

It reads `lib/patterns/process-manager.ts` before writing anything, because its rule is to take
prop names from the real `*Props` interface and never invent one. Then it writes into `bin/app.ts`.
The shape you should see:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ProcessManager } from '../lib';

class CataloguePublishStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string) {
    super(scope, id);
    new ProcessManager(this, 'CataloguePublish', {
      steps: [
        { name: 'Validate', handler: 'index.handler', code: lambda.Code.fromAsset('lambda/validate') },
        { name: 'Enrich',   handler: 'index.handler', code: lambda.Code.fromAsset('lambda/enrich') },
        { name: 'Publish',  handler: 'index.handler', code: lambda.Code.fromAsset('lambda/publish'), maxRetries: 2 },
      ],
      workflowTimeout: cdk.Duration.hours(2),
      lambdaTimeout: cdk.Duration.minutes(5),
    });
  }
}
```

Every prop there is real: `steps`, `name`, `handler`, `code`, `maxRetries`, `workflowTimeout`,
`lambdaTimeout`. The architect should also tell you that the three `lambda/*` directories are
handler code you write, because BizTalk's declarative maps have no runtime equivalent here.

Then it runs, in order:

```
npm run build      # tsc — type-checks the declaration against ProcessManagerProps
npm test           # the 29 library constructs, confirms nothing is broken
npx cdk synth      # the CataloguePublishStack template
```

and reports the change complete only when all three pass. If `synth` fails because
`lambda/validate` does not exist yet, that is expected on a fresh clone; the architect should
say so and suggest `lambda.Code.fromInline` as a placeholder for the demo.

### Prompt 7 — the contrast

```
Now build OrderFulfilment. Explain why it is a different construct from CataloguePublish
when they are both BizTalk orchestrations.
```

**What to expect.** This is the teaching moment. The architect should say: both are Step Functions
under the hood, but `ProcessManager` has no compensation path and `SagaOrchestration` attaches a
catch to every step that routes to a compensation Lambda before failing. The BizTalk compensation
block is what the assessment recorded, and it is the one fact that changes the construct.

It reads `lib/patterns/saga-orchestration.ts` and writes something like:

```typescript
new SagaOrchestration(this, 'OrderFulfilment', {
  steps: [
    {
      name: 'ReserveStock',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/reserve'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/release'),
    },
    {
      name: 'ChargeCard',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/charge'),
      compensationHandler: 'index.handler', compensationCode: lambda.Code.fromAsset('lambda/refund'),
    },
    {
      name: 'BookCourier',
      handler: 'index.handler', code: lambda.Code.fromAsset('lambda/book'),
    },
  ],
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

Watch for two things the assessment should have carried through:

- `removalPolicy: RETAIN`, because the assessment flagged PCI and listed `RETAIN` overrides under
  cross-cutting work. If the architect leaves the default `DESTROY`, ask it why. The assessment
  is its confirmed requirements, and destroying a PCI audit trail on stack deletion is a failure
  mode it should name rather than default into.
- A note that `IdempotentReceiver` belongs in front of `ChargeCard`. The advisor recommended it;
  the architect should either wire it or tell you it is the next step.

### Prompt 8 — the composition

```
Build SupplierPriceFile. It's three constructs, so show me how they connect.
```

**What to expect.** The architect reads three files: `file-transfer.ts`, `message-translator.ts`,
`splitter.ts`. It should explain the chain before writing it: `FileTransfer` gives you the SFTP
endpoint and an S3 landing bucket that emits EventBridge events on arrival; its optional
`ingestionHandler` is where you read the object and push lines onto the `Splitter`'s input queue;
the `Splitter` fans each line out to SNS; the `MessageTranslator` subscribes and runs your map.

It should also state, unprompted, that the 200 MB files are why the ingestion handler must stream
the object line by line rather than load it, and that the `Splitter` exists precisely so that a
Lambda never holds the whole file.

Then `npm run build`, `npm test`, `npx cdk synth`, and a report.

### Prompt 9 — audit what you have

```
Review bin/app.ts against the anti-pattern guardrails and tell me every violation,
including ones in code I already had.
```

**What to expect.** The architect walks the selection guide's anti-pattern list. On a demo run the
likely findings are: `RemovalPolicy.DESTROY` still defaulted on interfaces 2 and 3 (acceptable for
a demo, not for the price-dispute evidence bucket), no `IdempotentReceiver` yet on the price insert,
and no CloudWatch alarms anywhere because no construct creates them. It states the failure mode for
each, not just the rule.

### Prompt 10 — the boundary

```
Deploy it.
```

**What to expect.** It declines. `npx cdk deploy` is on its deny list. It should tell you the
declaration has passed build, test and synth, and that the command is yours:

```bash
npx cdk deploy --all
```

That refusal is the point of the demo's last prompt. Nothing reaches an account without a human
typing the command.

---

## What you have at the end

- `assessments/biztalk-retail-five-interfaces.md` (or similar): the reviewable record of the
  discovery session, in the template's format.
- `bin/app.ts`: three stacks declaring `ProcessManager`, `SagaOrchestration`, and the
  `FileTransfer` + `MessageTranslator` + `Splitter` composition, with props taken from the real
  interfaces. Interfaces 4 and 5 are mapped in the assessment but not yet built; run Prompt 6 again
  naming them if you want all five.
- A clean `npm run build`, `npm test` and `npx cdk synth`.
- Nothing deployed. That is yours to do, with `npx cdk deploy`, and to undo with `npx cdk destroy`.

## If the agents drift

The agents are instructions, not code, and a session can wander. Three corrections that usually
work:

- **Advisor names a construct before asking the five facts.** Say: *"You haven't asked me about
  payload size or ordering yet."* It is told never to recommend before it knows those.
- **Architect re-asks discovery questions.** Say: *"That's in assessments/. Read it."*
- **Architect invents a prop.** Say: *"Show me that prop in lib/patterns/<file>.ts."* It cannot,
  and will correct itself. This is why its rule is to read the source first.

## Adapting this to your own estate

Replace the five interfaces in Prompt 3 with yours, in your platform's vocabulary. The
[platform migration map](../../skills/integration-discovery/references/platform-migration-map.md)
covers BizTalk, MuleSoft, Boomi, TIBCO, Informatica and Workato, so the advisor will translate
whichever you speak. Keep the structure of Prompt 3: for each interface, what it does, the volume,
the payload size, the latency expectation, and whether order matters. Those are the five facts the
advisor needs, and giving them up front saves a round trip.
