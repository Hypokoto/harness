import type { EventEnvelope, Reducer } from './types.js';

/**
 * Replay events sequentially through a state reducer to reconstruct state deterministically.
 */
export async function replay<TState, TPayload = unknown>(
  events: Iterable<EventEnvelope<TPayload>> | AsyncIterable<EventEnvelope<TPayload>> | Promise<EventEnvelope<TPayload>[]>,
  initialState: TState,
  reducer: Reducer<TState, TPayload>
): Promise<TState> {
  let state = initialState;
  const resolvedEvents = await events;

  for await (const event of resolvedEvents) {
    state = reducer(state, event);
  }

  return state;
}
