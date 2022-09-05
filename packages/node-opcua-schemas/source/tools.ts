/* eslint-disable max-depth */
/* eslint-disable max-statements */
import { make_errorLog } from "node-opcua-debug";
import {
    buildStructuredType,
    ConstructorFuncWithSchema,
    DataTypeFactory,
    FieldCategory,
    getBuiltInType,
    hasBuiltInType,
    IStructuredTypeSchema,
    StructuredTypeSchema
} from "node-opcua-factory";
import { ExpandedNodeId } from "node-opcua-nodeid";

import { createDynamicObjectConstructor } from "./dynamic_extension_object";
import { InternalTypeDictionary, MapDataTypeAndEncodingIdProvider } from "./parse_binary_xsd";

const errorLog = make_errorLog(__filename);

function _removeNamespacePart(str?: string): string {
    if (!str) {
        return str || "";
    }
    const data = str.split(":");
    return data.length > 1 ? data[1] : str;
}

function _getNamespacePart(str: string): string {
    return str.split(":")[0];
}

function _adjustFieldTypeName(fieldTypeName: string): string {
    // special cases
    if (fieldTypeName === "UAString" || fieldTypeName === "CharArray") {
        fieldTypeName = "String";
    }
    if (fieldTypeName === "UABoolean") {
        fieldTypeName = "Boolean";
    }

    return fieldTypeName;
}

export function getOrCreateStructuredTypeSchema(
    name: string,
    typeDictionary: InternalTypeDictionary,
    dataTypeFactory: DataTypeFactory,
    idProvider: MapDataTypeAndEncodingIdProvider
): IStructuredTypeSchema {
    function _getOrCreateStructuredTypeSchema(_name: string): IStructuredTypeSchema {
        if (dataTypeFactory.hasStructureByTypeName(_name)) {
            return dataTypeFactory.getStructuredTypeSchema(_name);
        }
        if (dataTypeFactory.hasEnumeration(_name)) {
            return dataTypeFactory.getEnumeration(_name) as unknown as IStructuredTypeSchema;
        }
        if (dataTypeFactory.hasBuiltInType(_name)) {
            return dataTypeFactory.getBuiltInType(_name) as unknown as IStructuredTypeSchema;
        }
        // construct it !
        const structuredType = typeDictionary.getStructuredTypesRawByName(_name);
        if (!structuredType) {
            throw new Error("Cannot find structuredType " + _name);
        }

        structuredType.baseType = _removeNamespacePart(structuredType.baseType);
        structuredType.baseType = structuredType.baseType ? structuredType.baseType : "ExtensionObject";

        const baseSchema = typeDictionary.getStructuredTypesRawByName(structuredType.baseType);

        // remove redundant fields
        // Note :some file do no thave SourceType property and may be replicated here ..
        //       but they belongs to the base class and shall be remove/
        //       For instance DataTypeSchemaHeader => UABinaryFileDataType
        if (baseSchema && baseSchema.fields && baseSchema.name !== "ExtensionObject") {
            structuredType.fields = structuredType.fields.filter((field) => {
                const name = field.name;
                const index = baseSchema.fields.findIndex((f) => f.name === name);

                // istanbul ignore next
                if (index >= 0) {
                    errorLog(
                        "Warning : find duplicated field from base structure : field name ",
                        name,
                        "baseSchema = ",
                        baseSchema.name,
                        "schema =",
                        structuredType.name
                    );
                }
                return index < 0;
            });
        }
        applyOnFields();
        const schema = new StructuredTypeSchema({
            ...structuredType,
            dataTypeFactory
        });
        const ids = idProvider.getDataTypeAndEncodingId(schema.name);
        if (!ids) {
            // this may happen if the type is abstract or if the type referes to a internal ExtnsionObject
            // that can only exists inside an other extension object.this Type of extension object cannot
            // instantiated as standalone object and do not have encoding nodeIds...
            const Constructor = createDynamicObjectConstructor(schema, dataTypeFactory) as unknown as ConstructorFuncWithSchema;
            return schema;
        }
        schema.dataTypeNodeId = ids.dataTypeNodeId;
        if (schema.dataTypeNodeId.namespace === 0 && schema.dataTypeNodeId.value === 0) {
            return schema;
        }
        schema.encodingDefaultXml = ExpandedNodeId.fromNodeId(ids.xmlEncodingNodeId);
        schema.encodingDefaultJson = ExpandedNodeId.fromNodeId(ids.jsonEncodingNodeId);
        schema.encodingDefaultBinary = ExpandedNodeId.fromNodeId(ids.binaryEncodingNodeId);

        const Constructor = createDynamicObjectConstructor(schema, dataTypeFactory) as unknown as ConstructorFuncWithSchema;
        Constructor.encodingDefaultBinary = schema.encodingDefaultBinary;
        Constructor.encodingDefaultXml = schema.encodingDefaultXml;
        Constructor.encodingDefaultJson = schema.encodingDefaultJson;
        return schema;

        function applyOnFields() {
            for (const field of structuredType.fields) {
                const fieldType = field.fieldType;
                if (!field.schema) {
                    const prefix = _getNamespacePart(fieldType);
                    const fieldTypeName = _adjustFieldTypeName(_removeNamespacePart(fieldType)!);

                    switch (prefix) {
                        case "ua":
                            field.fieldType = fieldTypeName;
                            if (hasBuiltInType(fieldTypeName)) {
                                field.category = FieldCategory.basic;
                                field.schema = getBuiltInType(fieldTypeName);
                            } else if (dataTypeFactory.hasStructureByTypeName(fieldTypeName)) {
                                field.category = FieldCategory.complex;
                                field.schema = dataTypeFactory.getStructuredTypeSchema(fieldTypeName);
                            } else {
                                field.category = FieldCategory.basic;
                                // try in this
                                field.schema = _getOrCreateStructuredTypeSchema(fieldTypeName);
                                // istanbul ignore next
                                if (!field.schema) {
                                    errorLog("What should I do ??", fieldTypeName, " ", dataTypeFactory.hasStructureByTypeName(fieldTypeName));
                                } else {
                                    if (hasBuiltInType(fieldTypeName)) {
                                        field.category = FieldCategory.basic;
                                    } else {
                                        field.category = FieldCategory.complex;
                                    }
                                }
                            }
                            break;
                        case "opc":
                            if ((fieldTypeName === "UAString" || fieldTypeName === "String") && field.name === "IndexRange") {
                                field.fieldType = "NumericRange";
                            } else {
                                field.fieldType = fieldTypeName;
                            }
                            if (!hasBuiltInType(fieldTypeName)) {
                                throw new Error("Unknown basic type " + fieldTypeName);
                            }
                            field.category = FieldCategory.basic;
                            break;
                        default:
                            field.fieldType = fieldTypeName;
                            if (dataTypeFactory.hasEnumeration(fieldTypeName)) {
                                field.category = FieldCategory.enumeration;
                                const enumeratedType = dataTypeFactory.getEnumeration(fieldTypeName);
                                field.schema = enumeratedType;
                            } else if (dataTypeFactory.hasStructureByTypeName(fieldTypeName)) {
                                field.category = FieldCategory.complex;
                                const schema1 = dataTypeFactory.getStructuredTypeSchema(fieldTypeName);
                                field.schema = schema1;
                            }
                            break;
                    }
                }
            }
        }
    }
    return _getOrCreateStructuredTypeSchema(name);
}
