import { createRequestLoggingMiddleware } from '@wlisfes/chat-web-base-schema/logging'
import type { RequestHandler } from 'express'

const SILENT_GATEWAY_PATH_SUFFIXES = ['/health', '/health/live', '/health/ready', '/api/swagger-json']
const STATIC_RESOURCE_PATTERN = /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|pdf|zip|xlsx|xls|docx|doc|csv)$/i
const ATTACHMENT_PATH_PATTERN = /\/(?:attachment|attachments|upload|uploads|download|downloads|file|files)\/.+/i

/** 判断网关入口或代理路径是否需要记录访问日志。文档、图片和附件不记录。 */
export function shouldLogGatewayRequestPath(requestUrl: string): boolean {
    const pathname = new URL(requestUrl || '/', 'http://gateway.local').pathname
    if (SILENT_GATEWAY_PATH_SUFFIXES.some(suffix => pathname.endsWith(suffix))) return false
    if (
        pathname.endsWith('/api/swagger') ||
        pathname.includes('/api/swagger/') ||
        pathname.endsWith('/doc.html') ||
        pathname.endsWith('/favicon.ico')
    ) {
        return false
    }
    if (STATIC_RESOURCE_PATTERN.test(pathname) || ATTACHMENT_PATH_PATTERN.test(pathname)) return false
    return true
}

/**
 * 创建网关请求日志中间件。
 *
 * 网关公开路径带有 `/api/<服务名>` 前缀，不能只依赖下游服务使用的根路径忽略规则。
 */
export function createGatewayRequestLoggingMiddleware(serviceName: string): RequestHandler {
    const requestLoggingMiddleware = createRequestLoggingMiddleware(serviceName)
    return (request, response, next) => {
        if (!shouldLogGatewayRequestPath(request.originalUrl || request.url || request.path)) {
            next()
            return
        }
        requestLoggingMiddleware(request, response, next)
    }
}
