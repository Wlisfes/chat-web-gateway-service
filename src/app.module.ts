import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HttpResponseModule } from '@wlisfes/chat-web-base-schema/interceptor'
import { forRootNacosRuntimeOptions, NacosModule } from '@wlisfes/chat-web-base-schema/nacos'
import { validateEnvironment } from '@/config/environment'
import { ServiceConfigModule } from '@/modules/config/config.module'
import { GatewayAuthModule } from '@/modules/auth/gateway-auth.module'
import { GatewayModule } from '@/modules/gateway/gateway.module'

@Module({
    imports: [
        HttpResponseModule,
        ConfigModule.forRoot({
            isGlobal: true,
            cache: true,
            validate: validateEnvironment
        }),
        ServiceConfigModule,
        NacosModule.forRoot(forRootNacosRuntimeOptions(process.env)),
        GatewayAuthModule,
        GatewayModule
    ]
})
export class AppModule {}
