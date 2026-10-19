import { Request } from 'express'

/**
 * The request shape the API works with.
 *
 * Express 5 types a path parameter as `string | string[]`, but a path segment
 * is always a single string, and the difference matters: a parameter that
 * may be an array does not satisfy a Prisma `where` clause, so the query
 * falls back to its untyped overload and the relations it selects disappear
 * from the result.
 *
 * A query value is left as it is, because a client may repeat one and the
 * server then sees an array. The schemas validate it.
 */
export type ApiRequest = Request<
  Record<string, string>,
  any,
  any,
  Record<string, string | string[] | undefined>
>

/**
 * A query value, when the client sent it once.
 *
 * A repeated parameter arrives as an array, and the first value is the one a
 * single-valued field wants.
 */
export function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
