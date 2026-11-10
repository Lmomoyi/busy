import {
  AlertTriangle,
  Check,
  Circle,
  Clock3,
  Pause,
  Route,
  X,
} from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  type PlanStep,
  planStatus,
  type TaskPlan,
} from "../../../templates/bot/agent/lib/task-plan";

const states = {
  blocked: { icon: Pause, label: "Blocked" },
  cancelled: { icon: X, label: "Cancelled" },
  completed: { icon: Check, label: "Completed" },
  failed: { icon: AlertTriangle, label: "Failed" },
  in_progress: { icon: Clock3, label: "In progress" },
  pending: { icon: Circle, label: "Pending" },
};

function PlanStepRow({ step, paused }: { step: PlanStep; paused?: boolean }) {
  const { icon: Icon, label } = states[step.status];
  const stateLabel = paused && step.status === "in_progress" ? "Paused" : label;
  let status: "running" | "error" | "pending" | undefined;
  if (step.status === "in_progress" && !paused) {
    status = "running";
  } else if (step.status === "failed") {
    status = "error";
  } else if (step.status === "pending") {
    status = "pending";
  }
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <TraceLine status={status}>
        <TraceIcon>
          <Icon />
        </TraceIcon>
        <TraceTitle className="text-foreground whitespace-normal">
          {step.title}
        </TraceTitle>
      </TraceLine>
      <p className="text-muted-foreground pl-6 text-xs break-words">
        {stateLabel} · {step.assignee === "self" ? "This bot" : step.assignee}
      </p>
      <p className="text-muted-foreground pl-6 text-sm break-words">
        {step.note ?? step.expectedResult}
      </p>
    </li>
  );
}

/** The Plan pattern from shadcn/ui's AI Elements: a Trace that opens into its steps. */
export function PlanCard({
  plan,
  paused,
}: {
  plan: TaskPlan;
  paused?: boolean;
}) {
  const completed = plan.steps.filter(
    (step) => step.status === "completed"
  ).length;
  const status = planStatus(plan);
  const failed = plan.steps.some((step) => step.status === "failed");
  const running =
    status === "active" &&
    !paused &&
    plan.steps.some((step) => step.status === "in_progress");
  return (
    <Trace className="max-w-xl">
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon>
              <Route />
            </TraceIcon>
            <TraceTitle className="text-foreground font-medium">
              {plan.title}
            </TraceTitle>
            <TraceDescription>
              {completed}/{plan.steps.length} completed
              {status === "cancelled" ? " · Cancelled" : ""}
              {failed ? " · Needs attention" : ""}
              {paused && status === "active" ? " · Paused" : ""}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ol aria-label="Plan steps" className="flex flex-col gap-3">
            {plan.steps.map((step) => (
              <PlanStepRow key={step.id} paused={paused} step={step} />
            ))}
          </ol>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
