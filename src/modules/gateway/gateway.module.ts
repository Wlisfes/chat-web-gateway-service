import { Module } from '@nestjs/common'
import { ServiceConfigModule } from '@/modules/config/config.module'
import { GatewayController } from '@/modules/gateway/gateway.controller'
import { GatewayProxyService } from '@/modules/gateway/gateway-proxy.service'
import { GatewayService } from '@/modules/gateway/gateway.service'

@Module({
    imports: [ServiceConfigModule],
    controllers: [GatewayController],
    providers: [GatewayProxyService, GatewayService],
    exports: [GatewayProxyService]
})
export class GatewayModule {}
