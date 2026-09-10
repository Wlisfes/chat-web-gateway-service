import { createRequestLoggingMiddleware } from '@wlisfes/chat-web-base-schema/logging'
import type { RequestHandler } from 'express'

const SILENT_GATEWAY_PATH_SUFFIXES = ['/health', '/health/live', '/health/ready', '/api/swagger-json']

/** 判断网关入口或代理路径是否需要记录访问日志。 */
export function shouldLogGatewayRequestPath(requestUrl: string): boolean {
    const pathname = new URL(requestUrl || '/', 'http://gateway.local').pathname
    return !SILENT_GATEWAY_PATH_SUFFIXES.some(suffix => pathname.endsWith(suffix))
}

/**
 * 创建网关请求日志中间件。
 *
 * 网关公开路径带有 `/api/<服务名>` 前缀，不能只依赖下游服务使用的根路径忽略规则。
 */
export function createGatewayRequestLoggingMiddleware(serviceName: string): RequestHandler {
    const requestLoggingMiddleware = createRequestLoggingMiddleware(serviceName)
    return (request, response, next) => {
        if (!shouldLogGatewayRequestPath(request.path)) {
            next()
            return
        }
        requestLoggingMiddleware(request, response, next)
    }
}
