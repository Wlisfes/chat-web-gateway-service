import { Module } from '@nestjs/common'
import { GatewayAuthService } from '@/modules/auth/gateway-auth.service'

@Module({
    providers: [GatewayAuthService],
    exports: [GatewayAuthService]
})
export class GatewayAuthModule {}
