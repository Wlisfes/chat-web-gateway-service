const test = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')

const { Module } = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger')

const controllers = [require('../dist/modules/gateway/gateway.controller').GatewayController]

function assertTypedSchema(schema, label) {
    assert.ok(schema, `${label} 缺少 Schema`)
    if (schema.$ref || schema.oneOf || schema.anyOf) return
    if (schema.allOf) {
        assert.ok(schema.allOf.length > 0, `${label} 的 allOf 不能为空`)
        return
    }
    assert.ok(schema.type || schema.properties, `${label} 缺少字段类型`)
    if (schema.type === 'array') assertTypedSchema(schema.items, `${label}[]`)
    if (schema.type === 'object' && !schema.properties && !schema.additionalProperties) {
        assert.fail(`${label} 不能是无字段定义的 object`)
    }
}

async function createDocument() {
    const dependencies = [...new Set(controllers.flatMap(controller => Reflect.getMetadata('design:paramtypes', controller) ?? []))]
    class DocumentationModule {}
    Module({
        controllers,
        providers: dependencies.map(provide => ({ provide, useValue: {} }))
    })(DocumentationModule)
    const app = await NestFactory.create(DocumentationModule, { logger: false })
    const config = new DocumentBuilder().addBearerAuth({ type: 'apiKey', in: 'header', name: 'authorization' }, 'authorization').build()
    const document = SwaggerModule.createDocument(app, config)
    await app.close()
    return document
}

test('OpenAPI 请求和响应包含完整字段类型与示例', async () => {
    const document = await createDocument()
    const operations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
        Object.entries(pathItem)
            .filter(([, operation]) => operation?.responses)
            .map(([method, operation]) => ({ path, method, operation }))
    )

    assert.equal(operations.length, 5)
    assert.equal(operations.filter(({ operation }) => operation.requestBody).length, 0)
    assert.equal(operations.flatMap(({ operation }) => operation.parameters ?? []).filter(parameter => parameter.in === 'query').length, 0)

    for (const { path, method, operation } of operations) {
        const operationLabel = `${method.toUpperCase()} ${path}`
        assert.ok(operation.summary, `${operationLabel} 缺少接口摘要`)
        for (const [status, response] of Object.entries(operation.responses)) {
            const contents = Object.entries(response.content ?? {})
            assert.ok(contents.length > 0, `${operationLabel} ${status} 缺少响应内容`)
            for (const [contentType, media] of contents) {
                assertTypedSchema(media.schema, `${operationLabel} ${status} ${contentType}`)
                assert.notEqual(media.example, undefined, `${operationLabel} ${status} ${contentType} 缺少响应示例`)
                assert.equal(
                    JSON.stringify(media.schema).includes('"$ref"'),
                    false,
                    `${operationLabel} ${status} 响应不能包含 Knife4j 无法展开的 $ref`
                )
                if (contentType === 'application/json' && status !== '302') {
                    assert.equal(media.schema.type, 'object', `${operationLabel} 必须使用 Knife4j 可展开的对象响应`)
                    assert.equal(media.schema.allOf, undefined, `${operationLabel} 不能使用 Knife4j 不支持的顶层 allOf`)
                    assert.deepEqual(Object.keys(media.schema.properties ?? {}), ['data', 'code', 'message', 'timestamp'])
                    assertTypedSchema(media.schema.properties?.data, `${operationLabel} data`)
                    assert.equal(media.example.code, 200, `${operationLabel} 响应示例缺少业务状态码`)
                    assert.notEqual(media.example.data, undefined, `${operationLabel} 响应示例缺少 data`)
                }
            }
        }

        if (operation.requestBody) {
            const requestSchema = operation.requestBody.content?.['application/json']?.schema
            assertTypedSchema(requestSchema, `${operationLabel} requestBody`)
            const schemaName = requestSchema.$ref?.split('/').at(-1)
            const schema = schemaName ? document.components.schemas?.[schemaName] : undefined
            assert.ok(schema, `${operationLabel} 请求 DTO 未注册`)
            for (const [propertyName, property] of Object.entries(schema.properties ?? {})) {
                assert.notEqual(property.readOnly, true, `${operationLabel}.${propertyName} 不能是只读入参`)
                assertTypedSchema(property, `${operationLabel}.${propertyName}`)
            }
        }

        for (const parameter of operation.parameters ?? []) {
            if (parameter.in !== 'query') continue
            assert.notEqual(parameter.schema?.readOnly, true, `${operationLabel}.${parameter.name} 不能是只读入参`)
            assertTypedSchema(parameter.schema ?? parameter, `${operationLabel}.${parameter.name}`)
        }
    }

    for (const [schemaName, schema] of Object.entries(document.components.schemas ?? {})) {
        for (const [propertyName, property] of Object.entries(schema.properties ?? {})) {
            if (schemaName === 'ApiResponseDocumentDto' && propertyName === 'data') continue
            assertTypedSchema(property, `${schemaName}.${propertyName}`)
            if (
                ['string', 'number', 'integer', 'boolean'].includes(property.type) &&
                property.example === undefined &&
                property.default === undefined &&
                property.enum === undefined
            ) {
                assert.fail(`${schemaName}.${propertyName} 缺少字段示例`)
            }
        }
    }
})
