import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnvironment } from '@/config/environment'
import { ServiceConfigModule } from '@/modules/config/config.module'
import { GatewayModule } from '@/modules/gateway/gateway.module'
import { NacosModule } from '@/modules/nacos/nacos.module'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            cache: true,
            validate: validateEnvironment
        }),
        ServiceConfigModule,
        NacosModule,
        GatewayModule
    ]
})
export class AppModule {}
