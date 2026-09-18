import { Get, Redirect } from '@nestjs/common'
import { ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { GatewayService } from '@/modules/gateway/gateway.service'
import * as GatewayDto from '@/modules/gateway/dto/gateway-response.dto'

@ApifoxController('网关')
export class GatewayController {
    constructor(private readonly gatewayService: GatewayService) {}

    @ApiServiceDecorator(Get(), {
        operation: { summary: '打开 Knife4j 聚合文档' },
        response: {
            status: 302,
            type: GatewayDto.DocumentationRedirectResponseDto,
            envelope: false,
            description: '跳转到 /doc.html'
        }
    })
    @Redirect('/doc.html', 302)
    public async httpBaseGatewayDocumentation(): Promise<GatewayDto.DocumentationRedirectResponseDto> {
        return this.gatewayService.httpBaseGatewayDocumentation()
    }

    @ApiServiceDecorator(Get('gateway'), {
        operation: { summary: '查看网关信息及已配置路由' },
        response: { type: GatewayDto.GatewayInfoResponseDto, description: '网关信息及路由列表' }
    })
    public async httpBaseGatewayInfo(): Promise<GatewayDto.GatewayInfoResponseDto> {
        return this.gatewayService.httpBaseGatewayInfo()
    }

    @ApiServiceDecorator(Get('health'), {
        operation: { summary: '网关健康检查' },
        response: { type: GatewayDto.GatewayHealthResponseDto, description: '网关及服务发现状态' }
    })
    public async httpBaseGatewayHealth(): Promise<GatewayDto.GatewayHealthResponseDto> {
        return this.gatewayService.httpBaseGatewayHealth()
    }

    @ApiServiceDecorator(Get('health/live'), {
        operation: { summary: '网关存活检查' },
        response: { type: GatewayDto.GatewayLivenessResponseDto, description: '进程正常时返回 UP' }
    })
    public async httpBaseGatewayLiveness(): Promise<GatewayDto.GatewayLivenessResponseDto> {
        return this.gatewayService.httpBaseGatewayLiveness()
    }

    @ApiServiceDecorator(Get('health/ready'), {
        operation: { summary: '网关就绪检查' },
        response: { type: GatewayDto.GatewayHealthResponseDto, description: '网关路由及服务发现状态' }
    })
    public async httpBaseGatewayReadiness(): Promise<GatewayDto.GatewayHealthResponseDto> {
        return this.gatewayService.httpBaseGatewayReadiness()
    }
}
