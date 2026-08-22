import type { Model } from '@harness/model';
import type { ToolRegistry } from '@harness/tools';
import type { ContextComposer } from '@harness/context';
import { AgentLoop, Session } from '@harness/agent';
import type { EventStore } from '@harness/events';

export interface SubagentSpec {
  task: string;
  model: Model;
  toolRegistry: ToolRegistry; // Inherits subset of tools and subset of permissions
  contextComposer: ContextComposer; // Explicitly selected context providers
  eventStore?: EventStore;
  maxSteps?: number;
  maxDepth?: number;
  currentDepth?: number;
  timeoutMs?: number;
}

export interface SubagentResult {
  status: 'completed' | 'failed' | 'cancelled';
  summary: string;
  artifacts?: any[];
  usage?: any;
  error?: Error;
}

export class SubagentRunner {
  async spawn(spec: SubagentSpec): Promise<SubagentResult> {
    const depth = spec.currentDepth || 0;
    const maxDepth = spec.maxDepth ?? 3;
    
    if (depth >= maxDepth) {
      return {
        status: 'failed',
        summary: 'Max subagent depth exceeded',
        error: new Error(`Subagent depth limit (${maxDepth}) reached. Cannot spawn.`)
      };
    }

    const session = new Session({
      model: spec.model.defaultModel,
      eventStore: spec.eventStore
    });

    const composed = await spec.contextComposer.compose();
    session.systemPrompt = composed.systemPrompt;

    session.addMessage({ role: 'user', content: `Task:\n${spec.task}` });

    const agentLoop = new AgentLoop({
      model: spec.model,
      toolRegistry: spec.toolRegistry,
      maxSteps: spec.maxSteps ?? 50
    });

    if (spec.eventStore) {
      await spec.eventStore.append({
        id: crypto.randomUUID(),
        type: 'subagent.spawned',
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        payload: { task: spec.task, depth }
      });
    }

    const abortController = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    if (spec.timeoutMs) {
      timeoutId = setTimeout(() => abortController.abort(new Error('Subagent timeout')), spec.timeoutMs);
    }

    try {
      if (spec.eventStore) {
        await spec.eventStore.append({
          id: crypto.randomUUID(),
          type: 'subagent.started',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          payload: {}
        });
      }

      const result = await agentLoop.run(session, {
        signal: abortController.signal
      });

      if (timeoutId) clearTimeout(timeoutId);

      const summary = session.getMessages().at(-1)?.content || 'No output';

      if (spec.eventStore) {
        await spec.eventStore.append({
          id: crypto.randomUUID(),
          type: 'subagent.completed',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          payload: { steps: result.steps }
        });
      }

      return {
        status: result.completed ? 'completed' : 'failed',
        summary: typeof summary === 'string' ? summary : JSON.stringify(summary),
        usage: { steps: result.steps }
      };
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);

      if (spec.eventStore) {
        await spec.eventStore.append({
          id: crypto.randomUUID(),
          type: err.name === 'AbortError' ? 'subagent.cancelled' : 'subagent.failed',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          payload: { error: err.message }
        });
      }

      return {
        status: err.name === 'AbortError' ? 'cancelled' : 'failed',
        summary: err.message,
        error: err
      };
    }
  }
}
