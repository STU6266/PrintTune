import type {
  PackageFieldFactV1,
  PrinterModelVariantDefinitionV1,
  PrinterSeriesKnowledgePackageV1,
} from "@printtune/contracts";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { gt, valid } from "semver";

import knowledgePackageV1Schema from "./knowledge-package-v1.schema.json" with { type: "json" };

export interface KnowledgePackageValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export class MalformedKnowledgePackageJsonError extends Error {
  override readonly name = "MalformedKnowledgePackageJsonError";
  constructor() {
    super("Knowledge Package is not valid JSON");
  }
}

export class UnsupportedKnowledgePackageFormatVersionError extends Error {
  override readonly name = "UnsupportedKnowledgePackageFormatVersionError";
  constructor(readonly formatVersion: unknown) {
    super("Knowledge Package formatVersion is unsupported");
  }
}

export class UnsupportedKnowledgePackageTypeError extends Error {
  override readonly name = "UnsupportedKnowledgePackageTypeError";
  constructor(readonly packageType: unknown) {
    super("Knowledge Package packageType is unsupported");
  }
}

export class InvalidKnowledgePackageStructureError extends Error {
  override readonly name = "InvalidKnowledgePackageStructureError";
  constructor(readonly issues: readonly KnowledgePackageValidationIssue[]) {
    super("Knowledge Package structure is invalid");
  }
}

export class InvalidKnowledgePackageSemanticsError extends Error {
  override readonly name = "InvalidKnowledgePackageSemanticsError";
  constructor(readonly issues: readonly KnowledgePackageValidationIssue[]) {
    super("Knowledge Package semantics are invalid");
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateStructure = ajv.compile<PrinterSeriesKnowledgePackageV1>(knowledgePackageV1Schema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuralIssue(error: ErrorObject): KnowledgePackageValidationIssue {
  let path = error.instancePath || "/";
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    path = `${error.instancePath}/${error.params.missingProperty}`;
  } else if (
    error.keyword === "additionalProperties" &&
    typeof error.params.additionalProperty === "string"
  ) {
    path = `${error.instancePath}/${error.params.additionalProperty}`;
  }
  return Object.freeze({
    path,
    code: `structural_${error.keyword}`,
    message: "Package value does not match the v1 schema",
  });
}

function sortedIssues(
  issues: KnowledgePackageValidationIssue[]
): readonly KnowledgePackageValidationIssue[] {
  return Object.freeze(
    issues
      .sort(
        (left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
      )
      .map((issue) => Object.freeze({ ...issue }))
  );
}

function semanticIssue(
  path: string,
  code: string,
  message: string
): KnowledgePackageValidationIssue {
  return { path, code, message };
}

function validateNormalizedId(
  value: string,
  path: string,
  issues: KnowledgePackageValidationIssue[]
): void {
  if (value.trim() !== value) {
    issues.push(
      semanticIssue(path, "invalid_normalized_id", "Identifier must be non-empty and trimmed")
    );
  }
}

function validateFacts(
  facts: readonly PackageFieldFactV1[],
  path: string,
  globalFactIds: Set<string>,
  issues: KnowledgePackageValidationIssue[]
): void {
  const fieldPaths = new Set<string>();
  facts.forEach((fact, index) => {
    const factPath = `${path}/${index}`;
    validateNormalizedId(fact.factId, `${factPath}/factId`, issues);
    if (globalFactIds.has(fact.factId)) {
      issues.push(
        semanticIssue(
          `${factPath}/factId`,
          "duplicate_fact_id",
          "factId must be unique across the package"
        )
      );
    } else {
      globalFactIds.add(fact.factId);
    }
    if (fieldPaths.has(fact.fieldPath)) {
      issues.push(
        semanticIssue(
          `${factPath}/fieldPath`,
          "duplicate_field_path",
          "fieldPath must be unique within this definition"
        )
      );
    } else {
      fieldPaths.add(fact.fieldPath);
    }
  });
}

function semanticIssues(
  value: PrinterSeriesKnowledgePackageV1
): readonly KnowledgePackageValidationIssue[] {
  const issues: KnowledgePackageValidationIssue[] = [];
  validateNormalizedId(value.packageId, "/packageId", issues);
  validateNormalizedId(value.packageVersion, "/packageVersion", issues);

  const { minimumVersion, maximumVersionExclusive } = value.coreCompatibility;
  const validMinimum = valid(minimumVersion);
  const validMaximum =
    maximumVersionExclusive === undefined ? undefined : valid(maximumVersionExclusive);
  if (validMinimum === null) {
    issues.push(
      semanticIssue(
        "/coreCompatibility/minimumVersion",
        "invalid_semver",
        "minimumVersion must use SemVer 2.0.0"
      )
    );
  }
  if (maximumVersionExclusive !== undefined && validMaximum === null) {
    issues.push(
      semanticIssue(
        "/coreCompatibility/maximumVersionExclusive",
        "invalid_semver",
        "maximumVersionExclusive must use SemVer 2.0.0"
      )
    );
  }
  if (validMinimum !== null && validMaximum && !gt(validMaximum, validMinimum)) {
    issues.push(
      semanticIssue(
        "/coreCompatibility/maximumVersionExclusive",
        "invalid_compatibility_interval",
        "maximumVersionExclusive must be greater than minimumVersion"
      )
    );
  }

  const { series } = value.payload;
  validateNormalizedId(series.seriesDefinitionId, "/payload/series/seriesDefinitionId", issues);
  const factIds = new Set<string>();
  validateFacts(series.facts, "/payload/series/facts", factIds, issues);

  const modelIds = new Set<string>();
  series.models.forEach((model, index) => {
    const modelPath = `/payload/series/models/${index}`;
    validateNormalizedId(model.modelDefinitionId, `${modelPath}/modelDefinitionId`, issues);
    if (modelIds.has(model.modelDefinitionId)) {
      issues.push(
        semanticIssue(
          `${modelPath}/modelDefinitionId`,
          "duplicate_model_definition_id",
          "modelDefinitionId must be unique within the package"
        )
      );
    } else {
      modelIds.add(model.modelDefinitionId);
    }
    validateFacts(model.facts, `${modelPath}/facts`, factIds, issues);
  });

  return sortedIssues(issues);
}

function copyFact(fact: PackageFieldFactV1): PackageFieldFactV1 {
  return Object.freeze({
    factId: fact.factId,
    fieldPath: fact.fieldPath,
    value: Object.freeze({ ...fact.value }),
    ...(fact.unit === undefined ? {} : { unit: fact.unit }),
  });
}

function copyModel(model: PrinterModelVariantDefinitionV1): PrinterModelVariantDefinitionV1 {
  return Object.freeze({
    modelDefinitionId: model.modelDefinitionId,
    modelDisplayName: model.modelDisplayName,
    facts: Object.freeze(model.facts.map(copyFact)),
  });
}

function immutableCopy(value: PrinterSeriesKnowledgePackageV1): PrinterSeriesKnowledgePackageV1 {
  return Object.freeze({
    formatVersion: 1,
    packageId: value.packageId,
    packageVersion: value.packageVersion,
    packageType: "printer_series",
    displayName: value.displayName,
    ...(value.description === undefined ? {} : { description: value.description }),
    publisher: Object.freeze({ ...value.publisher }),
    coreCompatibility: Object.freeze({ ...value.coreCompatibility }),
    payload: Object.freeze({
      series: Object.freeze({
        seriesDefinitionId: value.payload.series.seriesDefinitionId,
        manufacturerDisplayName: value.payload.series.manufacturerDisplayName,
        seriesDisplayName: value.payload.series.seriesDisplayName,
        facts: Object.freeze(value.payload.series.facts.map(copyFact)),
        models: Object.freeze(value.payload.series.models.map(copyModel)),
      }),
    }),
  });
}

export function validateKnowledgePackageV1(value: unknown): PrinterSeriesKnowledgePackageV1 {
  if (isRecord(value) && "formatVersion" in value && value.formatVersion !== 1) {
    throw new UnsupportedKnowledgePackageFormatVersionError(value.formatVersion);
  }
  if (isRecord(value) && "packageType" in value && value.packageType !== "printer_series") {
    throw new UnsupportedKnowledgePackageTypeError(value.packageType);
  }
  if (!validateStructure(value)) {
    throw new InvalidKnowledgePackageStructureError(
      sortedIssues((validateStructure.errors ?? []).map(structuralIssue))
    );
  }
  const issues = semanticIssues(value);
  if (issues.length > 0) throw new InvalidKnowledgePackageSemanticsError(issues);
  return immutableCopy(value);
}

export function parseKnowledgePackageV1(text: string): PrinterSeriesKnowledgePackageV1 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new MalformedKnowledgePackageJsonError();
  }
  return validateKnowledgePackageV1(value);
}
