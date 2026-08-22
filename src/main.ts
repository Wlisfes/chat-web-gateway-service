import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { createApiResponse } from '@wlisfes/chat-web-base-schema/response'
import { createRequestLoggingMiddleware } from '@wlisfes/chat-web-base-schema/logging'
import { requestContextMiddleware } from '@wlisfes/chat-web-base-schema/request-context'
import type { Express, RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { knife4jSetup } from 'nest-knife4j'
import { AppModule } from '@/app.module'
import { ServiceConfigService } from '@/modules/config/config.service'
import { GatewayProxyService } from '@/modules/gateway/gateway-proxy.service'

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, { bodyParser: false })
    const logger = new Logger('Bootstrap')
    const serviceConfig = app.get(ServiceConfigService)
    const expressApplication = app.getHttpAdapter().getInstance() as Express

    let shuttingDown = false
    const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
        if (shuttingDown) {
            return
        }
        shuttingDown = true
        logger.log(`收到 ${signal}，正在关闭网关`)

        let exitCode = 0
        try {
            await Promise.race([
                app.close(),
                new Promise<never>((_resolve, reject) => {
                    setTimeout(() => reject(new Error('网关优雅退出超时')), 8000)
                })
            ])
        } catch (error) {
            exitCode = 1
            logger.error(error instanceof Error ? error.stack : String(error))
        } finally {
            process.exit(exitCode)
        }
    }
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))

    app.enableCors((_request, callback) => callback(null, serviceConfig.getCorsOptions()))
    app.use(requestContextMiddleware)
    app.use(createRequestLoggingMiddleware({ serviceName: 'chat-web-gateway-service' }))
    app.use(
        helmet({
            // Swagger UI 使用内联脚本和样式；CSP 应由最外层反向代理按实际域名配置。
            contentSecurityPolicy: false
        })
    )

    let rateLimitHandler: RequestHandler = (_request, _response, next) => next()
    app.use((request, response, next) => rateLimitHandler(request, response, next))

    const proxyService = app.get(GatewayProxyService)
    proxyService.mount(expressApplication)

    const swaggerConfig = new DocumentBuilder()
        .setTitle('Chat Web Gateway API')
        .setDescription('Chat Web 微服务统一入口。业务接口通过 /api/{service}/** 转发。')
        .setVersion('1.0')
        .addBearerAuth()
        .build()
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api/swagger', app, swaggerDocument, {
        jsonDocumentUrl: '/api/swagger-json'
    })
    const getKnife4jServices = () => [
        {
            name: '网关服务',
            url: '/api/swagger-json',
            swaggerVersion: '3.0.0',
            location: '/api/swagger'
        },
        ...proxyService.getRoutes().map(route => ({
            name: route.serviceName,
            url: `${route.prefix}/api/swagger-json`,
            swaggerVersion: '3.0.0',
            location: `${route.prefix}/api/swagger`,
            servicePath: route.prefix
        }))
    ]
    expressApplication.get('/services.json', (_request, response) => response.json(getKnife4jServices()))
    knife4jSetup(app, getKnife4jServices())

    await app.init()
    if (serviceConfig.getTrustProxy()) {
        expressApplication.set('trust proxy', 1)
    }

    const rateLimitMax = serviceConfig.getRateLimitMax()
    if (rateLimitMax > 0) {
        rateLimitHandler = rateLimit({
            windowMs: serviceConfig.getRateLimitWindowMs(),
            limit: rateLimitMax,
            standardHeaders: 'draft-7',
            legacyHeaders: false,
            skip: request => request.path.startsWith('/health'),
            handler: (_request, response) => {
                response.status(200).json(createApiResponse(null, { code: 429, message: '请求过于频繁，请稍后重试' }))
            }
        })
    }

    proxyService.initialize()
    proxyService.attachWebSocketServer(app.getHttpServer())
    const port = serviceConfig.getServerPort()
    await app.listen(port, '0.0.0.0')

    logger.log(`Chat Web 网关已启动：http://0.0.0.0:${port}`)
    logger.log(`Knife4j 聚合文档：http://0.0.0.0:${port}/doc.html`)
    logger.log(`网关 OpenAPI 文档：http://0.0.0.0:${port}/api/swagger`)
}

void bootstrap().catch(error => {
    const logger = new Logger('Bootstrap')
    logger.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
})
