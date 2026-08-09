import { describe, expect, it } from "vitest";

import {
  InvalidComponentDefinitionIdError,
  InvalidComponentDefinitionReferenceError,
  InvalidComponentDisplayNameError,
  InvalidComponentInstallationIdError,
  InvalidComponentInstanceIdError,
  InvalidComponentKindError,
  InvalidComponentPrinterStateIdError,
  InvalidComponentRoleError,
  createComponentDefinition,
  createComponentInstallation,
} from "../src/index";

const DEFINITION_REFERENCE = {
  packageId: "components.base",
  packageVersion: "1.0.0",
  definitionId: "fan.generic-5015",
};

const INSTALLATION_INPUT = {
  id: "installation-001",
  printerStateId: "printer-state-001",
  componentInstanceId: "component-instance-001",
  role: "cooling.part.1",
  kind: "cooling-fan",
  displayName: "Generic 5015 blower",
};

describe("ComponentDefinition", () => {
  it("creates a frozen catalog identity from exact values", () => {
    const definition = createComponentDefinition({
      id: "fan.generic-5015",
      kind: "cooling-fan",
      displayName: "  Generic 5015 blower  ",
    });

    expect(definition).toEqual({
      id: "fan.generic-5015",
      kind: "cooling-fan",
      displayName: "Generic 5015 blower",
    });
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it.each(["", " ", " definition", "definition "])("rejects an invalid definition ID: %j", (id) => {
    expect(() => createComponentDefinition({ id, kind: "hotend", displayName: "Hotend" })).toThrow(
      InvalidComponentDefinitionIdError
    );
  });

  it.each(["", "Hotend", "cooling fan", ".sensor", "sensor.", "sensor..probe", "-fan"])(
    "rejects an invalid definition kind: %j",
    (kind) => {
      expect(() =>
        createComponentDefinition({ id: "definition", kind, displayName: "Component" })
      ).toThrow(InvalidComponentKindError);
    }
  );

  it("rejects an empty display name", () => {
    expect(() =>
      createComponentDefinition({ id: "definition", kind: "hotend", displayName: "   " })
    ).toThrow(InvalidComponentDisplayNameError);
  });
});

describe("ComponentInstallation", () => {
  it("creates a known component installation with exact identities", () => {
    const installation = createComponentInstallation({
      ...INSTALLATION_INPUT,
      displayName: "  Generic 5015 blower  ",
      definitionRef: DEFINITION_REFERENCE,
    });

    expect(installation).toEqual({
      ...INSTALLATION_INPUT,
      definitionRef: DEFINITION_REFERENCE,
    });
    expect(Object.isFrozen(installation)).toBe(true);
    expect(Object.isFrozen(installation.definitionRef)).toBe(true);
  });

  it("creates an unknown component without inventing a definition reference", () => {
    const installation = createComponentInstallation(INSTALLATION_INPUT);

    expect(installation).not.toHaveProperty("definitionRef");
  });

  it.each(["toolhead.hotend", "cooling.part.1", "motion.z.motor.left"])(
    "accepts the extensible role %s",
    (role) => {
      expect(createComponentInstallation({ ...INSTALLATION_INPUT, role }).role).toBe(role);
    }
  );

  it.each([
    "",
    ".toolhead.hotend",
    "toolhead..hotend",
    "toolhead.hotend.",
    "Toolhead.hotend",
    "toolhead hotend",
    " toolhead.hotend",
  ])("rejects malformed roles: %j", (role) => {
    expect(() => createComponentInstallation({ ...INSTALLATION_INPUT, role })).toThrow(
      InvalidComponentRoleError
    );
  });

  it.each(["hotend", "extruder", "stepper-motor", "cooling-fan", "sensor.accelerometer"])(
    "accepts the extensible kind %s",
    (kind) => {
      expect(createComponentInstallation({ ...INSTALLATION_INPUT, kind }).kind).toBe(kind);
    }
  );

  it.each(["", "Cooling-fan", "cooling fan", "sensor..accelerometer", "sensor."])(
    "rejects malformed kinds: %j",
    (kind) => {
      expect(() => createComponentInstallation({ ...INSTALLATION_INPUT, kind })).toThrow(
        InvalidComponentKindError
      );
    }
  );

  it.each([
    ["id", InvalidComponentInstallationIdError],
    ["printerStateId", InvalidComponentPrinterStateIdError],
    ["componentInstanceId", InvalidComponentInstanceIdError],
  ] as const)("rejects malformed %s values", (field, errorType) => {
    for (const value of ["", " ", ` padded`]) {
      expect(() => createComponentInstallation({ ...INSTALLATION_INPUT, [field]: value })).toThrow(
        errorType
      );
    }
  });

  it("trims display names and rejects empty ones", () => {
    expect(
      createComponentInstallation({ ...INSTALLATION_INPUT, displayName: "  Blower  " }).displayName
    ).toBe("Blower");
    expect(() =>
      createComponentInstallation({ ...INSTALLATION_INPUT, displayName: "   " })
    ).toThrow(InvalidComponentDisplayNameError);
  });

  it.each([
    { ...DEFINITION_REFERENCE, packageId: "" },
    { ...DEFINITION_REFERENCE, packageVersion: " 1.0.0" },
    { ...DEFINITION_REFERENCE, definitionId: "definition " },
    { packageId: "package", packageVersion: "1" },
    null,
  ])("rejects a malformed definition reference: %j", (definitionRef) => {
    expect(() =>
      createComponentInstallation({ ...INSTALLATION_INPUT, definitionRef } as never)
    ).toThrow(InvalidComponentDefinitionReferenceError);
  });

  it("copies and freezes the definition reference defensively", () => {
    const definitionRef = { ...DEFINITION_REFERENCE };
    const installation = createComponentInstallation({ ...INSTALLATION_INPUT, definitionRef });

    definitionRef.definitionId = "changed";

    expect(installation.definitionRef).toEqual(DEFINITION_REFERENCE);
    expect(installation.definitionRef).not.toBe(definitionRef);
    expect(Object.isFrozen(installation.definitionRef)).toBe(true);
  });
});
