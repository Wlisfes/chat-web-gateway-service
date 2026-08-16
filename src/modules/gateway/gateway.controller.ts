import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { GatewayService } from '@/modules/gateway/gateway.service'

@ApiTags('网关')
@Controller()
export class GatewayController {
    constructor(private readonly gatewayService: GatewayService) {}

    @Get()
    @ApiOperation({ summary: '查看网关信息及已配置路由' })
    @ApiOkResponse({ description: '网关信息' })
    getInfo() {
        return this.gatewayService.getInfo()
    }

    @Get('health')
    @ApiOperation({ summary: '网关健康检查' })
    @ApiOkResponse({ description: '网关及服务发现状态' })
    getHealth() {
        return this.gatewayService.getHealth()
    }

    @Get('health/live')
    @ApiOperation({ summary: '网关存活检查' })
    @ApiOkResponse({ description: '进程正常时返回 UP' })
    getLiveness() {
        return {
            status: 'UP',
            timestamp: new Date().toISOString()
        }
    }

    @Get('health/ready')
    @ApiOperation({ summary: '网关就绪检查' })
    @ApiOkResponse({ description: '网关路由及服务发现状态' })
    getReadiness() {
        return this.gatewayService.getHealth()
    }
}
