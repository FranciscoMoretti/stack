import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ExecError,
  CodeHostChangeNotFoundError,
  CodeHostDecodeError,
  CodeHostReplayBaseNotFoundError,
  PullLabel,
  pullMeta,
  PullMeta,
  pullRef,
  PullRef,
} from "../../domain/model.ts";
import * as Proc from "../../platform/proc.ts";
import { StackConfig } from "../Config.ts";
import { CodeHost } from "../CodeHost.ts";
import { CodeHostMemory } from "./Memory.ts";

class PullView extends Schema.Class<PullView>("PullView")({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  headRefName: Schema.String,
  headRepository: Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String })),
  baseRefName: Schema.String,
  url: Schema.String,
  isDraft: Schema.Boolean,
  labels: Schema.Array(
    Schema.Struct({
      name: Schema.String,
    }),
  ),
}) {}

class PullWatch extends Schema.Class<PullWatch>("PullWatch")({
  state: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
}) {}

class PullBoundaryView extends Schema.Class<PullBoundaryView>("PullBoundaryView")({
  headRefOid: Schema.String,
  baseRefOid: Schema.String,
}) {}

class RepositoryView extends Schema.Class<RepositoryView>("RepositoryView")({
  nameWithOwner: Schema.String,
}) {}

class BaseRefChangedEvent extends Schema.Class<BaseRefChangedEvent>("BaseRefChangedEvent")({
  createdAt: Schema.String,
  previousRefName: Schema.String,
  currentRefName: Schema.String,
}) {}

class BaseRefHistory extends Schema.Class<BaseRefHistory>("BaseRefHistory")({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            timelineItems: Schema.Struct({
              nodes: Schema.Array(Schema.NullOr(BaseRefChangedEvent)),
            }),
          }),
        ),
      }),
    ),
  }),
}) {}

class ForcePushCommit extends Schema.Class<ForcePushCommit>("ForcePushCommit")({
  oid: Schema.String,
  parents: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ oid: Schema.String })),
  }),
}) {}

class HeadRefForcePushedEvent extends Schema.Class<HeadRefForcePushedEvent>(
  "HeadRefForcePushedEvent",
)({
  createdAt: Schema.String,
  beforeCommit: Schema.NullOr(ForcePushCommit),
  afterCommit: Schema.NullOr(ForcePushCommit),
}) {}

class ForcePushHistory extends Schema.Class<ForcePushHistory>("ForcePushHistory")({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            headRefOid: Schema.optional(Schema.String),
            timelineItems: Schema.Struct({
              nodes: Schema.Array(Schema.NullOr(HeadRefForcePushedEvent)),
            }),
          }),
        ),
      }),
    ),
  }),
}) {}

class CheckRun extends Schema.Class<CheckRun>("CheckRun")({
  name: Schema.String,
  head_sha: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  details_url: Schema.NullOr(Schema.String),
  app: Schema.NullOr(Schema.Struct({ slug: Schema.String })),
}) {}

class CheckRuns extends Schema.Class<CheckRuns>("CheckRuns")({
  check_runs: Schema.Array(CheckRun),
}) {}

class ActionJobStep extends Schema.Class<ActionJobStep>("ActionJobStep")({
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
}) {}

class ActionJob extends Schema.Class<ActionJob>("ActionJob")({
  name: Schema.String,
  head_sha: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  steps: Schema.Array(ActionJobStep),
}) {}

class MergedPull extends Schema.Class<MergedPull>("MergedPull")({
  number: Schema.Number,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
}) {}

const MergedPulls = Schema.Array(MergedPull);

class PullListData extends Schema.Class<PullListData>("PullListData")({
  number: Schema.Number,
  title: Schema.String,
  head: Schema.Struct({
    ref: Schema.String,
    repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
  }),
  base: Schema.Struct({ ref: Schema.String }),
  html_url: Schema.String,
  draft: Schema.Boolean,
}) {}

const PullListJson = Schema.Array(Schema.Array(PullListData));

const extractJson = (out: string): string => {
  const start = out.search(/[[{]/);
  if (start === -1) return out;
  const opener = out[start];
  const closer = opener === "{" ? "}" : "]";
  const end = out.lastIndexOf(closer);
  if (end === -1 || end < start) return out;
  return out.slice(start, end + 1);
};

const decodePullList = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PullListJson)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodePullView = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PullView)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodePullWatch = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PullWatch)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodePullBoundaryView = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PullBoundaryView)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodeRepositoryView = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(RepositoryView)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodeBaseRefHistory = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(BaseRefHistory)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodeForcePushHistory = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(ForcePushHistory)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodeCheckRuns = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(CheckRuns)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodeActionJob = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(ActionJob)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const decodeMergedPulls = (args: ReadonlyArray<string>, out: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(MergedPulls)(JSON.parse(extractJson(out))),
    catch: (err) => new CodeHostDecodeError("gh", args, out, String(err)),
  });

const missingPull = (err: ExecError) =>
  /not found|could not resolve|no pull request|404/i.test(err.stderr);

const listRef = (row: PullListData) =>
  pullRef({
    number: row.number,
    title: row.title,
    head: row.head.ref,
    headRepository: row.head.repo?.full_name.toLowerCase() ?? null,
    base: row.base.ref,
    url: row.html_url,
    draft: row.draft,
  });

const meta = (row: PullView) =>
  pullMeta({
    number: row.number,
    title: row.title,
    body: row.body,
    head: row.headRefName,
    headRepository: row.headRepository?.nameWithOwner.toLowerCase() ?? null,
    base: row.baseRefName,
    url: row.url,
    draft: row.isDraft,
    state: "OPEN",
    labels: row.labels.map((item) => new PullLabel({ name: item.name })),
  });

const properties = {
  provider: "github" as const,
  capabilities: { adminMerge: true },
  requestLabel: "PR" as const,
  reference: (number: number) => `#${number}`,
  repository: (remote: string, origin?: string) =>
    CodeHost.repositoryFor(remote, origin)?.toLowerCase() ?? null,
  changeUrlBase: (remote: string) => {
    const info = CodeHost.remoteInfo(remote);
    return info ? `https://${info.host}/${info.owner}/${info.repo}/pull` : null;
  },
} satisfies CodeHost.AdapterProperties;

export const layer = Layer.effect(
  CodeHost.Service,
  Effect.gen(function* () {
    const cfg = yield* StackConfig;
    const proc = yield* Proc.Service;

    const run = Effect.fn("CodeHost.github.run")(function* (
      args: ReadonlyArray<string>,
      ok: ReadonlyArray<number> = [0],
    ) {
      return yield* proc.exec(cfg.root, "gh", args, ok);
    });

    const changes = Effect.fn("CodeHost.github.changes")(function* () {
      const args = [
        "api",
        "repos/{owner}/{repo}/pulls?state=open&per_page=100",
        "--paginate",
        "--slurp",
      ];
      const out = yield* run(args);
      const rows = yield* decodePullList(args, out);
      return rows.flatMap((page) => page.map(listRef));
    });

    const change = Effect.fn("CodeHost.github.change")((pr: number) => {
      const args = [
        "pr",
        "view",
        `${pr}`,
        "--json",
        "number,title,body,headRefName,headRepository,baseRefName,url,isDraft,labels",
      ];
      return run(args).pipe(
        Effect.catchIf(missingPull, () => Effect.fail(new CodeHostChangeNotFoundError(pr))),
        Effect.flatMap((out) => decodePullView(args, out)),
        Effect.map(meta),
      );
    });

    const changeBoundary = Effect.fn("CodeHost.github.changeBoundary")((pr: number) => {
      const args = ["pr", "view", `${pr}`, "--json", "headRefOid,baseRefOid"];
      return run(args).pipe(
        Effect.catchIf(missingPull, () => Effect.fail(new CodeHostChangeNotFoundError(pr))),
        Effect.flatMap((out) => decodePullBoundaryView(args, out)),
        Effect.map((row) => Option.some({ head: row.headRefOid, base: row.baseRefOid })),
      );
    });

    const generatedArtifactsProof = Effect.fn("CodeHost.github.generatedArtifactsProof")(function* (
      _pr: number,
      head: string,
    ) {
      const checksArgs = ["api", `repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100`];
      const checks = yield* run(checksArgs).pipe(
        Effect.flatMap((out) => decodeCheckRuns(checksArgs, out)),
      );
      const candidates = checks.check_runs.filter(
        (check) =>
          check.head_sha === head &&
          check.status === "completed" &&
          check.conclusion === "success" &&
          check.details_url !== null &&
          check.app?.slug === "github-actions" &&
          /schema|generated|snapshot|client/i.test(check.name),
      );
      for (const check of candidates) {
        const jobId = check.details_url?.match(/\/job\/(\d+)(?:$|[?#])/)?.[1];
        if (!jobId) continue;
        const jobArgs = ["api", `repos/{owner}/{repo}/actions/jobs/${jobId}`];
        const job = yield* run(jobArgs).pipe(
          Effect.flatMap((out) => decodeActionJob(jobArgs, out)),
        );
        if (job.head_sha !== head || job.status !== "completed" || job.conclusion !== "success") {
          continue;
        }
        const generatorIndex = job.steps.findIndex(
          (step) =>
            step.status === "completed" &&
            step.conclusion === "success" &&
            /\bgenerat(?:e|es|ed|ing|ion)\b/i.test(step.name),
        );
        const cleanlinessIndex = job.steps.findIndex(
          (step, index) =>
            index > generatorIndex &&
            step.status === "completed" &&
            step.conclusion === "success" &&
            /uncommitted changes|working tree|git (?:diff|status)/i.test(step.name),
        );
        if (generatorIndex === -1 || cleanlinessIndex === -1) continue;
        return Option.some({
          head,
          check: check.name,
          generatorStep: job.steps[generatorIndex]!.name,
          cleanlinessStep: job.steps[cleanlinessIndex]!.name,
        });
      }
      return Option.none<CodeHost.GeneratedArtifactsProof>();
    });

    const replayBase = Effect.fn("CodeHost.github.replayBase")(function* (
      pr: number,
      currentBase: string,
    ) {
      const repositoryArgs = ["repo", "view", "--json", "nameWithOwner"];
      const repository = yield* run(repositoryArgs).pipe(
        Effect.flatMap((out) => decodeRepositoryView(repositoryArgs, out)),
      );
      const [owner, name] = repository.nameWithOwner.split("/", 2);
      if (!owner || !name) {
        return yield* Effect.fail(
          new CodeHostDecodeError(
            "gh",
            repositoryArgs,
            repository.nameWithOwner,
            "expected owner/name",
          ),
        );
      }

      const forcePushQuery =
        "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid timelineItems(last:100,itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]){nodes{... on HeadRefForcePushedEvent{createdAt beforeCommit{oid parents(first:2){nodes{oid}}} afterCommit{oid parents(first:2){nodes{oid}}}}}}}}}";
      const forcePushArgs = [
        "api",
        "graphql",
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${pr}`,
        "-f",
        `query=${forcePushQuery}`,
      ];
      const forcePushHistory = yield* run(forcePushArgs).pipe(
        Effect.flatMap((out) => decodeForcePushHistory(forcePushArgs, out)),
      );
      const forcePushes = forcePushHistory.data.repository?.pullRequest?.timelineItems.nodes
        .filter((item): item is HeadRefForcePushedEvent => item !== null)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const latestForcePush = forcePushes?.at(-1);
      const forcePushReplay = () => {
        if (!latestForcePush) return Effect.succeed(Option.none<CodeHost.ReplayBase>());
        const before = latestForcePush.beforeCommit;
        const after = latestForcePush.afterCommit;
        if (!before || !after || after.parents.nodes.length !== 1) {
          return Effect.fail(new CodeHostReplayBaseNotFoundError(pr, "force-push history"));
        }
        return Effect.succeed(
          Option.some({
            kind: "force-push-boundary" as const,
            currentBase,
            before: before.oid,
            semanticHead: after.oid,
            boundary: after.parents.nodes[0]!.oid,
          }),
        );
      };

      const query =
        "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){timelineItems(first:100,itemTypes:[BASE_REF_CHANGED_EVENT]){nodes{... on BaseRefChangedEvent{createdAt previousRefName currentRefName}}}}}}";
      const historyArgs = [
        "api",
        "graphql",
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${pr}`,
        "-f",
        `query=${query}`,
      ];
      const history = yield* run(historyArgs).pipe(
        Effect.flatMap((out) => decodeBaseRefHistory(historyArgs, out)),
      );
      const event = history.data.repository?.pullRequest?.timelineItems.nodes
        .filter((item): item is BaseRefChangedEvent => item?.currentRefName === currentBase)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1);
      if (latestForcePush && (!event || latestForcePush.createdAt > event.createdAt)) {
        return yield* forcePushReplay();
      }
      if (!event) return Option.none<CodeHost.ReplayBase>();

      const mergedArgs = [
        "pr",
        "list",
        "--state",
        "merged",
        "--head",
        event.previousRefName,
        "--json",
        "number,headRefName,headRefOid,mergedAt",
        "--limit",
        "100",
      ];
      const merged = yield* run(mergedArgs).pipe(
        Effect.flatMap((out) => decodeMergedPulls(mergedArgs, out)),
      );
      const eventTime = Date.parse(event.createdAt);
      const parent = merged
        .filter((item) => item.headRefName === event.previousRefName)
        .sort((left, right) => {
          const leftDistance = Math.abs(Date.parse(left.mergedAt ?? "") - eventTime);
          const rightDistance = Math.abs(Date.parse(right.mergedAt ?? "") - eventTime);
          return leftDistance - rightDistance || right.number - left.number;
        })[0];
      if (!parent) {
        const currentHead = forcePushHistory.data.repository?.pullRequest?.headRefOid;
        if (
          latestForcePush &&
          latestForcePush.createdAt < event.createdAt &&
          latestForcePush.afterCommit?.oid === currentHead
        ) {
          return yield* forcePushReplay();
        }
        return yield* Effect.fail(new CodeHostReplayBaseNotFoundError(pr, event.previousRefName));
      }

      const parentForcePushArgs = [
        "api",
        "graphql",
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${parent.number}`,
        "-f",
        `query=${forcePushQuery}`,
      ];
      const parentForcePushHistory = yield* run(parentForcePushArgs).pipe(
        Effect.flatMap((out) => decodeForcePushHistory(parentForcePushArgs, out)),
      );
      const historicalHeads =
        parentForcePushHistory.data.repository?.pullRequest?.timelineItems.nodes
          .filter((item): item is HeadRefForcePushedEvent => item !== null)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .flatMap((item) => (item.beforeCommit ? [item.beforeCommit.oid] : [])) ?? [];

      return Option.some({
        kind: "merged-parent" as const,
        branch: event.previousRefName,
        currentBase,
        head: parent.headRefOid,
        historicalHeads,
        fetchRef: `refs/pull/${parent.number}/head`,
        change: parent.number,
      });
    });

    const auto = Effect.fn("CodeHost.github.auto")((pr: number) =>
      run(["pr", "merge", `${pr}`, "--auto", "--squash"]).pipe(Effect.asVoid),
    );

    const merge = Effect.fn("CodeHost.github.merge")(
      (pr: number, opts?: { readonly admin?: boolean }) =>
        run(["pr", "merge", `${pr}`, "--squash", ...(opts?.admin ? ["--admin"] : [])]).pipe(
          Effect.asVoid,
        ),
    );

    const wait = Effect.fn("CodeHost.github.wait")((pr: number) =>
      Effect.gen(function* () {
        for (;;) {
          const args = ["pr", "view", `${pr}`, "--json", "state,mergedAt"];
          const out = yield* run(args);
          const row = yield* decodePullWatch(args, out);

          if (row.mergedAt) return;
          if (row.state !== "OPEN") {
            return yield* Effect.fail(
              new ExecError("gh", ["pr", "view", `${pr}`], 1, `PR #${pr} closed without merging`),
            );
          }

          yield* Effect.sleep(cfg.codeHostWaitIntervalMillis);
        }
      }),
    );

    const edit = Effect.fn("CodeHost.github.edit")((pr: number, base: string) =>
      run(["pr", "edit", `${pr}`, "--base", base]).pipe(Effect.asVoid),
    );

    const body = Effect.fn("CodeHost.github.body")((pr: number, body: string) =>
      run(["pr", "edit", `${pr}`, "--body", body]).pipe(Effect.asVoid),
    );

    const close = Effect.fn("CodeHost.github.close")((pr: number) =>
      run(["pr", "close", `${pr}`]).pipe(Effect.asVoid),
    );

    const create = Effect.fn("CodeHost.github.create")(function* (
      branch: string,
      base: string,
      title: string,
      body: string,
      labels: ReadonlyArray<string>,
      headRepository?: string | null,
    ) {
      const head = headRepository ? `${headRepository.split("/")[0]}:${branch}` : branch;
      const created = yield* run([
        "pr",
        "create",
        "--head",
        head,
        "--base",
        base,
        "--title",
        title,
        "--body",
        body,
        ...labels.flatMap((label) => ["--label", label]),
      ]);

      const number = Number(created.trim().match(/\/pull\/(\d+)\/?$/)?.[1]);
      if (!Number.isInteger(number)) {
        return yield* new CodeHostDecodeError("gh", ["pr", "create"], created, "missing PR number");
      }
      return pullRef({
        number,
        title,
        head: branch,
        headRepository: headRepository?.toLowerCase() ?? null,
        base,
        url: created.trim(),
        draft: false,
      });
    });

    return CodeHost.Service.of({
      ...properties,
      auto,
      merge,
      wait,
      changes,
      change,
      changeBoundary,
      generatedArtifactsProof,
      replayBase,
      edit,
      body,
      close,
      create,
    });
  }),
);

export const memory = (
  opts: {
    readonly pulls?: ReadonlyArray<PullRef>;
    readonly metas?: ReadonlyArray<PullMeta>;
    readonly log?: Array<string>;
  } = {},
) =>
  CodeHostMemory.layer({
    ...opts,
    properties,
    state: "OPEN",
    url: (number) => `https://example.com/${number}`,
  });

export * as CodeHostGitHub from "./GitHub.ts";
