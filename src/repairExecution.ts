import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type ExecError,
  type ReplayConflictError,
  type StackError,
  StackOperationError,
} from "./domain/model.ts";
import type { RebaseBranchPlan, RetargetPullPlan } from "./repairPlan.ts";
import type { Interface as Git } from "./services/Git.ts";
import * as StackResult from "./stackResult.ts";

interface Dependencies {
  readonly checkpoint: () => Effect.Effect<void, StackError>;
  readonly step: (message: string) => Effect.Effect<void>;
}

export interface ApplyRebaseBranchDependencies extends Dependencies {
  readonly git: Pick<Git, "backup" | "replay" | "push" | "head" | "remoteHead">;
  readonly complete: (item: StackResult.StackResultItem) => Effect.Effect<void, StackError>;
  readonly onReplayFailure: (error: ExecError | ReplayConflictError) => StackError;
}

export const applyRebaseBranch = Effect.fn("RepairExecution.applyRebaseBranch")(function* (
  plan: RebaseBranchPlan,
  deps: ApplyRebaseBranchDependencies,
) {
  const [originalHead, ontoHead] = yield* Effect.all([
    deps.git.head(plan.branch),
    deps.git.head(plan.onto),
  ]);
  if (Option.isNone(originalHead)) {
    return yield* Effect.fail(
      new StackOperationError(`cannot resolve local head for ${plan.branch}`),
    );
  }
  if (Option.isNone(ontoHead)) {
    return yield* Effect.fail(
      new StackOperationError(`cannot resolve target head for ${plan.onto}`),
    );
  }
  const expectedRemoteHeads = yield* Effect.all(
    plan.pushRemotes.map((remote) => deps.git.remoteHead(remote, plan.branch)),
  );

  yield* deps.checkpoint();
  yield* deps.step(`backup ${plan.branch} -> ${plan.backup}`);
  yield* deps.git.backup(plan.branch, plan.backup);
  yield* deps.complete({
    _tag: "Backup",
    mode: "apply",
    branch: plan.branch,
    backup: plan.backup,
  });
  yield* deps.step(`rebase ${plan.branch} onto ${plan.parent}`);
  yield* deps.git
    .replay(plan.branch, plan.onto, plan.commits)
    .pipe(Effect.mapError(deps.onReplayFailure));
  const replayedHead = yield* deps.git.head(plan.branch);
  if (Option.isNone(replayedHead) || replayedHead.value === originalHead.value) {
    return yield* Effect.fail(
      new StackOperationError(
        `rebase ${plan.branch} did not update local head ${originalHead.value}`,
      ),
    );
  }
  yield* deps.complete({
    _tag: "Rebase",
    mode: "apply",
    branch: plan.branch,
    parent: plan.parent,
  });
  for (const [index, remote] of plan.pushRemotes.entries()) {
    yield* deps.step(
      StackResult.render({ _tag: "Push", mode: "apply", branch: plan.branch, remotes: [remote] }),
    );
    yield* deps.git.push(
      plan.branch,
      remote,
      Option.getOrNull(expectedRemoteHeads[index] ?? Option.none()),
    );
    const remoteHead = yield* deps.git.remoteHead(remote, plan.branch);
    if (Option.isNone(remoteHead)) {
      return yield* Effect.fail(
        new StackOperationError(`cannot verify ${plan.branch} on remote ${remote}`),
      );
    }
    if (remoteHead.value !== replayedHead.value) {
      return yield* Effect.fail(
        new StackOperationError(
          `${remote} head ${remoteHead.value} does not match local head ${replayedHead.value} for ${plan.branch}`,
        ),
      );
    }
    yield* deps.complete({
      _tag: "Push",
      mode: "apply",
      branch: plan.branch,
      remotes: [remote],
    });
  }
});

export interface ApplyRetargetPullDependencies extends Dependencies {
  readonly edit: (pr: number, base: string) => Effect.Effect<void, StackError>;
  readonly message?: string;
  readonly reference: (number: number) => string;
}

export const applyRetargetPull = Effect.fn("RepairExecution.applyRetargetPull")(function* (
  plan: RetargetPullPlan,
  deps: ApplyRetargetPullDependencies,
) {
  yield* deps.checkpoint();
  yield* deps.step(deps.message ?? `retarget ${deps.reference(plan.pr)} to ${plan.base}`);
  yield* deps.edit(plan.pr, plan.base);
});

export * as RepairExecution from "./repairExecution.ts";
