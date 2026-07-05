import * as Effect from "effect/Effect"

export const effectify = <A>(try_: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({
    try: try_,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
