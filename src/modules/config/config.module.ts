import { Global, Module } from '@nestjs/common'
import { ServiceConfigService } from '@/modules/config/config.service'

@Global()
@Module({
    providers: [ServiceConfigService],
    exports: [ServiceConfigService]
})
export class ServiceConfigModule {}
