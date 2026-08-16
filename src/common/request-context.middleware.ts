import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export const requestContextMiddleware: RequestHandler = (request, response, next) => {
    const requestId = resolveRequestId(request.header('x-request-id'))

    request.headers['x-request-id'] = requestId
    response.setHeader('x-request-id', requestId)
    next()
}

export function resolveRequestId(value: string | string[] | undefined): string {
    const candidate = Array.isArray(value) ? value[0] : value
    return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID()
}
