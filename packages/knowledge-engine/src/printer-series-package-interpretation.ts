import type { PackageFieldFactV1, PrinterSeriesKnowledgePackageV1 } from "@printtune/contracts";
import { KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION, findCoreFieldDefinition } from "@printtune/core";
import { gte, lt } from "semver";

export type PrinterSeriesPackageCoreCompatibilityIssueCode =
  | "incompatible_core_version"
  | "unknown_field_definition"
  | "invalid_target_type"
  | "incompatible_value_type"
  | "incompatible_unit";

interface PrinterSeriesPackageCoreCompatibilityIssueBase {
  readonly path: string;
  readonly code: PrinterSeriesPackageCoreCompatibilityIssueCode;
  readonly message: string;
}

export interface IncompatibleCoreVersionIssue extends PrinterSeriesPackageCoreCompatibilityIssueBase {
  readonly code: "incompatible_core_version";
  readonly currentCoreVersion: string;
  readonly minimumVersion: string;
  readonly maximumVersionExclusive?: string;
}

export interface PrinterSeriesPackageFactCompatibilityIssue extends PrinterSeriesPackageCoreCompatibilityIssueBase {
  readonly code: Exclude<
    PrinterSeriesPackageCoreCompatibilityIssueCode,
    "incompatible_core_version"
  >;
  readonly factId: string;
  readonly fieldPath: string;
}

export type PrinterSeriesPackageCoreCompatibilityIssue =
  IncompatibleCoreVersionIssue | PrinterSeriesPackageFactCompatibilityIssue;

export class InvalidPrinterSeriesPackageCoreCompatibilityError extends Error {
  override readonly name = "InvalidPrinterSeriesPackageCoreCompatibilityError";
  constructor(readonly issues: readonly PrinterSeriesPackageCoreCompatibilityIssue[]) {
    super("Printer-series package is incompatible with the current Core semantic contract");
  }
}

export class UnknownPrinterSeriesModelError extends Error {
  override readonly name = "UnknownPrinterSeriesModelError";
  constructor(readonly modelDefinitionId: string) {
    super(`Printer-series model not found: ${modelDefinitionId}`);
  }
}

export class InvalidPrinterSeriesEffectiveFactsError extends Error {
  override readonly name = "InvalidPrinterSeriesEffectiveFactsError";
  constructor(
    readonly scope: "series" | "model",
    readonly fieldPath: string
  ) {
    super(`Duplicate ${scope} fact fieldPath: ${fieldPath}`);
  }
}

function issue(
  path: string,
  fact: PackageFieldFactV1,
  code: Exclude<PrinterSeriesPackageCoreCompatibilityIssueCode, "incompatible_core_version">,
  message: string
): PrinterSeriesPackageFactCompatibilityIssue {
  return { path, factId: fact.factId, fieldPath: fact.fieldPath, code, message };
}

function validateCoreVersionInterval(
  value: PrinterSeriesKnowledgePackageV1
): IncompatibleCoreVersionIssue[] {
  const { minimumVersion, maximumVersionExclusive } = value.coreCompatibility;
  const currentCoreVersion = KNOWLEDGE_PACKAGE_CORE_CONTRACT_VERSION;
  const compatible =
    gte(currentCoreVersion, minimumVersion) &&
    (maximumVersionExclusive === undefined || lt(currentCoreVersion, maximumVersionExclusive));

  if (compatible) return [];
  return [
    {
      path: "/coreCompatibility",
      code: "incompatible_core_version",
      message: "Package Core compatibility interval does not include the current Core contract",
      currentCoreVersion,
      minimumVersion,
      ...(maximumVersionExclusive === undefined ? {} : { maximumVersionExclusive }),
    },
  ];
}

function validateFact(
  fact: PackageFieldFactV1,
  path: string
): PrinterSeriesPackageCoreCompatibilityIssue[] {
  const definition = findCoreFieldDefinition(fact.fieldPath);
  if (!definition) {
    return [issue(path, fact, "unknown_field_definition", "Core FieldDefinition is unknown")];
  }

  const issues: PrinterSeriesPackageCoreCompatibilityIssue[] = [];
  if (definition.targetType !== "printer_state") {
    issues.push(
      issue(path, fact, "invalid_target_type", "Printer-series facts must target printer_state")
    );
  }
  if (definition.valueType !== fact.value.type) {
    issues.push(
      issue(
        path,
        fact,
        "incompatible_value_type",
        "Fact scalar type does not match the Core FieldDefinition"
      )
    );
  }
  if (definition.unit !== fact.unit) {
    issues.push(
      issue(path, fact, "incompatible_unit", "Fact unit does not match the Core FieldDefinition")
    );
  }
  return issues;
}

function immutableIssues(
  issues: PrinterSeriesPackageCoreCompatibilityIssue[]
): readonly PrinterSeriesPackageCoreCompatibilityIssue[] {
  return Object.freeze(
    issues
      .sort(
        (left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
      )
      .map((value) => Object.freeze({ ...value }))
  );
}

export function validatePrinterSeriesPackageCoreCompatibility(
  value: PrinterSeriesKnowledgePackageV1
): PrinterSeriesKnowledgePackageV1 {
  const { series } = value.payload;
  const issues: PrinterSeriesPackageCoreCompatibilityIssue[] = validateCoreVersionInterval(value);
  issues.push(
    ...series.facts.flatMap((fact, index) => validateFact(fact, `/payload/series/facts/${index}`))
  );
  series.models.forEach((model, modelIndex) => {
    model.facts.forEach((fact, factIndex) => {
      issues.push(...validateFact(fact, `/payload/series/models/${modelIndex}/facts/${factIndex}`));
    });
  });

  if (issues.length > 0) {
    throw new InvalidPrinterSeriesPackageCoreCompatibilityError(immutableIssues(issues));
  }
  return value;
}

function copyFact(fact: PackageFieldFactV1): PackageFieldFactV1 {
  return Object.freeze({
    factId: fact.factId,
    fieldPath: fact.fieldPath,
    value: Object.freeze({ ...fact.value }),
    ...(fact.unit === undefined ? {} : { unit: fact.unit }),
  });
}

function indexFacts(
  facts: readonly PackageFieldFactV1[],
  scope: "series" | "model"
): Map<string, PackageFieldFactV1> {
  const byPath = new Map<string, PackageFieldFactV1>();
  for (const fact of facts) {
    if (byPath.has(fact.fieldPath)) {
      throw new InvalidPrinterSeriesEffectiveFactsError(scope, fact.fieldPath);
    }
    byPath.set(fact.fieldPath, fact);
  }
  return byPath;
}

export function getEffectivePrinterSeriesFacts(
  value: PrinterSeriesKnowledgePackageV1,
  modelDefinitionId?: string
): readonly PackageFieldFactV1[] {
  validatePrinterSeriesPackageCoreCompatibility(value);
  const { series } = value.payload;
  const effective = indexFacts(series.facts, "series");

  if (modelDefinitionId !== undefined) {
    const model = series.models.find(
      (candidate) => candidate.modelDefinitionId === modelDefinitionId
    );
    if (!model) throw new UnknownPrinterSeriesModelError(modelDefinitionId);
    const modelFacts = indexFacts(model.facts, "model");
    for (const [fieldPath, fact] of modelFacts) effective.set(fieldPath, fact);
  }

  return Object.freeze(
    [...effective.values()]
      .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath))
      .map(copyFact)
  );
}
