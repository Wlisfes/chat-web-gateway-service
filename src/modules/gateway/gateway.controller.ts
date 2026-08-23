import { Get, Redirect } from '@nestjs/common'
import { ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { GatewayService } from '@/modules/gateway/gateway.service'
import {
    DocumentationRedirectResponseDto,
    GatewayHealthResponseDto,
    GatewayInfoResponseDto,
    GatewayLivenessResponseDto
} from '@/modules/gateway/dto/gateway-response.dto'

@ApifoxController('网关')
export class GatewayController {
    constructor(private readonly gatewayService: GatewayService) {}

    @ApiServiceDecorator(Get(), {
        operation: { summary: '打开 Knife4j 聚合文档' },
        response: {
            status: 302,
            type: DocumentationRedirectResponseDto,
            envelope: false,
            description: '跳转到 /doc.html'
        }
    })
    @Redirect('/doc.html', 302)
    openDocumentation() {
        return { url: '/doc.html' }
    }

    @ApiServiceDecorator(Get('gateway'), {
        operation: { summary: '查看网关信息及已配置路由' },
        response: { type: GatewayInfoResponseDto, description: '网关信息及路由列表' }
    })
    getInfo() {
        return this.gatewayService.getInfo()
    }

    @ApiServiceDecorator(Get('health'), {
        operation: { summary: '网关健康检查' },
        response: { type: GatewayHealthResponseDto, description: '网关及服务发现状态' }
    })
    getHealth() {
        return this.gatewayService.getHealth()
    }

    @ApiServiceDecorator(Get('health/live'), {
        operation: { summary: '网关存活检查' },
        response: { type: GatewayLivenessResponseDto, description: '进程正常时返回 UP' }
    })
    getLiveness() {
        return {
            status: 'UP',
            timestamp: new Date().toISOString()
        }
    }

    @ApiServiceDecorator(Get('health/ready'), {
        operation: { summary: '网关就绪检查' },
        response: { type: GatewayHealthResponseDto, description: '网关路由及服务发现状态' }
    })
    getReadiness() {
        return this.gatewayService.getHealth()
    }
}
