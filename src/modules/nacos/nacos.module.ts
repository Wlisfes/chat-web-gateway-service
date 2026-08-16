import { Global, Module } from '@nestjs/common'
import { ServiceConfigModule } from '@/modules/config/config.module'
import { NacosService } from '@/modules/nacos/nacos.service'

@Global()
@Module({
    imports: [ServiceConfigModule],
    providers: [NacosService],
    exports: [NacosService]
})
export class NacosModule {}
